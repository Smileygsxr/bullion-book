// ==== Sync: how a logged-in user's data is saved to Firestore ====
//
// Everything lives under users/{uid}:
//   users/{uid}                 the main document - appSettings, chartDrawings,
//                               profilePhotoDataUrl, and bullionStorage (the
//                               journal's index + revision number)
//   users/{uid}/journalParts/*  the journal itself (accounts, trades, notes...):
//                               each account as JSON, split into <=900 KB parts
//   users/{uid}/screenshots/*   one document per trade screenshot
//   users/{uid}/backups/*       a copy of the journal from before the upgrade
//
// Why: Firestore caps a document at 1 MiB. The journal used to live entirely
// inside the main document (bullionAccounts), so ~1,000 imported trades or a
// handful of screenshots made every save fail - and only the browser console
// knew. Journals that haven't been upgraded yet keep working in that original
// single-document format ("v1") - including when the updated firestore.rules
// (which the subcollections need) haven't been published yet. They upgrade
// themselves on the next load once it's possible (migrateJournalToV2).
//
// Two devices: every journal save is a transaction that checks the stored
// revision number first. If another device saved in between, its changes are
// fetched and merged with this device's (trade by trade, field by field - see
// mergeJournalValues) instead of one device silently overwriting the other.
// A live listener on the main document brings in changes made elsewhere while
// the app is open. appSettings and chartDrawings get the same treatment.
//
// Safety: if the journal can't be loaded, nothing is saved (an empty journal
// must never overwrite the real one); a failed save shows on screen and is
// retried; closing the tab with unsaved changes asks first.

const JOURNAL_PART_BYTES = 900000;      // max UTF-8 bytes of journal JSON per part document
const JOURNAL_SAVE_DELAY_MS = 300;      // a burst of saves becomes one write
const SYNC_RETRY_DELAYS_MS = [3000, 10000, 30000, 60000];
const SCREENSHOT_MAX_CHARS = 1000000;   // a bigger data URL can't fit in its own document
const SCREENSHOT_TRASH_DAYS = 30;       // a screenshot no trade uses any more is deleted after this
const SCREENSHOT_TRASH_LIMIT = 2000;
const MAIN_DOC_LIMIT_BYTES = 1048576;
const JOURNAL_STUB_ID = 'reload-required';

// What an out-of-date copy of the app (one that only knows the single-document
// format) finds after the upgrade: one empty account whose name says what to
// do. The Firestore rules refuse its saves, so it can't overwrite anything.
const JOURNAL_STUB = {
    movedToV2: true,
    activeAccountId: JOURNAL_STUB_ID,
    accounts: {
        [JOURNAL_STUB_ID]: { id: JOURNAL_STUB_ID, name: 'Reload the app to load your journal', transactions: [], trades: [] }
    }
};

const journalSync = {
    uid: null,
    mode: null,             // 'v1' (single document) or 'v2' (split storage), once loaded
    loaded: false,
    loadError: null,
    rev: 0,                 // bullionStorage.rev as last read/written
    base: null,             // the journal as last read from / written to Firestore
    baseKey: null,          // its stable JSON (v1 only - to spot saves by an old copy of the app)
    parts: {},              // accountId -> the part strings currently stored (v2)
    index: {},              // accountId -> { parts, len, sum } (v2)
    strayParts: [],         // part documents the index doesn't reference (deleted on the next save)
    backupName: null,
    wantMigration: false,
    v2Unavailable: false,   // the subcollections were refused - rules not published yet
    dirty: false,
    saving: false,
    again: false,
    timer: null,
    slow: false,
    slowTimer: null,
    error: null,
    retryTimer: null,
    retryIndex: 0,
    remotePending: null,
    lastSavedAt: null,
    docBytes: 0,
    waiting: false,
    waitTimer: null,
    deleting: false,
    lastNotLoadedToast: 0,
    storedShots: new Set() // screenshot ids saved as their own documents this session
};

// appSettings and chartDrawings: each a field of the main document, saved
// with the same merge-before-write transaction as the journal.
const userDocFields = {
    appSettings: { base: undefined, rev: 0, dirty: false, saving: false, again: false, timer: null, error: null, remotePending: null },
    chartDrawings: { base: undefined, rev: 0, dirty: false, saving: false, again: false, timer: null, error: null, remotePending: null }
};

let userDocUnsubscribe = null;
let userDocLoaded = false;
let userDocRestartTimer = null;
let lastAvatarDataUrl = null;
let lastUserDocData = null;     // the latest server copy of the main document
let chartDrawingsDelivered = false;

// ---- Small pure helpers ----
function syncIsObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// JSON with every object's keys sorted, so equal data always compares equal -
// Firestore hands maps back with their keys in a different order.
function syncStableJson(value) {
    if (value === undefined) return 'undefined';
    return JSON.stringify(value, (key, v) => {
        if (!syncIsObject(v)) return v;
        const sorted = {};
        Object.keys(v).sort().forEach(k => { sorted[k] = v[k]; });
        return sorted;
    });
}

function syncEqual(a, b) {
    return syncStableJson(a) === syncStableJson(b);
}

function syncClone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function syncUtf8Bytes(str) {
    let bytes = 0;
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        if (c < 0x80) bytes += 1;
        else if (c < 0x800) bytes += 2;
        else if (c >= 0xD800 && c <= 0xDBFF) bytes += 4; // a surrogate pair is one 4-byte character
        else if (c >= 0xDC00 && c <= 0xDFFF) continue;
        else bytes += 3;
    }
    return bytes;
}

// Splits a string into pieces of at most maxBytes UTF-8 bytes, never
// between the two halves of a surrogate pair (emoji etc.).
function syncSplitUtf8(str, maxBytes) {
    const pieces = [];
    let start = 0;
    let bytes = 0;
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        let size;
        if (c < 0x80) size = 1;
        else if (c < 0x800) size = 2;
        else if (c >= 0xD800 && c <= 0xDBFF) size = 4;
        else if (c >= 0xDC00 && c <= 0xDFFF) continue;
        else size = 3;
        if (bytes + size > maxBytes && i > start) {
            pieces.push(str.slice(start, i));
            start = i;
            bytes = 0;
        }
        bytes += size;
    }
    pieces.push(str.slice(start));
    return pieces;
}

// FNV-1a: a fast checksum, so a journal assembled from parts that don't
// belong together (or a damaged part) is caught instead of loaded.
function syncHash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
}

function syncIsIdList(list) {
    if (!Array.isArray(list)) return false;
    const seen = new Set();
    return list.every(item => {
        if (!syncIsObject(item) || item.id === undefined || item.id === null || seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
    });
}

function syncIsStringList(list) {
    return Array.isArray(list) && list.every(item => typeof item === 'string');
}

// Three-way merge of this device's data (local) with another device's
// (remote), both descended from the copy last synced (base). Whatever only one
// side changed is kept. When both changed the same object, its fields merge
// one by one; lists of items with ids (trades, legs, transactions, tags,
// notes...) merge item by item, and lists of strings (tag ids...) merge as
// sets. Only when both changed the very same value does this device win.
// undefined means "doesn't exist" (deleted, or never created).
function mergeJournalValues(base, local, remote) {
    if (syncEqual(local, remote)) return local;
    if (syncEqual(base, local)) return remote;
    if (syncEqual(base, remote)) return local;

    if (syncIsObject(local) && syncIsObject(remote)) {
        const b = syncIsObject(base) ? base : {};
        const out = {};
        const keys = new Set(Object.keys(local).concat(Object.keys(remote), Object.keys(b)));
        keys.forEach(key => {
            const merged = mergeJournalValues(b[key], local[key], remote[key]);
            if (merged !== undefined) out[key] = merged;
        });
        return out;
    }

    if (syncIsIdList(local) && syncIsIdList(remote) && (base === undefined || syncIsIdList(base))) {
        const byId = list => new Map((list || []).map(item => [item.id, item]));
        const b = byId(base);
        const l = byId(local);
        const r = byId(remote);
        const ids = local.map(item => item.id).concat(remote.map(item => item.id).filter(id => !l.has(id)));
        const out = [];
        ids.forEach(id => {
            const merged = mergeJournalValues(b.get(id), l.get(id), r.get(id));
            if (merged !== undefined) out.push(merged);
        });
        return out;
    }

    if (syncIsStringList(local) && syncIsStringList(remote) && (base === undefined || syncIsStringList(base))) {
        const b = new Set(base || []);
        const l = new Set(local);
        const r = new Set(remote);
        return local.filter(s => r.has(s) || !b.has(s))
            .concat(remote.filter(s => !l.has(s) && !b.has(s)));
    }

    return local;
}

// Runs one module's piece of loading/merging on its own: a bug in, say, a
// settings re-render must never stop the journal itself from loading.
function syncSafely(label, fn) {
    try {
        return fn();
    } catch (err) {
        console.error(`${label} failed:`, err);
        return undefined;
    }
}

function syncToast(message, isError) {
    if (typeof communityToast === 'function') communityToast(message, isError);
}

function isPermissionDenied(err) {
    return !!err && err.code === 'permission-denied';
}

function journalConflictError() {
    const err = new Error('Saved from another device in the meantime');
    err.journalConflict = true;
    return err;
}

function journalCorruptError(detail) {
    const err = new Error(`Your journal data looks incomplete (${detail}).`);
    err.journalCorrupt = true;
    return err;
}

// ---- Firestore locations ----
function userDocRef(uid) {
    return db.collection('users').doc(uid);
}

function journalPartsRef(uid) {
    return userDocRef(uid).collection('journalParts');
}

function screenshotsRef(uid) {
    return userDocRef(uid).collection('screenshots');
}

function backupsRef(uid) {
    return userDocRef(uid).collection('backups');
}

function journalPartId(accountId, n) {
    return `${accountId}_${n}`;
}

// ---- Start / stop (called from accounts.js initAccounts) ----
function startUserSync(uid) {
    if (journalSync.uid === uid && userDocUnsubscribe) return;
    stopUserSync();
    journalSync.uid = uid;
    // Offline at startup: say so, rather than showing an empty journal
    // with no explanation. It loads by itself once the connection is back.
    journalSync.waitTimer = setTimeout(() => {
        if (!userDocLoaded && !journalSync.loadError) {
            journalSync.waiting = true;
            renderSyncStatus();
        }
    }, 6000);
    startUserDocListener(uid);
}

function stopUserSync() {
    if (userDocUnsubscribe) userDocUnsubscribe();
    userDocUnsubscribe = null;
    userDocLoaded = false;
    lastUserDocData = null;
    chartDrawingsDelivered = false;
    [journalSync.timer, journalSync.retryTimer, journalSync.slowTimer, journalSync.waitTimer, userDocRestartTimer]
        .forEach(t => clearTimeout(t));
    Object.assign(journalSync, {
        uid: null, mode: null, loaded: false, loadError: null, rev: 0, base: null, baseKey: null,
        parts: {}, index: {}, strayParts: [], backupName: null, wantMigration: false, dirty: false,
        saving: false, again: false, slow: false, error: null, retryIndex: 0, remotePending: null,
        waiting: false, deleting: false
    });
    Object.values(userDocFields).forEach(f => {
        clearTimeout(f.timer);
        Object.assign(f, { base: undefined, rev: 0, dirty: false, saving: false, again: false, error: null, remotePending: null });
    });
    renderSyncStatus();
}

function startUserDocListener(uid) {
    if (userDocUnsubscribe) userDocUnsubscribe();
    userDocUnsubscribe = userDocRef(uid).onSnapshot({ includeMetadataChanges: true }, snap => {
        if (journalSync.uid !== uid) return;
        // Server-confirmed data only. While offline the SDK reports a cached
        // "this document doesn't exist" - which must never be mistaken for a
        // brand new user with an empty journal.
        if (snap.metadata.fromCache || snap.metadata.hasPendingWrites) return;
        const data = snap.exists ? snap.data() : null;
        lastUserDocData = data;
        journalSync.docBytes = data ? syncUtf8Bytes(JSON.stringify(data)) : 0;
        if (!userDocLoaded) handleUserDocLoaded(uid, data);
        else handleUserDocChanged(data);
    }, err => {
        console.error('Firestore sync error:', err.message);
        userDocUnsubscribe = null;
        if (journalSync.uid !== uid) return;
        if (!userDocLoaded) {
            journalLoadFailed(err);
            return;
        }
        clearTimeout(userDocRestartTimer);
        userDocRestartTimer = setTimeout(() => {
            if (journalSync.uid === uid && !userDocUnsubscribe) startUserDocListener(uid);
        }, 5000);
    });
}

// First server snapshot: hand each part of the document to its owner.
function handleUserDocLoaded(uid, data) {
    userDocLoaded = true;
    journalSync.waiting = false;
    clearTimeout(journalSync.waitTimer);
    lastAvatarDataUrl = data ? data.profilePhotoDataUrl || null : null;
    if (typeof applyLoadedSettings === 'function') syncSafely('Loading settings', () => applyLoadedSettings(data ? data.appSettings || null : null));
    if (typeof applyLoadedChartDrawings === 'function') {
        syncSafely('Loading chart drawings', () => applyLoadedChartDrawings(data ? data.chartDrawings || null : null));
        chartDrawingsDelivered = true;
    }
    if (typeof applyLoadedAvatar === 'function') syncSafely('Loading the profile photo', () => applyLoadedAvatar(lastAvatarDataUrl));
    // The merge base is what this device shows right after loading - with
    // the app's defaults filled in - so an untouched default never counts
    // as a change made here.
    Object.keys(userDocFields).forEach(field => {
        const f = userDocFields[field];
        f.base = syncClone(userDocFieldLocal(field));
        f.rev = (data && data.syncRevs && data.syncRevs[field]) || 0;
    });
    loadJournalFromUserDoc(uid, data);
}

// The page's later <script> tags (chart-tools.js among them) can still be
// downloading when Firestore answers - such a script asks for its part of
// the user document here once it has loaded.
function userDocArrivedEarly(field) {
    if (field !== 'chartDrawings' || !userDocLoaded || chartDrawingsDelivered || typeof applyLoadedChartDrawings !== 'function') return;
    chartDrawingsDelivered = true;
    const data = lastUserDocData;
    syncSafely('Loading chart drawings', () => applyLoadedChartDrawings(data ? data.chartDrawings || null : null));
    const f = userDocFields.chartDrawings;
    f.base = syncClone(userDocFieldLocal('chartDrawings'));
    f.rev = (data && data.syncRevs && data.syncRevs.chartDrawings) || 0;
}

// appSettings never deletes keys - one missing from the stored copy (a
// setting newer than the last save) is "unchanged", not "deleted".
// chartDrawings does delete (removed drawings), so it's compared as is.
function remoteUserDocField(field, data, base) {
    const remote = data ? data[field] : undefined;
    if (field === 'appSettings' && syncIsObject(base)) return Object.assign({}, base, syncIsObject(remote) ? remote : {});
    return remote;
}

// Later snapshots: another device (or tab) changed something.
function handleUserDocChanged(data) {
    Object.keys(userDocFields).forEach(field => syncSafely(`Applying ${field} from another device`, () => applyRemoteUserDocField(field, data)));
    const avatar = data ? data.profilePhotoDataUrl || null : null;
    if (avatar && avatar !== lastAvatarDataUrl && typeof applyLoadedAvatar === 'function') syncSafely('Applying the profile photo', () => applyLoadedAvatar(avatar));
    lastAvatarDataUrl = avatar;
    handleRemoteJournalChange(data);
}

// ---- Loading the journal ----
function loadJournalFromUserDoc(uid, data) {
    journalFromUserDoc(uid, data)
        .then(result => {
            if (journalSync.uid === uid) applyLoadedJournal(result);
        })
        .catch(err => {
            if (journalSync.uid === uid) journalLoadFailed(err);
        });
}

// Reads the journal out of a main-document snapshot: straight from
// bullionAccounts (v1), or by fetching and joining its parts (v2).
function journalFromUserDoc(uid, data, attempt) {
    const storage = data && data.bullionStorage;
    if (!(storage && storage.version >= 2)) {
        return Promise.resolve({
            mode: 'v1',
            rev: (storage && storage.rev) || 0,
            state: data && data.bullionAccounts ? syncClone(data.bullionAccounts) : null
        });
    }
    return journalPartsRef(uid).get().then(snap => {
        const result = assembleJournalParts(storage, snap.docs);
        if (!result.error) return result;
        // Another device may have saved between reading the index and its
        // parts - read both again before calling it damaged.
        if ((attempt || 0) >= 2) throw journalCorruptError(result.error);
        return userDocRef(uid).get()
            .then(doc => journalFromUserDoc(uid, doc.exists ? doc.data() : null, (attempt || 0) + 1));
    });
}

function assembleJournalParts(storage, docs) {
    const byId = new Map();
    docs.forEach(doc => byId.set(doc.id, doc.data()));
    const accounts = {};
    const parts = {};
    const used = new Set();
    const index = storage.accounts || {};
    const ids = Object.keys(index);
    for (let a = 0; a < ids.length; a++) {
        const accountId = ids[a];
        const entry = index[accountId];
        const pieces = [];
        for (let n = 0; n < entry.parts; n++) {
            const partId = journalPartId(accountId, n);
            const part = byId.get(partId);
            if (!part || typeof part.json !== 'string') return { error: `part ${partId} is missing` };
            pieces.push(part.json);
            used.add(partId);
        }
        const json = pieces.join('');
        if (json.length !== entry.len || syncHash(json) !== entry.sum) return { error: `account ${accountId} failed its checksum` };
        try {
            accounts[accountId] = JSON.parse(json);
        } catch (e) {
            return { error: `account ${accountId} isn't valid JSON` };
        }
        parts[accountId] = pieces;
    }
    let extras = {};
    if (typeof storage.extras === 'string' && storage.extras) {
        try { extras = JSON.parse(storage.extras); } catch (e) { return { error: 'extras aren\'t valid JSON' }; }
    }
    const state = Object.assign({}, extras, { accounts, activeAccountId: storage.activeAccountId });
    return {
        mode: 'v2',
        rev: storage.rev || 0,
        state,
        parts,
        index: syncClone(index),
        backupName: storage.backup || null,
        stray: Array.from(byId.keys()).filter(id => !used.has(id))
    };
}

function setJournalBase(state) {
    journalSync.base = state ? syncClone(state) : null;
    journalSync.baseKey = journalSync.mode === 'v1' ? syncStableJson(journalSync.base) : null;
}

function adoptServerJournal(result) {
    journalSync.mode = result.mode;
    journalSync.rev = result.rev;
    journalSync.parts = result.parts || {};
    journalSync.index = result.index || {};
    journalSync.strayParts = result.stray || [];
    if (result.backupName) journalSync.backupName = result.backupName;
    if (result.mode === 'v2') journalSync.wantMigration = false;
    setJournalBase(result.state);
}

function applyLoadedJournal(result) {
    adoptServerJournal(result);
    journalSync.loaded = true;
    journalSync.loadError = null;
    journalSync.wantMigration = result.mode === 'v1';
    renderSyncStatus();
    // accounts.js: fills accountsState (may save straight away, e.g. a brand
    // new user's first account - allowed now that loaded is true). A render
    // error in there mustn't count as a failed load.
    syncSafely('Showing the journal', () => applyLoadedState(result.state ? syncClone(result.state) : null));
    if (journalSync.wantMigration) scheduleJournalSync();
}

function journalLoadFailed(err) {
    console.error('Could not load the journal:', err && err.message);
    journalSync.loadError = err || new Error('Load failed');
    journalSync.waiting = false;
    renderSyncStatus();
}

function retryJournalLoad() {
    const uid = journalSync.uid;
    if (!uid) return;
    journalSync.loadError = null;
    renderSyncStatus();
    if (!userDocLoaded || !userDocUnsubscribe) {
        startUserDocListener(uid);
        return;
    }
    userDocRef(uid).get()
        .then(doc => loadJournalFromUserDoc(uid, doc.exists ? doc.data() : null))
        .catch(err => journalLoadFailed(err));
}

// ---- Saving the journal ----
// The journal exactly as it should be stored: a deep copy of accountsState
// without csvImportUndo - an old one-level undo copy of a whole CSV import,
// replaced by the Trade Change History, that doubled the size of every save.
function journalSnapshotForSave() {
    return cleanJournalState(accountsState);
}

function cleanJournalState(state) {
    if (!state) return null;
    const copy = syncClone(state);
    Object.values(copy.accounts || {}).forEach(acc => { if (acc) delete acc.csvImportUndo; });
    return copy;
}

// Called by saveAccountsState (accounts.js) for logged-in users.
function requestJournalSync() {
    if (!journalSync.uid || journalSync.deleting) return;
    if (!journalSync.loaded) {
        // Saving now would replace the real journal with whatever is on
        // screen before it finished loading - refuse instead.
        if (Date.now() - journalSync.lastNotLoadedToast > 10000) {
            journalSync.lastNotLoadedToast = Date.now();
            syncToast('Your journal hasn\'t finished loading yet - that change wasn\'t saved.', true);
        }
        return;
    }
    journalSync.dirty = true;
    scheduleJournalSync();
}

function scheduleJournalSync() {
    clearTimeout(journalSync.timer);
    journalSync.timer = setTimeout(runJournalSync, JOURNAL_SAVE_DELAY_MS);
}

function runJournalSync() {
    clearTimeout(journalSync.timer);
    const uid = journalSync.uid;
    if (!uid || !journalSync.loaded || journalSync.deleting) return;
    if (journalSync.saving) {
        journalSync.again = true;
        return;
    }
    if (!journalSync.dirty && !journalSync.wantMigration) return;

    journalSync.saving = true;
    journalSync.again = false;
    clearTimeout(journalSync.slowTimer);
    journalSync.slowTimer = setTimeout(() => {
        journalSync.slow = true;
        renderSyncStatus();
    }, 1500);

    saveJournalWithRetries(uid, 0)
        .then(() => {
            journalSync.error = null;
            journalSync.retryIndex = 0;
            journalSync.lastSavedAt = Date.now();
        })
        .catch(err => {
            console.error('Journal save failed:', err && err.message);
            journalSync.dirty = true;
            journalSync.error = err;
            scheduleSyncRetry();
        })
        .then(() => {
            journalSync.saving = false;
            journalSync.slow = false;
            clearTimeout(journalSync.slowTimer);
            renderSyncStatus();
            if (journalSync.uid !== uid) return;
            if (journalSync.remotePending) {
                const data = journalSync.remotePending;
                journalSync.remotePending = null;
                handleRemoteJournalChange(data);
            }
            if (journalSync.again || (journalSync.dirty && !journalSync.error)) runJournalSync();
            if (currentStoragePanelVisible()) syncSafely('Refreshing Data & Storage', renderStoragePanel);
        });
}

function saveJournalWithRetries(uid, attempt) {
    const snapshot = journalSnapshotForSave();
    const wasDirty = journalSync.dirty;
    journalSync.dirty = false;
    return writeJournal(uid, snapshot, wasDirty).catch(err => {
        if (wasDirty) journalSync.dirty = true;
        if (!(err && err.journalConflict)) throw err;
        if (attempt >= 3) throw new Error('Another device kept saving at the same time - trying again shortly.');
        // Bring in the other device's changes, then write the merged result
        return pullRemoteJournal(uid).then(() => saveJournalWithRetries(uid, attempt + 1));
    });
}

function writeJournal(uid, snapshot, wasDirty) {
    if (journalSync.mode === 'v2') return wasDirty ? writeJournalV2(uid, snapshot) : Promise.resolve();
    const migrate = journalSync.wantMigration && !journalSync.v2Unavailable
        ? migrateJournalToV2(uid, snapshot).then(() => true, err => {
            if (err && err.journalConflict) throw err;
            journalSync.wantMigration = false;
            if (isPermissionDenied(err)) {
                journalSync.v2Unavailable = true;
                console.info('Split journal storage needs the updated Firestore rules - keeping the single-document format for now.');
            } else {
                console.warn('Storage upgrade failed - will try again next time the app loads:', err && err.message);
            }
            return false;
        })
        : Promise.resolve(false);
    return migrate.then(migrated => {
        if (migrated || !wasDirty) return null;
        return writeJournalV1(uid, snapshot);
    });
}

// Original format: the whole journal in the main document's bullionAccounts.
function writeJournalV1(uid, snapshot) {
    const ref = userDocRef(uid);
    let newRev = 0;
    return db.runTransaction(tx => tx.get(ref).then(doc => {
        const data = doc.exists ? doc.data() : {};
        const storage = data.bullionStorage || null;
        const remoteRev = (storage && storage.rev) || 0;
        if (storage && storage.version >= 2) throw journalConflictError(); // another device upgraded it
        // (an old copy of the app saves without bumping the revision -
        // comparing the content catches that too)
        if (remoteRev !== journalSync.rev || syncStableJson(data.bullionAccounts || null) !== journalSync.baseKey) {
            throw journalConflictError();
        }
        newRev = remoteRev + 1;
        tx.set(ref, {
            bullionAccounts: snapshot,
            bullionStorage: { version: 1, rev: newRev, savedAt: Date.now() }
        }, { mergeFields: ['bullionAccounts', 'bullionStorage'] });
    })).then(() => {
        journalSync.rev = newRev;
        setJournalBase(snapshot);
    });
}

// Split format: each account's JSON in part documents, plus an index
// (sizes + checksums) and the revision number in the main document - all
// written in one transaction, so readers never see a half-saved journal.
// (A single save can carry roughly 10 MB - far beyond any real journal.)
function writeJournalV2(uid, snapshot) {
    const ref = userDocRef(uid);
    let newRev = 0;
    let plan = null;
    return uploadPendingScreenshots(uid, snapshot)
        .then(() => {
            plan = planJournalParts(snapshot);
            return db.runTransaction(tx => tx.get(ref).then(doc => {
                const data = doc.exists ? doc.data() : {};
                const storage = data.bullionStorage;
                if (!storage || !(storage.version >= 2) || (storage.rev || 0) !== journalSync.rev) throw journalConflictError();
                newRev = (storage.rev || 0) + 1;
                plan.writes.forEach(w => tx.set(journalPartsRef(uid).doc(w.id), { account: w.account, n: w.n, json: w.json }));
                plan.deletes.forEach(id => tx.delete(journalPartsRef(uid).doc(id)));
                const trash = nextScreenshotTrash(storage.trash, journalSync.base, snapshot);
                trash.expired.forEach(id => tx.delete(screenshotsRef(uid).doc(id)));
                tx.set(ref, {
                    bullionStorage: buildStorageIndex(snapshot, plan, newRev, trash.keep, storage.backup || journalSync.backupName)
                }, { mergeFields: ['bullionStorage'] });
            }));
        })
        .then(() => {
            journalSync.rev = newRev;
            journalSync.parts = plan.parts;
            journalSync.index = plan.index;
            journalSync.strayParts = [];
            setJournalBase(snapshot);
        });
}

function buildStorageIndex(snapshot, plan, rev, trash, backupName) {
    const extras = Object.assign({}, snapshot);
    delete extras.accounts;
    delete extras.activeAccountId;
    const index = {
        version: 2,
        rev,
        accounts: plan.index,
        activeAccountId: snapshot.activeAccountId || null,
        trash,
        savedAt: Date.now()
    };
    if (Object.keys(extras).length > 0) index.extras = JSON.stringify(extras);
    if (backupName) index.backup = backupName;
    return index;
}

// Screenshots saved as their own documents are stored in the journal as
// { id } only - the image is fetched when it's shown (loadScreenshotDataUrl).
function serializeAccountForStorage(account) {
    return JSON.stringify(account, (key, value) => {
        if (key === 'screenshots' && Array.isArray(value)) {
            return value.map(shot => (shot && shot.dataUrl && journalSync.storedShots.has(shot.id)
                ? Object.assign({}, shot, { dataUrl: undefined })
                : shot));
        }
        return value;
    });
}

function planJournalParts(snapshot) {
    const plan = { index: {}, parts: {}, writes: [], deletes: [] };
    const accounts = snapshot.accounts || {};
    Object.keys(accounts).forEach(accountId => {
        const json = serializeAccountForStorage(accounts[accountId]);
        const pieces = syncSplitUtf8(json, JOURNAL_PART_BYTES);
        const old = journalSync.parts[accountId] || [];
        plan.index[accountId] = { parts: pieces.length, len: json.length, sum: syncHash(json) };
        plan.parts[accountId] = pieces;
        pieces.forEach((piece, n) => {
            if (piece !== old[n]) plan.writes.push({ id: journalPartId(accountId, n), account: accountId, n, json: piece });
        });
        for (let n = pieces.length; n < old.length; n++) plan.deletes.push(journalPartId(accountId, n));
    });
    Object.keys(journalSync.parts).forEach(accountId => {
        if (accounts[accountId]) return;
        journalSync.parts[accountId].forEach((piece, n) => plan.deletes.push(journalPartId(accountId, n)));
    });
    const writing = new Set(plan.writes.map(w => w.id));
    journalSync.strayParts.forEach(id => {
        if (!writing.has(id) && plan.deletes.indexOf(id) < 0) plan.deletes.push(id);
    });
    return plan;
}

function referencedScreenshotIds(state) {
    const ids = new Set();
    Object.values((state && state.accounts) || {}).forEach(acc => (acc.trades || []).forEach(trade =>
        (trade.screenshots || []).forEach(shot => { if (shot && shot.id) ids.add(shot.id); })));
    return ids;
}

// A screenshot document no trade refers to any more (screenshot removed,
// trade deleted) goes in the trash, and is only deleted after
// SCREENSHOT_TRASH_DAYS - so reverting a recent change in the Trade Change
// History still finds its pictures.
function nextScreenshotTrash(remoteTrash, base, snapshot) {
    const now = Date.now();
    const inUse = referencedScreenshotIds(snapshot);
    const before = referencedScreenshotIds(base);
    const keep = (Array.isArray(remoteTrash) ? remoteTrash : []).filter(t => t && t.id && !inUse.has(t.id));
    const known = new Set(keep.map(t => t.id));
    before.forEach(id => {
        if (!inUse.has(id) && !known.has(id)) keep.push({ id, at: now });
    });
    const cutoff = now - SCREENSHOT_TRASH_DAYS * 86400000;
    const expired = keep.filter(t => t.at < cutoff).slice(0, 50).map(t => t.id);
    const expiredSet = new Set(expired);
    return { keep: keep.filter(t => !expiredSet.has(t.id)).slice(-SCREENSHOT_TRASH_LIMIT), expired };
}

// New screenshots (still data URLs inside the trade) get their own
// documents before the journal is written. One that fails stays inside the
// trade for now and is tried again on the next save - nothing is dropped.
function uploadPendingScreenshots(uid, snapshot) {
    const pending = [];
    Object.values(snapshot.accounts || {}).forEach(acc => (acc.trades || []).forEach(trade =>
        (trade.screenshots || []).forEach(shot => {
            if (shot && shot.id && typeof shot.dataUrl === 'string' && !journalSync.storedShots.has(shot.id)
                && shot.dataUrl.length <= SCREENSHOT_MAX_CHARS) {
                pending.push({ shot, tradeId: trade.id, accountId: acc.id });
            }
        })));
    // One at a time - each can be close to 1 MB
    return pending.reduce((chain, item) => chain.then(() =>
        screenshotsRef(uid).doc(item.shot.id)
            .set({ dataUrl: item.shot.dataUrl, tradeId: item.tradeId || null, accountId: item.accountId || null, savedAt: Date.now() })
            .then(() => {
                journalSync.storedShots.add(item.shot.id);
                screenshotCache.set(item.shot.id, item.shot.dataUrl);
            })
            .catch(err => {
                if (isPermissionDenied(err)) throw err;
                console.warn('Screenshot not uploaded yet, kept inside the trade:', err && err.message);
            })
    ), Promise.resolve());
}

// One-time upgrade of a single-document journal to the split format: a
// backup copy first, then the screenshots, then the parts + index (one
// transaction, which also swaps bullionAccounts for JOURNAL_STUB), then a
// read-back to prove the parts reassemble into exactly what was saved.
// Fails harmlessly with permission-denied while the old rules are live.
let migrationBackupName = null; // written this session (a retried upgrade reuses it)

function migrateJournalToV2(uid, snapshot) {
    const ref = userDocRef(uid);
    const original = journalSync.base;
    const backupName = migrationBackupName
        || (original ? `pre-v2-${new Date().toISOString().replace(/[:.]/g, '-')}` : null);
    let plan = null;
    let newRev = 0;
    const backup = original && !migrationBackupName
        ? writeBackup(uid, backupName, 'Your journal as it was just before the storage upgrade', original)
            .then(() => { migrationBackupName = backupName; })
        : Promise.resolve();
    return backup
        .then(() => uploadPendingScreenshots(uid, snapshot))
        .then(() => {
            journalSync.parts = {};
            journalSync.strayParts = [];
            plan = planJournalParts(snapshot);
            return db.runTransaction(tx => tx.get(ref).then(doc => {
                const data = doc.exists ? doc.data() : {};
                const storage = data.bullionStorage || null;
                const remoteRev = (storage && storage.rev) || 0;
                if ((storage && storage.version >= 2) || remoteRev !== journalSync.rev
                    || syncStableJson(data.bullionAccounts || null) !== journalSync.baseKey) {
                    throw journalConflictError();
                }
                newRev = remoteRev + 1;
                plan.writes.forEach(w => tx.set(journalPartsRef(uid).doc(w.id), { account: w.account, n: w.n, json: w.json }));
                tx.set(ref, {
                    bullionAccounts: JOURNAL_STUB,
                    bullionStorage: buildStorageIndex(snapshot, plan, newRev, [], backupName)
                }, { mergeFields: ['bullionAccounts', 'bullionStorage'] });
            }));
        })
        .then(() => {
            journalSync.mode = 'v2';
            journalSync.rev = newRev;
            journalSync.parts = plan.parts;
            journalSync.index = plan.index;
            journalSync.backupName = backupName;
            journalSync.wantMigration = false;
            setJournalBase(snapshot);
            return verifyMigratedJournal(uid, snapshot, newRev);
        });
}

function verifyMigratedJournal(uid, snapshot, rev) {
    return journalPartsRef(uid).get()
        .then(snap => {
            const result = assembleJournalParts({ accounts: journalSync.index, rev, activeAccountId: snapshot.activeAccountId }, snap.docs);
            const expected = {};
            Object.keys(snapshot.accounts || {}).forEach(id => { expected[id] = JSON.parse(serializeAccountForStorage(snapshot.accounts[id])); });
            if (result.error || !syncEqual(result.state.accounts, expected)) return rollbackMigration(uid, snapshot, result.error || 'content differs');
            return null;
        }, err => {
            // Couldn't read it back (connection) - the transaction itself
            // succeeded, so the parts are there.
            console.warn('Could not double-check the upgraded journal:', err && err.message);
        });
}

// Should never run: the parts didn't reassemble into the journal that was
// written. Put the single-document copy back and stop trying for this session.
function rollbackMigration(uid, snapshot, reason) {
    console.error('Storage upgrade check failed, going back to the single-document format:', reason);
    journalSync.v2Unavailable = true;
    const ref = userDocRef(uid);
    let newRev = 0;
    return db.runTransaction(tx => tx.get(ref).then(doc => {
        const storage = (doc.exists && doc.data().bullionStorage) || {};
        newRev = (storage.rev || 0) + 1;
        tx.set(ref, {
            bullionAccounts: snapshot,
            bullionStorage: { version: 1, rev: newRev, savedAt: Date.now() }
        }, { mergeFields: ['bullionAccounts', 'bullionStorage'] });
    })).then(() => {
        journalSync.mode = 'v1';
        journalSync.rev = newRev;
        journalSync.parts = {};
        journalSync.index = {};
        setJournalBase(snapshot);
    });
}

function writeBackup(uid, name, note, value) {
    const json = JSON.stringify(value);
    const pieces = syncSplitUtf8(json, JOURNAL_PART_BYTES);
    const batch = db.batch();
    const createdAt = Date.now();
    pieces.forEach((piece, n) => batch.set(backupsRef(uid).doc(`${name}_${n}`), {
        backup: name, note, n, of: pieces.length, len: json.length, sum: syncHash(json), createdAt, json: piece
    }));
    return batch.commit();
}

// ---- Changes from another device ----
function pullRemoteJournal(uid) {
    return userDocRef(uid).get()
        .then(doc => journalFromUserDoc(uid, doc.exists ? doc.data() : null))
        .then(result => mergeRemoteJournal(result));
}

// Merges the server's journal into this device's and adopts the server's
// revision. Marks the journal dirty when this device still has changes the
// server doesn't - which the caller then saves.
function mergeRemoteJournal(result) {
    const remote = cleanJournalState(result.state);
    const base = cleanJournalState(journalSync.base);
    // Merged against the live objects (mergeJournalValues never changes its
    // inputs, and hands back unchanged parts as they are), then applied in
    // place - so anything holding an account (an open dialog, a pending
    // confirm) still holds the real one afterwards.
    const live = accountsState.accounts;
    let merged = mergeJournalValues(base ? base.accounts : undefined, live, remote ? remote.accounts : undefined);
    if (!syncIsObject(merged) || Object.keys(merged).length === 0) merged = live;
    adoptServerJournal(result);

    const changedHere = merged !== live && !syncEqual(merged, live);
    if (changedHere) {
        applyMergedAccounts(merged);
        if (!accountsState.accounts[accountsState.activeAccountId]) {
            accountsState.activeAccountId = remote && remote.activeAccountId && accountsState.accounts[remote.activeAccountId]
                ? remote.activeAccountId
                : Object.keys(accountsState.accounts)[0];
        }
        // Another device's edits aren't changes made here - start the Trade
        // Change History's next diff from the merged trades.
        if (typeof resetTradeHistoryBaselines === 'function') resetTradeHistoryBaselines();
        refreshAfterRemoteJournalChange();
    }
    // (activeAccountId is per device - a different one never triggers a save)
    if (!remote || !syncEqual(merged, remote.accounts)) journalSync.dirty = true;
    return changedHere;
}

// Writes merged accounts into accountsState without swapping the account
// objects themselves for new ones.
function applyMergedAccounts(merged) {
    const accounts = accountsState.accounts;
    Object.keys(accounts).forEach(id => { if (!merged[id]) delete accounts[id]; });
    Object.keys(merged).forEach(id => {
        const live = accounts[id];
        const next = merged[id];
        if (live === next) return;
        if (syncIsObject(live) && syncIsObject(next)) {
            Object.keys(live).forEach(key => { if (!(key in next)) delete live[key]; });
            Object.assign(live, next);
        } else {
            accounts[id] = next;
        }
    });
}

function refreshAfterRemoteJournalChange() {
    if (typeof renderSidebarAccount === 'function') syncSafely('Refreshing the sidebar', renderSidebarAccount);
    if (typeof refreshActivePageForAccountChange === 'function') syncSafely('Refreshing the page', refreshActivePageForAccountChange);
    if (typeof renderTradeHistoryPanel === 'function') syncSafely('Refreshing the change history', renderTradeHistoryPanel);
    syncToast('Updated with changes from your other device.', false);
}

function handleRemoteJournalChange(data) {
    if (!journalSync.loaded || journalSync.deleting) return;
    const storage = data && data.bullionStorage;
    const remoteRev = (storage && storage.rev) || 0;
    const remoteV2 = !!(storage && storage.version >= 2);
    if (remoteRev < journalSync.rev) return; // older than what's already here
    if (remoteRev === journalSync.rev) {
        if (remoteV2) return;
        // Same revision, different content = an old copy of the app saved
        if (journalSync.mode === 'v1' && syncStableJson((data && data.bullionAccounts) || null) === journalSync.baseKey) return;
    }
    if (journalSync.saving) {
        journalSync.remotePending = data; // handled once the save in flight finishes
        return;
    }
    const uid = journalSync.uid;
    journalFromUserDoc(uid, data)
        .then(result => {
            if (journalSync.uid !== uid || result.rev < journalSync.rev) return;
            if (journalSync.saving) {
                journalSync.remotePending = data;
                return;
            }
            mergeRemoteJournal(result);
            if (journalSync.dirty) scheduleJournalSync();
        })
        .catch(err => console.warn('Could not apply changes from another device yet:', err && err.message));
}

// ---- appSettings / chartDrawings ----
function userDocFieldLocal(field) {
    if (field === 'appSettings') return typeof appSettings !== 'undefined' ? appSettings : undefined;
    if (field === 'chartDrawings') return typeof chartToolsStore !== 'undefined' ? chartToolsStore : undefined;
    return undefined;
}

function applyMergedUserDocField(field, value) {
    if (value === undefined) return;
    if (field === 'appSettings' && typeof applyRemoteSettings === 'function') syncSafely('Applying merged settings', () => applyRemoteSettings(value));
    if (field === 'chartDrawings' && typeof applyRemoteChartDrawings === 'function') syncSafely('Applying merged chart drawings', () => applyRemoteChartDrawings(value));
}

// Called by saveAppSettings (settings.js) and saveChartToolsStore (chart-tools.js).
function requestUserDocFieldSave(field) {
    const f = userDocFields[field];
    if (!f || !journalSync.uid || journalSync.deleting) return;
    f.dirty = true;
    clearTimeout(f.timer);
    f.timer = setTimeout(() => runUserDocFieldSave(field), JOURNAL_SAVE_DELAY_MS);
}

function runUserDocFieldSave(field) {
    const f = userDocFields[field];
    const uid = journalSync.uid;
    clearTimeout(f.timer);
    // Before the first snapshot there's no base to merge against - the
    // loaded settings replace what's on screen anyway.
    if (!uid || !userDocLoaded || !f.dirty || journalSync.deleting) return;
    if (f.saving) {
        f.again = true;
        return;
    }
    f.saving = true;
    f.again = false;
    f.dirty = false;
    const local = syncClone(userDocFieldLocal(field));
    const ref = userDocRef(uid);
    let written;
    let newRev = 0;
    db.runTransaction(tx => tx.get(ref).then(doc => {
        const data = doc.exists ? doc.data() : {};
        const remote = remoteUserDocField(field, data, f.base);
        const remoteRev = (data.syncRevs && data.syncRevs[field]) || 0;
        written = remoteRev === f.rev && syncEqual(remote, f.base) ? local : mergeJournalValues(f.base, local, remote);
        if (written === undefined) written = local || {};
        newRev = remoteRev + 1;
        tx.set(ref, { [field]: written, syncRevs: { [field]: newRev } }, { mergeFields: [field, `syncRevs.${field}`] });
    }))
        .then(() => {
            f.base = syncClone(written);
            f.rev = newRev;
            f.error = null;
            journalSync.retryIndex = 0;
            // Another device's change was merged in - show it here too
            // (keeping anything changed on this device during the save)
            if (!syncEqual(written, local)) applyMergedUserDocField(field, syncClone(mergeJournalValues(local, userDocFieldLocal(field), written)));
        })
        .catch(err => {
            console.error(`Failed to save ${field}:`, err && err.message);
            f.dirty = true;
            f.error = err;
            scheduleSyncRetry();
        })
        .then(() => {
            f.saving = false;
            renderSyncStatus();
            if (journalSync.uid !== uid) return;
            if (f.remotePending) {
                const data = f.remotePending;
                f.remotePending = null;
                applyRemoteUserDocField(field, data);
            }
            if (f.again || (f.dirty && !f.error)) runUserDocFieldSave(field);
        });
}

function applyRemoteUserDocField(field, data) {
    const f = userDocFields[field];
    const remote = remoteUserDocField(field, data, f.base);
    const remoteRev = (data && data.syncRevs && data.syncRevs[field]) || 0;
    if (remoteRev < f.rev) return;
    if (remoteRev === f.rev && syncEqual(remote, f.base)) return;
    if (f.saving) {
        f.remotePending = data;
        return;
    }
    const local = userDocFieldLocal(field);
    const merged = mergeJournalValues(f.base, local, remote);
    f.base = syncClone(remote);
    f.rev = remoteRev;
    if (merged !== undefined && !syncEqual(merged, local)) applyMergedUserDocField(field, syncClone(merged));
    if (merged !== undefined && !syncEqual(merged, remote)) requestUserDocFieldSave(field);
}

// ---- Screenshots ----
const screenshotCache = new Map(); // id -> data URL
const BLANK_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

// What to put in an <img src> for a trade screenshot right now: its data URL
// if it's here, else a blank placeholder that hydrateScreenshotImages fills in.
function screenshotSrc(shot) {
    return (shot && shot.dataUrl) || (shot && screenshotCache.get(shot.id)) || BLANK_IMAGE;
}

function isScreenshotDataUrl(value) {
    return typeof value === 'string' && /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value);
}

function loadScreenshotDataUrl(id) {
    if (screenshotCache.has(id)) return Promise.resolve(screenshotCache.get(id));
    const uid = journalSync.uid;
    if (!uid || !db) return Promise.resolve(null);
    return screenshotsRef(uid).doc(id).get()
        .then(doc => {
            const url = doc.exists ? doc.data().dataUrl : null;
            if (!isScreenshotDataUrl(url)) return null;
            screenshotCache.set(id, url);
            return url;
        })
        .catch(err => {
            console.warn('Screenshot load failed:', err && err.message);
            return null;
        });
}

// Fills in every <img data-shot-id> under container that's still a placeholder.
function hydrateScreenshotImages(container) {
    if (!container) return;
    container.querySelectorAll('img[data-shot-id]').forEach(img => {
        if (img.getAttribute('src') !== BLANK_IMAGE) return;
        img.classList.add('screenshot-loading');
        loadScreenshotDataUrl(img.dataset.shotId).then(url => {
            img.classList.remove('screenshot-loading');
            if (url) {
                img.src = url;
            } else {
                img.classList.add('screenshot-missing');
                img.alt = 'Screenshot unavailable';
                img.title = 'This screenshot could not be loaded';
            }
        });
    });
}

// ---- Deleting everything (Settings > Danger > Delete User Account) ----
function deleteAllUserData(uid) {
    // Stop listening first, so the deletion isn't mistaken for a remote
    // change that this device "helpfully" saves back.
    if (userDocUnsubscribe) userDocUnsubscribe();
    userDocUnsubscribe = null;
    journalSync.deleting = true;
    return ['journalParts', 'screenshots', 'backups']
        .reduce((chain, name) => chain.then(() => deleteWholeCollection(userDocRef(uid).collection(name))), Promise.resolve())
        .then(() => userDocRef(uid).delete());
}

function deleteWholeCollection(ref) {
    return ref.get().then(snap => {
        const commits = [];
        for (let i = 0; i < snap.docs.length; i += 400) {
            const batch = db.batch();
            snap.docs.slice(i, i + 400).forEach(doc => batch.delete(doc.ref));
            commits.push(batch.commit());
        }
        return Promise.all(commits);
    }).catch(err => {
        if (isPermissionDenied(err)) return null; // old rules: nothing can be stored there anyway
        throw err;
    });
}

// ---- Retry, status pill, leaving the page ----
function scheduleSyncRetry() {
    clearTimeout(journalSync.retryTimer);
    const delay = SYNC_RETRY_DELAYS_MS[Math.min(journalSync.retryIndex, SYNC_RETRY_DELAYS_MS.length - 1)];
    journalSync.retryIndex++;
    journalSync.retryTimer = setTimeout(retrySyncNow, delay);
}

function retrySyncNow() {
    clearTimeout(journalSync.retryTimer);
    if (journalSync.loadError) {
        retryJournalLoad();
        return;
    }
    if (journalSync.error) runJournalSync();
    Object.keys(userDocFields).forEach(field => {
        if (userDocFields[field].error) runUserDocFieldSave(field);
    });
}

function hasSyncProblem() {
    return !!(journalSync.loadError || journalSync.error || Object.values(userDocFields).some(f => f.error));
}

function hasUnsavedChanges() {
    return journalSync.dirty || journalSync.saving
        || Object.values(userDocFields).some(f => f.dirty || f.saving);
}

function describeSyncError(err) {
    const message = (err && err.message) || String(err || '');
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (offline || (err && err.code === 'unavailable')) return 'You\'re offline - your changes will save when you reconnect.';
    if (/maximum allowed size|exceeds the maximum|too large/i.test(message)) {
        return 'Not saved - your journal is too big for the single-document storage it\'s still using. It switches to split storage (no size limit) once the site\'s updated database rules are published.';
    }
    if (isPermissionDenied(err)) return 'Not saved - the database refused the change (permission denied).';
    return `Not saved - ${message}`;
}

function renderSyncStatus() {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('sync-status');
    if (!el) return;
    const fieldError = Object.values(userDocFields).map(f => f.error).find(Boolean);
    let kind = '';
    let text = '';
    let button = '';
    if (journalSync.loadError) {
        kind = 'error';
        text = 'Couldn\'t load your journal - nothing is saved until it loads.';
        button = '<button type="button" onclick="retryJournalLoad()">Retry</button>';
    } else if (journalSync.error || fieldError) {
        kind = 'error';
        text = describeSyncError(journalSync.error || fieldError);
        button = '<button type="button" onclick="retrySyncNow()">Retry now</button>';
    } else if (journalSync.waiting) {
        kind = 'info';
        text = 'Can\'t reach the server - your journal loads as soon as you\'re back online.';
    } else if (journalSync.slow) {
        kind = 'saving';
        text = 'Saving...';
    }
    el.style.display = text ? 'flex' : 'none';
    el.className = `sync-status${kind ? ` ${kind}` : ''}`;
    const icon = kind === 'saving' ? 'fa-rotate fa-spin' : kind === 'info' ? 'fa-wifi' : 'fa-triangle-exclamation';
    el.innerHTML = text ? `<i class="fa-solid ${icon}"></i><span>${escapeHtml(text)}</span>${button}` : '';
}

if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('online', () => {
        if (hasSyncProblem()) retrySyncNow();
    });
    window.addEventListener('beforeunload', event => {
        if (!hasUnsavedChanges()) return;
        event.preventDefault();
        event.returnValue = '';
    });
}
if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible' || !journalSync.uid) return;
        if (!userDocUnsubscribe && !journalSync.deleting) startUserDocListener(journalSync.uid);
        else if (hasSyncProblem()) retrySyncNow();
    });
}

// ---- Settings > Data & Storage ----
function currentStoragePanelVisible() {
    if (typeof document === 'undefined') return false;
    const panel = document.getElementById('settings-panel-storage');
    return !!panel && panel.style.display !== 'none';
}

function formatKb(bytes) {
    return `${Math.max(0, Math.round(bytes / 1024)).toLocaleString()} KB`;
}

function storageBarHtml(label, used, limit, note) {
    const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
    const level = pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : '';
    return `
        <div class="storage-meter">
            <div class="storage-meter-head"><span>${escapeHtml(label)}</span><span>${formatKb(used)} of ${formatKb(limit)}</span></div>
            <div class="storage-meter-track"><div class="storage-meter-fill ${level}" style="width:${pct.toFixed(1)}%"></div></div>
            ${note ? `<p class="settings-field-hint">${escapeHtml(note)}</p>` : ''}
        </div>`;
}

function renderStoragePanel() {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('storage-overview');
    if (!el) return;
    const accounts = Object.values(accountsState.accounts || {});
    const tradeCount = accounts.reduce((n, acc) => n + (acc.trades || []).length, 0);
    let shotCount = 0;
    let inlineShots = 0;
    accounts.forEach(acc => (acc.trades || []).forEach(t => (t.screenshots || []).forEach(s => {
        shotCount++;
        if (s && s.dataUrl && !journalSync.storedShots.has(s.id)) inlineShots++;
    })));
    const counts = `${accounts.length} account${accounts.length === 1 ? '' : 's'} &middot; ${tradeCount.toLocaleString()} trade${tradeCount === 1 ? '' : 's'} &middot; ${shotCount} screenshot${shotCount === 1 ? '' : 's'}`;
    const preUpgrade = document.getElementById('storage-preupgrade-box');

    if (!journalSync.uid) {
        let chars = 0;
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.indexOf('bb_') === 0) chars += key.length + (localStorage.getItem(key) || '').length;
            }
        } catch (e) { /* storage unavailable */ }
        el.innerHTML = `
            <p class="storage-mode"><i class="fa-solid fa-user-secret"></i> Guest mode - everything is kept in this browser only.</p>
            <p class="settings-field-hint">${counts}</p>
            ${storageBarHtml('This browser\'s storage', chars, 5 * 1024 * 1024, 'Browsers allow roughly 5 MB per site. Log in to keep your journal in the cloud instead.')}`;
        if (preUpgrade) preUpgrade.style.display = 'none';
        return;
    }

    const lastSaved = journalSync.lastSavedAt ? new Date(journalSync.lastSavedAt).toLocaleString() : null;
    let modeHtml;
    if (!journalSync.loaded) {
        modeHtml = '<p class="storage-mode"><i class="fa-solid fa-rotate fa-spin"></i> Loading...</p>';
    } else if (journalSync.mode === 'v2') {
        const journalBytes = Object.values(journalSync.index).reduce((n, e) => n + (e.len || 0), 0);
        const partCount = Object.values(journalSync.index).reduce((n, e) => n + (e.parts || 0), 0);
        modeHtml = `
            <p class="storage-mode ok"><i class="fa-solid fa-circle-check"></i> Split storage - your journal has no size limit.</p>
            <p class="settings-field-hint">Journal: ${formatKb(journalBytes)} in ${partCount} part${partCount === 1 ? '' : 's'}. Screenshots are stored one per document${inlineShots ? ` (${inlineShots} still uploading)` : ''}.</p>`;
    } else {
        modeHtml = `
            <p class="storage-mode${journalSync.v2Unavailable ? ' warn' : ''}"><i class="fa-solid fa-${journalSync.v2Unavailable ? 'triangle-exclamation' : 'database'}"></i> Single-document storage - your whole journal shares one 1 MB document.</p>
            ${journalSync.v2Unavailable ? '<p class="settings-field-hint">It upgrades to split storage (no size limit) automatically once the site\'s updated database rules are published.</p>' : ''}`;
    }
    el.innerHTML = `
        ${modeHtml}
        <p class="settings-field-hint">${counts}${lastSaved ? ` &middot; last saved ${escapeHtml(lastSaved)}` : ''}</p>
        ${storageBarHtml('Main document (settings, chart drawings' + (journalSync.mode === 'v2' ? '' : ', journal') + ')', journalSync.docBytes, MAIN_DOC_LIMIT_BYTES,
            journalSync.docBytes > MAIN_DOC_LIMIT_BYTES * 0.7 ? 'Getting full - saves fail once this reaches 100%.' : '')}`;
    if (preUpgrade) preUpgrade.style.display = journalSync.backupName ? 'block' : 'none';
}

function showStorageStatus(message, kind) {
    if (typeof showSettingsStatus === 'function') showSettingsStatus('storage-backup-status', message, kind);
}

function saveJsonFile(filename, value) {
    const blob = new Blob([JSON.stringify(value, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function backupFileDate() {
    return new Date().toISOString().slice(0, 10);
}

function downloadJournalBackup() {
    const includeShots = !!(document.getElementById('storage-backup-include-shots') || {}).checked;
    const backup = {
        app: 'Bullion Book',
        kind: 'journal-backup',
        format: 1,
        exportedAt: new Date().toISOString(),
        journal: cleanJournalState(accountsState),
        appSettings: syncClone(typeof appSettings !== 'undefined' ? appSettings : undefined),
        chartDrawings: syncClone(typeof chartToolsStore !== 'undefined' ? chartToolsStore : undefined)
    };
    if (!includeShots) {
        saveJsonFile(`bullion-book-backup-${backupFileDate()}.json`, backup);
        showStorageStatus('Backup downloaded (without screenshots).', 'success');
        return;
    }
    const ids = [];
    Object.values(backup.journal.accounts || {}).forEach(acc => (acc.trades || []).forEach(t =>
        (t.screenshots || []).forEach(s => { if (s && s.id && !s.dataUrl) ids.push(s.id); })));
    backup.screenshots = {};
    let done = 0;
    ids.reduce((chain, id) => chain.then(() => loadScreenshotDataUrl(id).then(url => {
        if (url) backup.screenshots[id] = url;
        done++;
        showStorageStatus(`Collecting screenshots ${done}/${ids.length}...`, '');
    })), Promise.resolve()).then(() => {
        saveJsonFile(`bullion-book-backup-${backupFileDate()}.json`, backup);
        const missing = ids.length - Object.keys(backup.screenshots).length;
        showStorageStatus(`Backup downloaded with screenshots${missing ? ` (${missing} couldn't be loaded)` : ''}.`, missing ? 'error' : 'success');
    });
}

function downloadPreUpgradeBackup() {
    const uid = journalSync.uid;
    const name = journalSync.backupName;
    if (!uid || !name) return;
    showStorageStatus('Fetching the pre-upgrade copy...', '');
    backupsRef(uid).get()
        .then(snap => {
            const docs = snap.docs.map(d => d.data()).filter(d => d.backup === name).sort((a, b) => a.n - b.n);
            const json = docs.map(d => d.json).join('');
            if (!docs.length || json.length !== docs[0].len || syncHash(json) !== docs[0].sum) throw new Error('the copy is incomplete');
            saveJsonFile(`bullion-book-pre-upgrade-${name.slice(7, 17)}.json`, {
                app: 'Bullion Book', kind: 'journal-backup', format: 1, exportedAt: new Date().toISOString(),
                note: docs[0].note, journal: JSON.parse(json)
            });
            showStorageStatus('Pre-upgrade copy downloaded.', 'success');
        })
        .catch(err => showStorageStatus(`Couldn't download it: ${err.message}`, 'error'));
}

// Ids end up inside onclick="...('id')" handlers all over the app, so a
// backup file can only be restored if every id is a plain token - a crafted
// file must not be able to plant script in the journal.
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

function backupIdsAreSafe(value, key) {
    if (Array.isArray(value)) {
        const isIdList = key === 'tagIds';
        return value.every(item => (isIdList ? (typeof item === 'string' && SAFE_ID.test(item)) : backupIdsAreSafe(item, '')));
    }
    if (syncIsObject(value)) {
        return Object.keys(value).every(k => {
            const v = value[k];
            if ((k === 'id' || /Id$/.test(k)) && v !== null && v !== undefined && v !== '') {
                if (!(typeof v === 'string' || typeof v === 'number') || !SAFE_ID.test(String(v))) return false;
            }
            if (k === 'dataUrl' && v !== undefined && !isScreenshotDataUrl(v)) return false;
            return backupIdsAreSafe(v, k);
        });
    }
    return true;
}

function validateJournalBackup(backup) {
    const journal = backup && backup.kind === 'journal-backup' ? backup.journal : null;
    if (!journal || !syncIsObject(journal.accounts) || Object.keys(journal.accounts).length === 0) {
        return 'That isn\'t a Bullion Book backup file.';
    }
    const ok = Object.keys(journal.accounts).every(id => {
        const acc = journal.accounts[id];
        return SAFE_ID.test(id) && syncIsObject(acc) && acc.id === id && typeof acc.name === 'string'
            && (acc.trades === undefined || Array.isArray(acc.trades));
    });
    if (!ok || !backupIdsAreSafe(journal, '')) return 'That backup file is damaged or has been edited - it can\'t be restored.';
    const shots = backup.screenshots;
    if (shots !== undefined && (!syncIsObject(shots) || !Object.keys(shots).every(id => SAFE_ID.test(id) && isScreenshotDataUrl(shots[id])))) {
        return 'The screenshots in that backup file are damaged.';
    }
    return null;
}

function handleJournalBackupFile(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        let backup = null;
        try { backup = JSON.parse(reader.result); } catch (e) { /* handled below */ }
        const problem = backup ? validateJournalBackup(backup) : 'That file isn\'t valid JSON.';
        if (problem) {
            showStorageStatus(problem, 'error');
            return;
        }
        const accounts = Object.values(backup.journal.accounts);
        const trades = accounts.reduce((n, acc) => n + (acc.trades || []).length, 0);
        const when = backup.exportedAt ? new Date(backup.exportedAt).toLocaleString() : 'an unknown date';
        showConfirmDialog({
            title: 'Restore this backup?',
            body: `Replace your whole journal (every account) with the backup from ${when} - ${accounts.length} account${accounts.length === 1 ? '' : 's'}, ${trades} trade${trades === 1 ? '' : 's'}? If you might need your current journal, download a backup of it first.`,
            confirmText: 'Yes, restore it',
            onConfirm: () => restoreJournalBackup(backup)
        });
    };
    reader.readAsText(file);
}

function restoreJournalBackup(backup) {
    const journal = cleanJournalState(backup.journal);
    const shots = backup.screenshots || {};
    Object.values(journal.accounts).forEach(acc => (acc.trades || []).forEach(t => (t.screenshots || []).forEach(s => {
        if (s && !s.dataUrl && shots[s.id]) s.dataUrl = shots[s.id];
    })));
    accountsState = journal;
    if (!accountsState.accounts[accountsState.activeAccountId]) accountsState.activeAccountId = Object.keys(accountsState.accounts)[0];
    if (typeof labelNextTradeChange === 'function') labelNextTradeChange(`Restored a backup from ${backup.exportedAt ? backup.exportedAt.slice(0, 10) : 'file'}`);
    saveAccountsState();
    if (syncIsObject(backup.appSettings) && typeof applyRemoteSettings === 'function') {
        applyRemoteSettings(backup.appSettings);
        if (typeof saveAppSettings === 'function') saveAppSettings();
    }
    if (syncIsObject(backup.chartDrawings) && typeof applyRemoteChartDrawings === 'function') {
        applyRemoteChartDrawings(backup.chartDrawings);
        if (typeof saveChartToolsStore === 'function') saveChartToolsStore();
    }
    if (typeof renderSidebarAccount === 'function') renderSidebarAccount();
    if (typeof refreshActivePageForAccountChange === 'function') refreshActivePageForAccountChange();
    showStorageStatus('Backup restored.', 'success');
}
