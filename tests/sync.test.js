// Saving, loading and multi-device sync of the journal (sync.js + accounts.js)
// against an in-memory Firestore (tests/fake-firestore.js). Each "device" is
// its own sandbox running the real files; two devices can share one database.
const { FakeFirestore, fsError } = require('./fake-firestore');

module.exports = (h) => {
    const { test, assert, assertEqual, makeSandbox, fakeElement, loadInto, run, makeClock, settle } = h;

    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    function trade(id, extra) {
        return Object.assign({
            id, symbol: 'XAUUSD', target: '', stopLoss: '', journal: '', tagIds: [],
            legs: [
                { id: `${id}a`, action: 'buy', datetime: '2026-10-29T10:00', quantity: 0.1, price: 2400, fee: 0 },
                { id: `${id}b`, action: 'sell', datetime: '2026-10-29T10:30', quantity: 0.1, price: 2410, fee: 0 }
            ]
        }, extra || {});
    }

    function journal(trades, extra) {
        return {
            activeAccountId: 'acc1',
            accounts: { acc1: Object.assign({ id: 'acc1', name: 'Live', transactions: [{ id: 'tx1', type: 'deposit', amount: 1000, date: '2026-01-01' }], trades }, extra || {}) }
        };
    }

    // One browser running the app, signed in as uid (or a guest when uid is null)
    function device(db, uid, clock, opts) {
        const toasts = [];
        const authCallbacks = [];
        const user = uid ? { uid, metadata: { lastSignInTime: new Date(clock.now()).toUTCString() } } : null;
        const sb = makeSandbox({
            setTimeout: clock.setTimeout,
            clearTimeout: clock.clearTimeout,
            auth: { currentUser: user, onAuthStateChanged(cb) { authCallbacks.push(cb); } },
            db,
            navigator: { onLine: true },
            communityToast: (message, isError) => toasts.push({ message, isError: !!isError })
        });
        sb.__clockNow = clock.now;
        run(sb, 'Date.now = () => __clockNow()');
        sb._elements['sync-status'] = fakeElement();
        loadInto(sb, ['accounts.js', 'sync.js']);
        // Small stand-ins for settings.js / chart-tools.js
        run(sb, `
            var appSettings = { theme: 'slate', defaultSymbol: '' };
            function applyLoadedSettings(saved) { if (saved) appSettings = Object.assign({}, appSettings, saved); }
            function applyRemoteSettings(merged) { appSettings = Object.assign({}, appSettings, merged); }
        `);
        if (!(opts && opts.lateCharts)) run(sb, CHART_STUBS);
        if (opts && opts.setup) opts.setup(sb);
        const dev = {
            sb, toasts, clock,
            start: async () => {
                run(sb, 'initAccounts()');
                authCallbacks.forEach(cb => cb(user));
                await settle(clock);
            },
            flush: ms => settle(clock, ms === undefined ? 400 : ms),
            js: code => run(sb, code),
            state: () => JSON.parse(run(sb, 'JSON.stringify(accountsState)')),
            trades: () => JSON.parse(run(sb, 'JSON.stringify(getActiveAccount().trades)')),
            status: () => sb._elements['sync-status'].innerHTML,
            save: async code => {
                run(sb, code);
                run(sb, 'saveAccountsState()');
                await settle(clock, 400);
            }
        };
        return dev;
    }

    // Stand-in for chart-tools.js's part
    const CHART_STUBS = `
        var chartToolsStore = {};
        function applyLoadedChartDrawings(saved) { chartToolsStore = saved || {}; }
        function applyRemoteChartDrawings(merged) { chartToolsStore = merged; }
    `;

    function partsJson(db, uid) {
        return db.paths(`users/${uid}/journalParts/`).map(p => db.raw(p).json).join('');
    }

    function serverJournal(db, uid) {
        const main = db.raw(`users/${uid}`);
        const index = main.bullionStorage.accounts;
        const accounts = {};
        Object.keys(index).forEach(id => {
            let json = '';
            for (let n = 0; n < index[id].parts; n++) json += db.raw(`users/${uid}/journalParts/${id}_${n}`).json;
            accounts[id] = JSON.parse(json);
        });
        return accounts;
    }

    // ---- pure helpers -------------------------------------------------------

    test('sync: merge keeps changes from both sides, item by item', () => {
        const clock = makeClock();
        const d = device(new FakeFirestore(), null, clock);
        d.sb.__m = { base: null, local: null, remote: null };
        const merge = (base, local, remote) => {
            d.sb.__m = { base, local, remote };
            return JSON.parse(run(d.sb, 'JSON.stringify(mergeJournalValues(__m.base, __m.local, __m.remote))') || 'null');
        };
        const base = { trades: [{ id: 'a', tags: ['x'], note: '' }, { id: 'b', note: '' }] };
        // different trades edited on each side
        assertEqual(merge(base,
            { trades: [{ id: 'a', tags: ['x'], note: 'local' }, { id: 'b', note: '' }] },
            { trades: [{ id: 'a', tags: ['x'], note: '' }, { id: 'b', note: 'remote' }] }),
            { trades: [{ id: 'a', tags: ['x'], note: 'local' }, { id: 'b', note: 'remote' }] }, 'both edits kept');
        // additions on both sides, a deletion on one
        assertEqual(merge(base,
            { trades: [{ id: 'a', tags: ['x'], note: '' }, { id: 'b', note: '' }, { id: 'c' }] },
            { trades: [{ id: 'a', tags: ['x'], note: '' }, { id: 'd' }] }),
            { trades: [{ id: 'a', tags: ['x'], note: '' }, { id: 'c' }, { id: 'd' }] }, 'adds from both, remote delete of b');
        // string lists merge as sets
        assertEqual(merge(['x', 'y'], ['x', 'y', 'L'], ['y', 'R']), ['y', 'L', 'R'], 'tag ids: remote removed x, both added');
        // the very same field changed on both: this device wins
        assertEqual(merge({ n: 1 }, { n: 2 }, { n: 3 }), { n: 2 }, 'local wins a true conflict');
        // key order differences are not changes
        assertEqual(merge({ a: 1, b: 2 }, { b: 2, a: 1 }, { a: 1, b: 3 }), { a: 1, b: 3 }, 'reordered keys are equal');
    });

    test('sync: split parts respect the byte limit and never cut an emoji in half', () => {
        const clock = makeClock();
        const d = device(new FakeFirestore(), null, clock);
        d.sb.__s = 'ab' + '📈'.repeat(10) + 'é日'.repeat(5) + 'z';
        const pieces = JSON.parse(run(d.sb, 'JSON.stringify(syncSplitUtf8(__s, 7))'));
        assertEqual(pieces.join(''), d.sb.__s, 'pieces rejoin to the original');
        pieces.forEach(p => {
            assert(Buffer.byteLength(p, 'utf8') <= 7, `piece over limit: ${Buffer.byteLength(p, 'utf8')}`);
            assert(!/[\uD800-\uDBFF]$/.test(p) && !/^[\uDC00-\uDFFF]/.test(p), 'split inside a surrogate pair');
        });
        assertEqual(run(d.sb, 'syncUtf8Bytes(__s)'), Buffer.byteLength(d.sb.__s, 'utf8'), 'byte count matches Node');
    });

    // ---- loading safely -----------------------------------------------------

    test('sync: a brand-new user gets split storage straight away (new rules)', async () => {
        const clock = makeClock();
        const db = new FakeFirestore({ authUid: 'u1' });
        const a = device(db, 'u1', clock);
        await a.start();
        await a.flush();
        const main = db.raw('users/u1');
        assert(main && main.bullionStorage && main.bullionStorage.version === 2, 'stored as v2');
        assert(main.bullionAccounts.movedToV2 === true, 'old-format field holds only the reload stub');
        assertEqual(db.paths('users/u1/journalParts/').length, 1, 'one part for one small account');
        assertEqual(Object.keys(a.state().accounts).length, 1, 'one default account');
        assertEqual(db.paths('users/u1/backups/').length, 0, 'nothing to back up for a new user');
    });

    test('sync: with the old rules everything stays in the single document', async () => {
        const clock = makeClock();
        const db = new FakeFirestore({ authUid: 'u1', oldRules: true });
        await db.rawWrite('users/u1', { bullionAccounts: journal([trade('t1')]) });
        const a = device(db, 'u1', clock);
        await a.start();
        await a.flush();
        assert(a.js('journalSync.v2Unavailable') === true, 'noticed the subcollections are refused');
        await a.save('getActiveAccount().trades.push(' + JSON.stringify(trade('t2')) + ')');
        const main = db.raw('users/u1');
        assertEqual(main.bullionAccounts.accounts.acc1.trades.map(t => t.id), ['t1', 't2'], 'saved inline');
        assertEqual(main.bullionStorage, { rev: 1, savedAt: main.bullionStorage.savedAt, version: 1 }, 'revision tracked');
        assertEqual(db.paths('users/u1/').filter(p => p.split('/').length > 2), [], 'no subcollection writes');
        assert(a.status() === '', 'no error shown');
    });

    test('sync: a failed load never saves an empty journal over the real one', async () => {
        const clock = makeClock();
        const db = new FakeFirestore({ authUid: 'u1' });
        await db.rawWrite('users/u1', { bullionAccounts: journal([trade('t1'), trade('t2')]) });
        db.failReads = { 'users/u1': fsError('unavailable', 'Could not reach Cloud Firestore backend.') };
        const commitsBefore = db.commits;
        const a = device(db, 'u1', clock);
        await a.start();
        await a.flush();
        assert(a.status().indexOf('load your journal') >= 0, 'load error shown on screen');
        a.js('getActiveAccount && accountsState.accounts.x');
        await a.save('void 0');
        assertEqual(db.commits, commitsBefore, 'nothing was written');
        assert(a.toasts.some(t => t.message.indexOf('finished loading') >= 0), 'told the change was not saved');
        // Connection back: Retry loads the real journal
        db.failReads = null;
        a.js('retryJournalLoad()');
        await a.flush();
        assertEqual(a.trades().map(t => t.id), ['t1', 't2'], 'real journal loaded');
        assert(a.status() === '', 'error cleared');
    });

    test('sync: offline at startup waits instead of treating the cached "no document" as a new user', async () => {
        const clock = makeClock();
        const db = new FakeFirestore({ authUid: 'u1' });
        await db.rawWrite('users/u1', { bullionAccounts: journal([trade('t1')]) });
        db.offline = true;
        const commitsBefore = db.commits;
        const a = device(db, 'u1', clock);
        await a.start();
        await a.flush(7000);
        assertEqual(Object.keys(a.state().accounts).length, 0, 'no default account invented');
        assertEqual(db.commits, commitsBefore, 'nothing written while offline');
        assert(a.status().indexOf('back online') >= 0, 'offline notice shown');
        db.goOnline();
        await a.flush();
        assertEqual(a.trades().map(t => t.id), ['t1'], 'real journal loaded once online');
    });

    test('sync: a damaged part is reported, not loaded or overwritten', async () => {
        const clock = makeClock();
        const db = new FakeFirestore({ authUid: 'u1' });
        const a = device(db, 'u1', clock);
        await db.rawWrite('users/u1', { bullionAccounts: journal([trade('t1')]) });
        await a.start();
        await a.flush();
        const part = db.paths('users/u1/journalParts/')[0];
        await db.rawWrite(part, { json: db.raw(part).json.replace('XAUUSD', 'XAGUSD') }, { merge: true });
        const commitsBefore = db.commits;
        const b = device(db, 'u1', clock);
        await b.start();
        await b.flush();
        assert(b.status().indexOf('load your journal') >= 0, 'error shown');
        await b.save('void 0');
        assertEqual(db.commits, commitsBefore, 'the damaged journal was not overwritten');
    });

    // ---- the upgrade ----------------------------------------------------------

    test('sync: a single-document journal upgrades itself, with a backup, screenshots split out', async () => {
        const clock = makeClock();
        const db = new FakeFirestore({ authUid: 'u1' });
        const original = journal([trade('t1', { screenshots: [{ id: 's1', dataUrl: PNG }] }), trade('t2')],
            { csvImportUndo: { trades: [trade('old')], meta: null }, csvImportMeta: { filename: 'a.csv', tradeCount: 2 } });
        await db.rawWrite('users/u1', { bullionAccounts: original, appSettings: { theme: 'midnight' } });
        const a = device(db, 'u1', clock);
        await a.start();
        await a.flush();

        const main = db.raw('users/u1');
        assertEqual(main.bullionStorage.version, 2, 'upgraded');
        assert(main.bullionAccounts.movedToV2, 'stub left for out-of-date copies of the app');
        assertEqual(main.appSettings, { theme: 'midnight' }, 'settings untouched');
        const backupParts = db.paths('users/u1/backups/');
        assert(backupParts.length >= 1, 'backup written');
        a.sb.__backup = JSON.parse(backupParts.map(p => db.raw(p).json).join(''));
        a.sb.__original = original;
        assert(a.js('syncEqual(__backup, __original)'), 'backup is exactly the old journal (undo copy included)');
        assertEqual(db.raw('users/u1/screenshots/s1').dataUrl, PNG, 'screenshot moved to its own document');
        const json = partsJson(db, 'u1');
        assert(json.indexOf('data:image') < 0, 'no image data inside the journal parts');
        assert(json.indexOf('csvImportUndo') < 0, 'old undo copy dropped');

        // Another device loads the split journal
        const b = device(db, 'u1', clock);
        await b.start();
        await b.flush();
        const expected = JSON.parse(JSON.stringify(original.accounts.acc1));
        delete expected.csvImportUndo;
        expected.trades[0].screenshots = [{ id: 's1' }];
        b.sb.__expected = expected;
        assert(b.js('syncEqual(getActiveAccount(), __expected)'), 'second device sees the same journal');
        const url = await b.js("loadScreenshotDataUrl('s1')");
        assertEqual(url, PNG, 'screenshot loads on demand');
    });

    test('sync: a big journal (2,500 trades, emoji and accents) splits and reloads exactly', async () => {
        const clock = makeClock();
        const db = new FakeFirestore({ authUid: 'u1' });
        const trades = [];
        for (let i = 0; i < 2500; i++) {
            trades.push(trade(`t${i}`, { journal: `Trade ${i}: London open café ☕ 📈 – 日本 ${'x'.repeat(i % 50)}`, tagIds: ['tagA', `tag${i % 7}`] }));
        }
        const a = device(db, 'u1', clock);
        await a.start();
        await a.flush();
        a.sb.__trades = trades;
        await a.save('getActiveAccount().trades = __trades');
        const partPaths = db.paths('users/u1/journalParts/');
        assert(partPaths.length >= 2, `expected several parts, got ${partPaths.length}`);
        partPaths.forEach(p => assert(Buffer.byteLength(db.raw(p).json, 'utf8') <= 900000, `${p} over 900 KB`));
        const b = device(db, 'u1', clock);
        await b.start();
        await b.flush();
        b.sb.__trades = trades;
        assert(b.js('syncEqual(getActiveAccount().trades, __trades)'), 'identical after reload');
        assert(a.status() === '' && b.status() === '', 'no errors');
    });

    test('sync: single-document storage that fills up shows the error and keeps the change', async () => {
        const clock = makeClock();
        const db = new FakeFirestore({ authUid: 'u1', oldRules: true });
        await db.rawWrite('users/u1', { bullionAccounts: journal([trade('t1')]) });
        const a = device(db, 'u1', clock);
        await a.start();
        await a.flush();
        const big = [];
        for (let i = 0; i < 2600; i++) big.push(trade(`b${i}`, { journal: 'n'.repeat(400) }));
        a.sb.__big = big;
        await a.save('getActiveAccount().trades = getActiveAccount().trades.concat(__big)');
        assert(a.status().indexOf('too big') >= 0, `size error shown, got: ${a.status()}`);
        assert(a.js('journalSync.dirty') === true, 'still marked unsaved (will retry)');
        assertEqual(a.trades().length, 2601, 'change kept in memory');
        assertEqual(db.raw('users/u1').bullionAccounts.accounts.acc1.trades.length, 1, 'server copy untouched');
    });

    // ---- two devices --------------------------------------------------------

    async function twoDevices(trades, opts) {
        const clock = makeClock();
        const db = new FakeFirestore({ authUid: 'u1', oldRules: !!(opts && opts.oldRules) });
        await db.rawWrite('users/u1', { bullionAccounts: journal(trades || [trade('t1'), trade('t2')]) });
        const a = device(db, 'u1', clock);
        await a.start();
        await a.flush();
        const b = device(db, 'u1', clock);
        await b.start();
        await b.flush();
        return { clock, db, a, b };
    }

    // Both devices change something before either has seen the other's save
    async function bothSave(env, codeA, codeB) {
        env.a.js(codeA);
        env.a.js('saveAccountsState()');
        env.b.js(codeB);
        env.b.js('saveAccountsState()');
        await settle(env.clock, 400);
        await settle(env.clock, 400);
    }

    test('sync: phone and PC editing different trades - both edits survive', async () => {
        const env = await twoDevices();
        // Count conflict merges, to prove this really took the "someone else
        // saved first" path rather than B just receiving A's update in time
        env.b.js('var __pulls = 0; const __pull = pullRemoteJournal; pullRemoteJournal = (...a) => { __pulls++; return __pull(...a); };');
        await bothSave(env,
            "getActiveAccount().trades.find(t => t.id === 't1').tagIds = ['A-setup']",
            "getActiveAccount().trades.find(t => t.id === 't2').journal = 'from the phone'");
        const server = serverJournal(env.db, 'u1').acc1.trades;
        assertEqual(server.find(t => t.id === 't1').tagIds, ['A-setup'], 'PC edit on the server');
        assertEqual(server.find(t => t.id === 't2').journal, 'from the phone', 'phone edit on the server');
        env.a.sb.__b = env.b.state().accounts;
        assert(env.a.js('syncEqual(accountsState.accounts, __b)'), 'both devices show the same journal');
        assert(env.a.status() === '' && env.b.status() === '', 'no errors');
        assertEqual(env.b.js('__pulls'), 1, 'B detected A\'s save and merged once');
    });

    test('sync: same trade, different fields - both changes kept', async () => {
        const env = await twoDevices();
        await bothSave(env,
            "getActiveAccount().trades.find(t => t.id === 't1').tagIds = ['A-setup']",
            "getActiveAccount().trades.find(t => t.id === 't1').journal = 'waited for the retest'");
        const t1 = serverJournal(env.db, 'u1').acc1.trades.find(t => t.id === 't1');
        assertEqual([t1.tagIds, t1.journal], [['A-setup'], 'waited for the retest'], 'merged field by field');
    });

    test('sync: same field on both - the later save wins, and both devices agree', async () => {
        const env = await twoDevices();
        await bothSave(env,
            "getActiveAccount().trades[0].journal = 'from A'",
            "getActiveAccount().trades[0].journal = 'from B'");
        assertEqual(serverJournal(env.db, 'u1').acc1.trades[0].journal, 'from B', 'server');
        assertEqual(env.a.trades()[0].journal, 'from B', 'device A updated');
        assertEqual(env.b.trades()[0].journal, 'from B', 'device B');
    });

    test('sync: adding trades on both devices at once keeps all of them', async () => {
        const env = await twoDevices();
        await bothSave(env,
            'getActiveAccount().trades.push(' + JSON.stringify(trade('fromA')) + ')',
            'getActiveAccount().trades.push(' + JSON.stringify(trade('fromB')) + ')');
        const ids = serverJournal(env.db, 'u1').acc1.trades.map(t => t.id).sort();
        assertEqual(ids, ['fromA', 'fromB', 't1', 't2'], 'nothing lost');
        assertEqual(env.a.trades().map(t => t.id).sort(), ids, 'device A has all');
        assertEqual(env.b.trades().map(t => t.id).sort(), ids, 'device B has all');
    });

    test('sync: a deletion reaches the other device; an edit beats a simultaneous delete', async () => {
        const env = await twoDevices();
        await env.a.save("getActiveAccount().trades = getActiveAccount().trades.filter(t => t.id !== 't2')");
        await env.b.flush();
        assertEqual(env.b.trades().map(t => t.id), ['t1'], 'deletion arrived on the other device');
        assert(env.b.toasts.some(t => t.message.indexOf('other device') >= 0), 'told about the update');
        await bothSave(env,
            "getActiveAccount().trades = getActiveAccount().trades.filter(t => t.id !== 't1')",
            "getActiveAccount().trades.find(t => t.id === 't1').journal = 'keep me'");
        assertEqual(serverJournal(env.db, 'u1').acc1.trades.map(t => t.journal), ['keep me'], 'edited trade kept');
    });

    test('sync: a remote update keeps account objects, so a held reference stays live', async () => {
        const env = await twoDevices();
        env.b.js('var __held = getActiveAccount()');
        await env.a.save('getActiveAccount().trades.push(' + JSON.stringify(trade('t3')) + ')');
        await env.b.flush();
        assert(env.b.js('__held === getActiveAccount()'), 'same account object after the merge');
        assertEqual(env.b.js('__held.trades.map(t => t.id)'), ['t1', 't2', 't3'], 'and it has the new trade');
    });

    test('sync: saving the Account modal keeps a trade that arrived while it was open', async () => {
        const env = await twoDevices();
        ['account-modal-name', 'account-modal-primary', 'account-modal-overlay', 'account-modal-transactions', 'account-modal-balance']
            .forEach(id => { env.b.sb._elements[id] = fakeElement(); });
        env.b.js('function getCurrencySymbol() { return "$"; } function computeTradeReturnAmount() { return 0; }');
        env.b.js('openAccountModal()');
        await env.a.save('getActiveAccount().trades.push(' + JSON.stringify(trade('from-phone')) + ')');
        await env.b.flush();
        env.b.sb._elements['account-modal-name'].value = 'Renamed on PC';
        env.b.js('saveAccountModal()');
        await env.b.flush();
        const acc = serverJournal(env.db, 'u1').acc1;
        assertEqual(acc.name, 'Renamed on PC', 'rename saved');
        assertEqual(acc.trades.map(t => t.id), ['t1', 't2', 'from-phone'], 'phone trade not wiped by the older modal copy');
    });

    test('sync: chart drawings still load when chart-tools.js finishes downloading after Firestore answered', async () => {
        const clock = makeClock();
        const db = new FakeFirestore({ authUid: 'u1' });
        const drawings = { 'XAUUSD|2026-10-29': { drawings: [{ id: 'h1', type: 'hline', price: 2400 }], indicators: [] } };
        await db.rawWrite('users/u1', { bullionAccounts: journal([trade('t1')]), chartDrawings: drawings });
        const a = device(db, 'u1', clock, { lateCharts: true });
        await a.start();
        await a.flush();
        // chart-tools.js arrives now and asks for its part
        run(a.sb, CHART_STUBS);
        a.js("userDocArrivedEarly('chartDrawings')");
        a.sb.__drawings = drawings;
        assert(a.js('syncEqual(chartToolsStore, __drawings)'), 'drawings applied late');
        // and later edits merge against the right base
        a.js("chartToolsStore['XAUUSD|2026-10-29'].drawings.push({ id: 'h2', type: 'hline', price: 2410 }); requestUserDocFieldSave('chartDrawings')");
        await a.flush();
        assertEqual(db.raw('users/u1').chartDrawings['XAUUSD|2026-10-29'].drawings.map(d => d.id), ['h1', 'h2'], 'saved on top of the loaded drawings');
    });

    test('sync: settings changed on two devices merge key by key', async () => {
        const env = await twoDevices();
        env.a.js("appSettings.theme = 'midnight'; requestUserDocFieldSave('appSettings')");
        env.b.js("appSettings.defaultSymbol = 'XAUUSD'; requestUserDocFieldSave('appSettings')");
        await settle(env.clock, 400);
        await settle(env.clock, 400);
        const server = env.db.raw('users/u1').appSettings;
        assertEqual([server.theme, server.defaultSymbol], ['midnight', 'XAUUSD'], 'both settings on the server');
        assertEqual(env.a.js('appSettings.defaultSymbol'), 'XAUUSD', 'A got B\'s setting');
        assertEqual(env.b.js('appSettings.theme'), 'midnight', 'B got A\'s setting');
    });

    test('sync: single-document mode also merges a save from an out-of-date copy of the app', async () => {
        const env = await twoDevices(null, { oldRules: true });
        // An old version (no revision numbers) adds a trade straight into the document
        const current = env.db.raw('users/u1').bullionAccounts;
        current.accounts.acc1.trades.push(trade('old-app'));
        await env.db.rawWrite('users/u1', { bullionAccounts: current }, { mergeFields: ['bullionAccounts'] });
        await env.a.flush();
        await env.a.save('getActiveAccount().trades.push(' + JSON.stringify(trade('new-app')) + ')');
        const ids = env.db.raw('users/u1').bullionAccounts.accounts.acc1.trades.map(t => t.id).sort();
        assertEqual(ids, ['new-app', 'old-app', 't1', 't2'], 'old app\'s trade kept');
    });

    test('sync: after the upgrade, an out-of-date copy of the app cannot overwrite the journal', async () => {
        const env = await twoDevices();
        let refused = null;
        await env.db.rawWrite('users/u1', { bullionAccounts: journal([trade('stale')]) }, { mergeFields: ['bullionAccounts'] })
            .catch(err => { refused = err; });
        assert(refused && refused.code === 'permission-denied', 'stale single-document write refused');
        assertEqual(serverJournal(env.db, 'u1').acc1.trades.map(t => t.id), ['t1', 't2'], 'journal intact');
    });

    // ---- screenshots ----------------------------------------------------------

    test('sync: a removed screenshot is deleted only after 30 days in the trash', async () => {
        const env = await twoDevices([trade('t1', { screenshots: [{ id: 's1', dataUrl: PNG }] })]);
        assert(env.db.raw('users/u1/screenshots/s1'), 'stored');
        await env.a.save("getActiveAccount().trades[0].screenshots = []");
        const trash = env.db.raw('users/u1').bullionStorage.trash;
        assertEqual(trash.map(t => t.id), ['s1'], 'in the trash');
        assert(env.db.raw('users/u1/screenshots/s1'), 'not deleted yet (a revert could still need it)');
        env.clock.tick(31 * 86400000);
        await env.a.save("getActiveAccount().name = 'Live 2'");
        assert(!env.db.raw('users/u1/screenshots/s1'), 'deleted after 30 days');
        assertEqual(env.db.raw('users/u1').bullionStorage.trash, [], 'trash emptied');
    });

    test('sync: a new screenshot is uploaded before the journal that points at it', async () => {
        const env = await twoDevices();
        await env.a.save(`getActiveAccount().trades[0].screenshots = [{ id: 's9', dataUrl: '${PNG}' }]`);
        assertEqual(env.db.raw('users/u1/screenshots/s9').dataUrl, PNG, 'image document written');
        assertEqual(serverJournal(env.db, 'u1').acc1.trades[0].screenshots, [{ id: 's9' }], 'journal holds only the id');
    });

    // ---- deleting the account ---------------------------------------------------

    test('sync: deleting the account removes every document and nothing writes it back', async () => {
        const env = await twoDevices([trade('t1', { screenshots: [{ id: 's1', dataUrl: PNG }] })]);
        await env.a.js("deleteAllUserData('u1')");
        await env.a.flush(5000);
        await env.b.flush(5000);
        assertEqual(env.db.paths('users/u1'), [], 'main document and subcollections gone');
    });

    // ---- history, import undo, guests, backups -----------------------------------

    test('history: undo of a CSV import restores the trades and the Last Import info', () => {
        const clock = makeClock();
        const g = device(new FakeFirestore(), null, clock);
        g.sb.__seed = journal([trade('m1'), trade('c1', { source: 'csv-import' })], { csvImportMeta: { filename: 'old.csv', tradeCount: 1 } });
        g.js('applyLoadedState(__seed)');
        g.js(`const acc = getActiveAccount();
              const before = acc.csvImportMeta;
              acc.trades = acc.trades.filter(t => t.source !== 'csv-import').concat([${JSON.stringify(trade('c2', { source: 'csv-import' }))}]);
              acc.csvImportMeta = { filename: 'new.csv', tradeCount: 1 };
              labelNextTradeChange('Imported 1 trade from new.csv', { kind: 'csv-import', csvMetaBefore: before });
              saveAccountsState();`);
        const entry = g.js('loadTradeHistory(getActiveAccount().id)[0]');
        assertEqual([entry.kind, entry.label], ['csv-import', 'Imported 1 trade from new.csv'], 'one labelled entry');
        g.js(`revertTradeHistoryTo('${entry.id}')`);
        assertEqual(g.trades().map(t => t.id).sort(), ['c1', 'm1'], 'previous import back');
        assertEqual(g.js('getActiveAccount().csvImportMeta.filename'), 'old.csv', 'Last Import info back');
        assert(JSON.stringify(g.state()).indexOf('csvImportUndo') < 0, 'no undo copy stored in the journal');
    });

    test('history: an old csvImportUndo copy is dropped on load', () => {
        const clock = makeClock();
        const g = device(new FakeFirestore(), null, clock);
        g.sb.__seed = journal([trade('t1')], { csvImportUndo: { trades: [trade('x')], meta: null } });
        g.js('applyLoadedState(__seed)');
        assert(g.js('getActiveAccount().csvImportUndo') === undefined, 'gone from memory');
        assert(g.sb.localStorage.getItem('bb_accounts_guest').indexOf('csvImportUndo') < 0, 'gone from the saved copy');
    });

    test('guest: a full browser storage shows a message instead of failing silently', () => {
        const clock = makeClock();
        const g = device(new FakeFirestore(), null, clock);
        g.js('applyLoadedState(null)');
        g.sb.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
        g.js('saveAccountsState()');
        assert(g.toasts.some(t => t.isError && t.message.indexOf('storage is full') >= 0), 'toast shown');
    });

    test('backup: crafted files are refused; a real backup restores', () => {
        const clock = makeClock();
        const g = device(new FakeFirestore(), null, clock);
        g.js('applyLoadedState(null)');
        const good = { kind: 'journal-backup', exportedAt: '2026-10-30T10:00:00Z', journal: journal([trade('t1')]) };
        const check = backup => { g.sb.__b = backup; return g.js('validateJournalBackup(__b)'); };
        assertEqual(check(good), null, 'valid backup accepted');
        const evilId = JSON.parse(JSON.stringify(good));
        evilId.journal.accounts.acc1.trades[0].id = "x');alert(1);//";
        assert(check(evilId), 'script-carrying trade id refused');
        const evilTag = JSON.parse(JSON.stringify(good));
        evilTag.journal.accounts.acc1.trades[0].tagIds = ['ok', '"><img src=x onerror=alert(1)>'];
        assert(check(evilTag), 'script-carrying tag id refused');
        const evilShot = JSON.parse(JSON.stringify(good));
        evilShot.journal.accounts.acc1.trades[0].screenshots = [{ id: 's1', dataUrl: 'javascript:alert(1)' }];
        assert(check(evilShot), 'non-image screenshot refused');
        assert(check({ kind: 'something-else' }), 'other JSON refused');
        g.sb.__b = good;
        g.js('restoreJournalBackup(__b)');
        assertEqual(g.trades().map(t => t.id), ['t1'], 'restored');
    });

    test('csv: re-importing the same trades keeps their ids (history shows edits, not delete+add)', () => {
        const clock = makeClock();
        const g = device(new FakeFirestore(), null, clock, {
            setup: sb => run(sb, `
                let __id = 0;
                function genTradeId() { __id += 1; return 'gen' + __id; }
                function normalizeBrokerSymbol(s) { return String(s || '').trim().toUpperCase(); }
                var Papa = { parse: text => ({ data: text.split('\\n').map(line => line.split(',')) }) };
            `)
        });
        loadInto(g.sb, ['csv-import.js']);
        g.js('applyLoadedState(null)');
        const csv = 'Ticket,Symbol,Type,Lots,Open Time,Open Price,Close Time,Close Price,Profit\n'
            + '101,XAUUSD,buy,0.10,2026.10.29 10:00:00,2400,2026.10.29 10:30:00,2410,100\n'
            + '102,XAUUSD,sell,0.10,2026.10.29 11:00:00,2410,2026.10.29 11:20:00,2405,50';
        g.sb.__csv = csv;
        g.js("importTradesFromCsvText(__csv, 'a.csv')");
        const first = g.trades();
        assertEqual(first.length, 2, 'imported');
        g.js("getActiveAccount().trades[0].tagIds = ['A-setup']; saveAccountsState()");
        g.js("importTradesFromCsvText(__csv, 'a.csv')");
        const second = g.trades();
        assertEqual(second.map(t => t.id), first.map(t => t.id), 'same trade ids');
        assertEqual(second.map(t => t.legs.map(l => l.id)), first.map(t => t.legs.map(l => l.id)), 'same leg ids');
        assertEqual(second[0].tagIds, ['A-setup'], 'tag kept');
        const entry = g.js('loadTradeHistory(getActiveAccount().id)[0]');
        assertEqual([entry.added.length, entry.removed.length], [0, 0], 're-import is not delete-all/add-all');
    });
};
