// In-memory stand-in for the Firestore compat API - only what sync.js and
// friends use: documents + subcollections, get/set/update/delete, set options
// (merge / mergeFields), batches, transactions (re-run when a document they
// read changed before commit, like the real SDK) and onSnapshot listeners.
//
// It behaves like the real thing where the app's safety depends on it:
//   - an `undefined` value anywhere throws synchronously (verified against the
//     real 10.12.2 SDK: set() throws "Unsupported field value: undefined")
//   - documents over 1 MiB are rejected, with Firestore's own error message
//   - `oldRules: true` refuses every subcollection read/write, like the rules
//     that only allowed users/{uid}; otherwise the new rules' guard against
//     an out-of-date app overwriting a split journal is applied
//   - maps come back with sorted keys, as Firestore returns them
//   - offline: transactions fail with 'unavailable', listeners report a
//     cached "document doesn't exist" (fromCache) until back online
const MAX_DOC_BYTES = 1048576;

function fsError(code, message) {
    const err = new Error(message);
    err.code = code;
    return err;
}

function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function checkNoUndefined(value, where) {
    if (value === undefined) throw fsError('invalid-argument', `Function DocumentReference.set() called with invalid data. Unsupported field value: undefined (found in field ${where})`);
    if (Array.isArray(value)) value.forEach((v, i) => checkNoUndefined(v, `${where}.${i}`));
    else if (isPlainObject(value)) Object.keys(value).forEach(k => checkNoUndefined(value[k], `${where}.${k}`));
}

function sortedClone(value) {
    if (Array.isArray(value)) return value.map(sortedClone);
    if (isPlainObject(value)) {
        const out = {};
        Object.keys(value).sort().forEach(k => { out[k] = sortedClone(value[k]); });
        return out;
    }
    return value;
}

function utf8(str) {
    return Buffer.byteLength(str, 'utf8');
}

// Firestore's documented storage-size rules
function valueSize(v) {
    if (v === null || typeof v === 'boolean') return 1;
    if (typeof v === 'number') return 8;
    if (typeof v === 'string') return utf8(v) + 1;
    if (Array.isArray(v)) return v.reduce((n, x) => n + valueSize(x), 0);
    return Object.keys(v).reduce((n, k) => n + utf8(k) + 1 + valueSize(v[k]), 0);
}

function docSize(path, data) {
    return path.split('/').reduce((n, seg) => n + utf8(seg) + 1, 0) + 16 + valueSize(data) + 32;
}

function setPath(obj, fieldPath, value) {
    const keys = fieldPath.split('.');
    let cur = obj;
    keys.slice(0, -1).forEach(k => {
        if (!isPlainObject(cur[k])) cur[k] = {};
        cur = cur[k];
    });
    cur[keys[keys.length - 1]] = value;
}

function getPath(obj, fieldPath) {
    return fieldPath.split('.').reduce((cur, k) => (cur && Object.prototype.hasOwnProperty.call(cur, k) ? cur[k] : undefined), obj);
}

function deepMerge(target, source) {
    Object.keys(source).forEach(k => {
        if (isPlainObject(source[k]) && isPlainObject(target[k])) deepMerge(target[k], source[k]);
        else target[k] = sortedClone(source[k]);
    });
    return target;
}

function applySet(existing, data, options) {
    const base = existing ? JSON.parse(JSON.stringify(existing)) : {};
    if (options && options.mergeFields) {
        options.mergeFields.forEach(fp => {
            const v = getPath(data, fp);
            if (v === undefined) throw fsError('invalid-argument', `Field "${fp}" is specified in your field mask but missing from your input data.`);
            setPath(base, fp, sortedClone(v));
        });
        return sortedClone(base);
    }
    if (options && options.merge) return sortedClone(deepMerge(base, data));
    return sortedClone(data);
}

class DocSnapshot {
    constructor(ref, data, fromCache) {
        this.ref = ref;
        this.id = ref.id;
        this.exists = data !== undefined;
        this._data = data;
        this.metadata = { fromCache: !!fromCache, hasPendingWrites: false };
    }
    data() { return this._data === undefined ? undefined : JSON.parse(JSON.stringify(this._data)); }
}

class DocRef {
    constructor(db, path) {
        this._db = db;
        this.path = path;
        this.id = path.split('/').pop();
    }
    collection(name) { return new CollectionRef(this._db, `${this.path}/${name}`); }
    get() { return this._db._get(this); }
    set(data, options) { checkNoUndefined(data, this.path); return this._db._commit([{ op: 'set', ref: this, data, options }]); }
    update(data) { checkNoUndefined(data, this.path); return this._db._commit([{ op: 'update', ref: this, data }]); }
    delete() { return this._db._commit([{ op: 'delete', ref: this }]); }
    onSnapshot(a, b, c) {
        const [onNext, onError] = typeof a === 'function' ? [a, b] : [b, c];
        return this._db._listen(this, onNext, onError);
    }
}

class CollectionRef {
    constructor(db, path) {
        this._db = db;
        this.path = path;
    }
    doc(id) { return new DocRef(this._db, `${this.path}/${id || this._db._autoId()}`); }
    add(data) { const ref = this.doc(); return ref.set(data).then(() => ref); }
    get() {
        return this._db._async(() => {
            this._db._checkRead(this.path + '/x');
            const prefix = `${this.path}/`;
            const docs = [];
            this._db.docs.forEach((data, path) => {
                if (path.indexOf(prefix) === 0 && path.slice(prefix.length).indexOf('/') < 0) {
                    docs.push(new DocSnapshot(new DocRef(this._db, path), data, false));
                }
            });
            docs.sort((x, y) => (x.id < y.id ? -1 : 1));
            return { docs, size: docs.length, empty: docs.length === 0, forEach: fn => docs.forEach(fn) };
        });
    }
}

class FakeFirestore {
    constructor(options) {
        this.docs = new Map();
        this.versions = new Map();
        this.listeners = [];
        this.oldRules = !!(options && options.oldRules);
        this.offline = false;
        this.authUid = (options && options.authUid) || null;
        this.failReads = null;      // path -> error (simulated read failures)
        this.beforeCommit = null;   // one-shot hook: another device writes mid-transaction
        this.commits = 0;
        this.writeLog = [];
        this._ids = 0;
    }

    collection(name) { return new CollectionRef(this, name); }

    batch() {
        const ops = [];
        const batch = {
            set: (ref, data, options) => { checkNoUndefined(data, ref.path); ops.push({ op: 'set', ref, data, options }); return batch; },
            update: (ref, data) => { checkNoUndefined(data, ref.path); ops.push({ op: 'update', ref, data }); return batch; },
            delete: ref => { ops.push({ op: 'delete', ref }); return batch; },
            commit: () => this._commit(ops)
        };
        return batch;
    }

    runTransaction(fn) {
        const attempt = n => {
            const reads = new Map();
            const ops = [];
            const tx = {
                get: ref => {
                    if (this.offline) return Promise.reject(fsError('unavailable', 'Failed to get document because the client is offline.'));
                    try { this._checkRead(ref.path); } catch (e) { return Promise.reject(e); }
                    reads.set(ref.path, this.versions.get(ref.path) || 0);
                    return Promise.resolve(new DocSnapshot(ref, this._read(ref.path), false));
                },
                set: (ref, data, options) => { checkNoUndefined(data, ref.path); ops.push({ op: 'set', ref, data, options }); return tx; },
                update: (ref, data) => { checkNoUndefined(data, ref.path); ops.push({ op: 'update', ref, data }); return tx; },
                delete: ref => { ops.push({ op: 'delete', ref }); return tx; }
            };
            return Promise.resolve().then(() => fn(tx)).then(result => {
                if (this.beforeCommit) {
                    const hook = this.beforeCommit;
                    this.beforeCommit = null;
                    hook();
                }
                for (const [path, version] of reads) {
                    if ((this.versions.get(path) || 0) !== version) {
                        if (n >= 4) throw fsError('aborted', 'Transaction failed: too much contention');
                        return attempt(n + 1);
                    }
                }
                return this._applyNow(ops).then(() => result);
            });
        };
        return attempt(0);
    }

    // ---- test controls ----
    goOnline() {
        this.offline = false;
        this.listeners.forEach(l => { if (l.active && l.pendingServer) { l.pendingServer = false; this._deliver(l); } });
    }

    raw(path) { return this._read(path); }

    paths(prefix) { return Array.from(this.docs.keys()).filter(p => p.indexOf(prefix) === 0).sort(); }

    // A write by "something else" (another device, an old copy of the app)
    // that bypasses the app's own code, but still goes through the rules
    rawWrite(path, data, options) { return this._applyNow([{ op: 'set', ref: new DocRef(this, path), data, options }]); }

    // ---- internals ----
    _autoId() { this._ids += 1; return `auto${String(this._ids).padStart(16, '0')}`; }

    _async(fn) {
        return new Promise((resolve, reject) => setImmediate(() => {
            try { resolve(fn()); } catch (e) { reject(e); }
        }));
    }

    _read(path) {
        const d = this.docs.get(path);
        return d === undefined ? undefined : JSON.parse(JSON.stringify(d));
    }

    _uidOf(path) { return path.split('/')[1]; }

    _checkRead(path) {
        if (this.failReads && this.failReads[path]) throw this.failReads[path];
        if (this.offline) throw fsError('unavailable', 'Failed to get document because the client is offline.');
        const parts = path.split('/');
        if (parts[0] === 'users') {
            if (this.authUid !== parts[1]) throw fsError('permission-denied', 'Missing or insufficient permissions.');
            if (parts.length > 2 && this.oldRules) throw fsError('permission-denied', 'Missing or insufficient permissions.');
        }
    }

    _checkWrite(path, before, after) {
        const parts = path.split('/');
        if (parts[0] !== 'users') return;
        if (this.authUid !== parts[1]) throw fsError('permission-denied', 'Missing or insufficient permissions.');
        if (parts.length > 2 && this.oldRules) throw fsError('permission-denied', 'Missing or insufficient permissions.');
        if (parts.length === 2 && !this.oldRules && before && after) {
            const version = d => (d && d.bullionStorage && d.bullionStorage.version) || 1;
            const same = JSON.stringify(sortedClone(before.bullionAccounts === undefined ? null : before.bullionAccounts))
                === JSON.stringify(sortedClone(after.bullionAccounts === undefined ? null : after.bullionAccounts));
            if (version(before) >= 2 && version(after) >= 2 && !same) {
                throw fsError('permission-denied', 'Missing or insufficient permissions.');
            }
        }
    }

    _get(ref) {
        return this._async(() => {
            this._checkRead(ref.path);
            return new DocSnapshot(ref, this._read(ref.path), false);
        });
    }

    _commit(ops) {
        return new Promise((resolve, reject) => setImmediate(() => {
            if (this.offline) {
                reject(fsError('unavailable', 'The client is offline.'));
                return;
            }
            this._applyNow(ops).then(resolve, reject);
        }));
    }

    _applyNow(ops) {
        try {
            const staged = new Map();
            const current = path => (staged.has(path) ? staged.get(path) : this._read(path));
            ops.forEach(({ op, ref, data, options }) => {
                const before = current(ref.path);
                let after;
                if (op === 'delete') after = undefined;
                else if (op === 'update') {
                    if (before === undefined) throw fsError('not-found', `No document to update: ${ref.path}`);
                    after = JSON.parse(JSON.stringify(before));
                    Object.keys(data).forEach(fp => setPath(after, fp, sortedClone(data[fp])));
                    after = sortedClone(after);
                } else after = applySet(before, data, options);
                if (after !== undefined) {
                    const size = docSize(ref.path, after);
                    if (size > MAX_DOC_BYTES) {
                        throw fsError('invalid-argument', `Document '${ref.path}' cannot be written because its size (${size.toLocaleString('en-US')} bytes) exceeds the maximum allowed size of 1,048,576 bytes.`);
                    }
                }
                this._checkWrite(ref.path, this._read(ref.path), after);
                staged.set(ref.path, after);
            });
            staged.forEach((after, path) => {
                if (after === undefined) this.docs.delete(path);
                else this.docs.set(path, after);
                this.versions.set(path, (this.versions.get(path) || 0) + 1);
                this.writeLog.push(path);
            });
            this.commits += 1;
            const touched = new Set(staged.keys());
            this.listeners.forEach(l => { if (l.active && touched.has(l.ref.path)) this._deliverSoon(l); });
            return Promise.resolve();
        } catch (e) {
            return Promise.reject(e);
        }
    }

    _listen(ref, onNext, onError) {
        const l = { ref, onNext, onError, active: true, pendingServer: false };
        this.listeners.push(l);
        setImmediate(() => {
            if (!l.active) return;
            if (this.failReads && this.failReads[ref.path]) {
                l.active = false;
                if (onError) onError(this.failReads[ref.path]);
                return;
            }
            if (this.offline) {
                // What the real SDK does with an empty cache while offline
                l.pendingServer = true;
                onNext(new DocSnapshot(ref, undefined, true));
                return;
            }
            this._deliver(l);
        });
        return () => { l.active = false; };
    }

    _deliverSoon(l) {
        setImmediate(() => { if (l.active && !this.offline) this._deliver(l); });
    }

    _deliver(l) {
        try {
            this._checkRead(l.ref.path);
        } catch (e) {
            l.active = false;
            if (l.onError) l.onError(e);
            return;
        }
        l.onNext(new DocSnapshot(l.ref, this._read(l.ref.path), false));
    }
}

module.exports = { FakeFirestore, fsError, docSize, MAX_DOC_BYTES };
