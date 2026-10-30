// Boots app.html for real: every one of its scripts, in page order, in one
// sandbox, then the page's own inline startup line - signed in, against the
// in-memory Firestore. Catches what per-file tests can't: a script throwing
// while it loads, two files clashing, or startup not reaching a loaded journal.
const { FakeFirestore } = require('./fake-firestore');

module.exports = ({ test, assert, assertEqual, makeSandbox, run, readSource, makeClock, settle }) => {
    // A forgiving stand-in for any DOM element the page might touch
    function element() {
        const el = {
            style: {}, dataset: {}, value: '', checked: false, innerHTML: '', textContent: '', className: '', children: [],
            classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
            addEventListener() {}, removeEventListener() {}, appendChild: c => c, removeChild() {}, remove() {}, insertAdjacentHTML() {},
            setAttribute() {}, getAttribute: () => null, removeAttribute() {}, focus() {}, blur() {}, click() {}, scrollIntoView() {},
            querySelector: () => null, querySelectorAll: () => [], closest: () => null, contains: () => false,
            getBoundingClientRect: () => ({ top: 0, left: 0, width: 100, height: 100, right: 100, bottom: 100 }),
            getContext: () => null
        };
        return el;
    }

    function bootSandbox(db, clock, toasts) {
        const elements = {};
        const sb = makeSandbox({
            setTimeout: clock.setTimeout,
            clearTimeout: clock.clearTimeout,
            setInterval: () => 0,
            clearInterval: () => {},
            requestAnimationFrame: () => 0,
            navigator: { onLine: true, userAgent: 'test' },
            db,
            fetch: () => Promise.reject(new Error('no network in tests')),
            Papa: { parse: () => ({ data: [], meta: { fields: [] } }) },
            LightweightCharts: {},
            matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
            sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
            location: { href: 'https://bullion-book.vercel.app/app.html', hash: '', search: '', pathname: '/app.html' },
            history: { replaceState() {}, pushState() {} },
            alert() {}, confirm: () => true,
            Image: function () { return element(); },
            FileReader: function () {},
            Blob: function () {},
            URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }
        });
        const user = { uid: 'u1', displayName: 'Test', email: 't@example.com', photoURL: null, metadata: { lastSignInTime: new Date(clock.now()).toUTCString() } };
        const authCallbacks = [];
        sb.auth = { currentUser: user, onAuthStateChanged(cb) { authCallbacks.push(cb); return () => {}; }, signOut: () => Promise.resolve() };
        Object.assign(sb.document, {
            getElementById: id => (elements[id] = elements[id] || element()),
            querySelector: () => element(),
            querySelectorAll: () => [],
            createElement: () => element(),
            documentElement: element(),
            head: element(),
            body: element()
        });
        sb.window = Object.assign(sb.window, { innerWidth: 1280, innerHeight: 800, matchMedia: sb.matchMedia, scrollTo() {}, location: sb.location });
        sb.__clockNow = clock.now;
        run(sb, 'Date.now = () => __clockNow()');
        return { sb, elements, fireAuth: () => authCallbacks.slice().forEach(cb => cb(user)), toasts };
    }

    test('boot: app.html loads every script, starts up signed in and loads the journal', async () => {
        const clock = makeClock();
        const db = new FakeFirestore({ authUid: 'u1' });
        await db.rawWrite('users/u1', {
            bullionAccounts: {
                activeAccountId: 'acc1',
                accounts: { acc1: { id: 'acc1', name: 'Live', transactions: [], trades: [
                    { id: 't1', symbol: 'XAUUSD', tagIds: [], journal: '', legs: [
                        { id: 'l1', action: 'buy', datetime: '2026-10-29T10:00', quantity: 0.1, price: 2400, fee: 0 },
                        { id: 'l2', action: 'sell', datetime: '2026-10-29T10:30', quantity: 0.1, price: 2410, fee: 0 }] }] } }
            },
            appSettings: { theme: 'midnight' }
        });
        const env = bootSandbox(db, clock, []);
        const html = readSource('app.html');
        const scripts = (html.match(/<script\b[^>]*>/g) || [])
            .map(t => (t.match(/\ssrc="([^"]+)"/) || [])[1])
            .filter(src => src && !/^https?:/i.test(src) && src.split('?')[0] !== 'firebase-config.js')
            .map(src => src.split('?')[0]);
        const loadErrors = [];
        const inline = html.match(/<script>([^<]*requireAuth\(\)[^<]*)<\/script>/);
        assert(inline, 'found the inline startup script');
        scripts.forEach(file => {
            try {
                require('vm').runInContext(readSource(file), env.sb, { filename: file });
            } catch (err) {
                loadErrors.push(`${file}: ${err.message}`);
            }
            // The page runs its startup line right after filters.js
            if (file === 'filters.js') {
                try { run(env.sb, inline[1]); } catch (err) { loadErrors.push(`startup: ${err.message}`); }
            }
        });
        assert(loadErrors.length === 0, loadErrors.join('\n'));
        assert(scripts.length >= 15, `expected all of app.html's scripts, found ${scripts.length}`);
        assert(run(env.sb, "typeof refreshActivePageForAccountChange === 'function' && typeof renderStatsPage === 'function' && typeof startUserSync === 'function'"),
            'functions from the first, middle and last scripts all defined');
        env.fireAuth();
        await settle(clock, 400);
        await settle(clock, 400);
        assert(run(env.sb, 'journalSync.loaded') === true, 'journal loaded');
        assertEqual(run(env.sb, 'getActiveAccount().trades.map(t => t.id)'), ['t1'], 'the stored trade is there');
        assertEqual(run(env.sb, 'appSettings.theme'), 'midnight', 'settings applied');
        assertEqual(db.raw('users/u1').bullionStorage.version, 2, 'upgraded to split storage on first load');
        assert(run(env.sb, '!journalSync.error && !journalSync.loadError'), 'no save/load error');
    });
};
