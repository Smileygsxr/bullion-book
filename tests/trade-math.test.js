// Trade P&L math (trades.js computeTradeSummary). The cases live in
// tests.html - the page you can also open in a browser - and are run here
// too, so CI and the browser page always check exactly the same thing.
module.exports = ({ test, assert, makeSandbox, loadInto, run, readSource }) => {
    const page = readSource('tests.html');

    function scriptContaining(marker) {
        const scripts = page.split('<script>').slice(1).map(s => s.slice(0, s.indexOf('</script>')));
        const found = scripts.find(s => s.indexOf(marker) >= 0);
        if (!found) throw new Error(`tests.html: no <script> containing "${marker}"`);
        return found;
    }

    // tests.html's stubs, then trades.js, then the case list (up to where
    // the page starts drawing its results table)
    const stubs = scriptContaining("Stubs for trades.js");
    const casesScript = scriptContaining('var CASES = [');
    const casesBody = casesScript.slice(casesScript.indexOf('var leg = function'), casesScript.indexOf('var tbody'));

    function near(a, b) {
        if (a === null || b === null || typeof a !== 'number' || typeof b !== 'number') return a === b;
        return Math.abs(a - b) < 1e-6;
    }

    test('trade math: every case in tests.html', () => {
        const sb = makeSandbox();
        run(sb, stubs);
        loadInto(sb, ['trades.js']);
        run(sb, `${casesBody}\nvar __cases = CASES.concat([BE_CASE]);`);
        const count = run(sb, '__cases.length');
        assert(count >= 10, `expected the tests.html cases, found ${count}`);
        const failures = [];
        for (let i = 0; i < count; i++) {
            const result = JSON.parse(run(sb, `(function () {
                const c = __cases[${i}];
                const prevBE = appSettings.breakevenRange;
                if (c.breakevenRange) appSettings.breakevenRange = c.breakevenRange;
                try { return JSON.stringify({ name: c.name, expect: c.expect, actual: computeTradeSummary(c.trade) }); }
                finally { appSettings.breakevenRange = prevBE; }
            })()`));
            Object.keys(result.expect).forEach(key => {
                const want = result.expect[key];
                const got = result.actual[key] === undefined ? undefined : result.actual[key];
                if (!near(want, got)) failures.push(`${result.name}: ${key} expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
            });
        }
        assert(failures.length === 0, failures.join('\n'));
    });
};
