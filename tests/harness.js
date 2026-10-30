// Minimal, dependency-free test harness for Bullion Book's browser scripts.
//
// Each suite loads the REAL source files (app.js, community.js, ...) into a
// fresh Node `vm` sandbox with small stand-ins for the browser globals they
// touch (document, localStorage, Firebase's auth/db), then calls their
// functions directly. Run everything with:  node tests/run.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// BB_TEST_ROOT=dist runs every suite against the minified build instead
const ROOT = process.env.BB_TEST_ROOT ? path.resolve(process.env.BB_TEST_ROOT) : path.join(__dirname, '..');
const SOURCE_ROOT = path.join(__dirname, '..');

function readSource(file) {
    return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

// Always the original source, even when testing the build
function readOriginalSource(file) {
    return fs.readFileSync(path.join(SOURCE_ROOT, file), 'utf8');
}

function makeLocalStorage() {
    const store = {};
    return {
        getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: k => { delete store[k]; },
        _store: store
    };
}

// Browser-ish globals. Timers run immediately so debounced saves are
// deterministic; DOM lookups return null unless a test supplies elements.
function makeSandbox(extra) {
    const elements = {};
    const sandbox = {
        console,
        setTimeout: fn => { fn(); return 0; },
        clearTimeout: () => {},
        localStorage: makeLocalStorage(),
        atob: s => Buffer.from(s, 'base64').toString('binary'),
        btoa: s => Buffer.from(s, 'binary').toString('base64'),
        URLSearchParams,
        document: {
            addEventListener() {},
            removeEventListener() {},
            getElementById: id => elements[id] || null,
            querySelector: () => null,
            querySelectorAll: () => [],
            activeElement: null,
            visibilityState: 'visible',
            body: { classList: { toggle() {}, add() {}, remove() {}, contains: () => false } }
        },
        window: { addEventListener() {}, removeEventListener() {}, innerWidth: 1280, location: { hash: '' } },
        auth: { currentUser: null, onAuthStateChanged() {} },
        db: null,
        _elements: elements
    };
    Object.assign(sandbox, extra || {});
    sandbox.window.localStorage = sandbox.localStorage;
    vm.createContext(sandbox);
    return sandbox;
}

// A stand-in DOM element that records what the code writes into it.
function fakeElement() {
    return { innerHTML: '', textContent: '', value: '', style: {}, dataset: {},
        classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
        addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] };
}

function loadInto(sandbox, files) {
    files.forEach(f => vm.runInContext(readSource(f), sandbox, { filename: f }));
    return sandbox;
}

// Evaluate an expression inside the sandbox (reaches top-level let/const too).
function run(sandbox, code) {
    return vm.runInContext(code, sandbox);
}

// The inline <script> of an HTML page (the last one), for pages like journal.html.
function inlineScript(htmlFile) {
    const html = readSource(htmlFile);
    const open = html.lastIndexOf('<script>');
    const close = html.indexOf('</script>', open);
    if (open < 0 || close < 0) throw new Error(`No inline <script> in ${htmlFile}`);
    return html.slice(open + '<script>'.length, close);
}

// A fake clock for suites that need real timer behaviour (debounces,
// retries): setTimeout queues instead of running, tick(ms) advances time and
// runs whatever came due, in order.
function makeClock(start) {
    let now = start || Date.UTC(2026, 9, 30, 12, 0, 0);
    let seq = 0;
    const timers = new Map();
    return {
        now: () => now,
        setTimeout: (fn, ms) => {
            seq += 1;
            timers.set(seq, { at: now + (ms || 0), fn });
            return seq;
        },
        clearTimeout: id => { timers.delete(id); },
        tick(ms) {
            const target = now + (ms || 0);
            for (;;) {
                let next = null;
                timers.forEach((t, id) => {
                    if (t.at <= target && (!next || t.at < next.t.at || (t.at === next.t.at && id < next.id))) next = { id, t };
                });
                if (!next) break;
                timers.delete(next.id);
                now = Math.max(now, next.t.at);
                next.t.fn();
            }
            now = target;
        },
        pending: () => timers.size
    };
}

// Lets promise chains and setImmediate work run, firing zero-delay timers
// between rounds; then optionally advances the clock by ms and settles again.
async function settle(clock, ms) {
    const rounds = async () => {
        for (let i = 0; i < 80; i++) {
            await new Promise(r => setImmediate(r));
            clock.tick(0);
        }
    };
    await rounds();
    if (ms) {
        clock.tick(ms);
        await rounds();
    }
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function assert(condition, message) {
    if (!condition) throw new Error(message || 'assertion failed');
}

function assertEqual(actual, expected, message) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a !== e) throw new Error(`${message || 'not equal'}\n      expected: ${e}\n      actual:   ${a}`);
}

async function runAll() {
    let passed = 0;
    const failures = [];
    for (const t of tests) {
        try {
            await t.fn();
            passed += 1;
            console.log(`  ok    ${t.name}`);
        } catch (err) {
            failures.push(t.name);
            console.log(`  FAIL  ${t.name}\n        ${String(err && err.message || err).split('\n').join('\n        ')}`);
        }
    }
    console.log(`\n${passed} passed, ${failures.length} failed (${tests.length} total)`);
    return failures.length;
}

module.exports = { test, assert, assertEqual, makeSandbox, fakeElement, loadInto, run, inlineScript, readSource, readOriginalSource, runAll, makeClock, settle, ROOT };
