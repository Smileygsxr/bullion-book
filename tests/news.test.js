// Charts page news logic (app.js): the beat/miss "?" direction hint and the
// news filters. app.js is the whole page controller, so only these
// self-contained functions are lifted out of it and run on their own
// (from the original source - that needs its line structure, which the
// minified build doesn't have).
module.exports = ({ test, assert, assertEqual, makeSandbox, run, readOriginalSource }) => {
    const app = readOriginalSource('app.js');

    // A top-level function: "function name(" up to the first "}" at column 0
    function fn(name) {
        const m = app.match(new RegExp(`^function ${name}\\(.*?^\\}`, 'ms'));
        if (!m) throw new Error(`app.js: function ${name} not found`);
        return m[0];
    }

    function decl(prefix) {
        const line = app.split('\n').find(l => l.startsWith(prefix));
        if (!line) throw new Error(`app.js: "${prefix}" not found`);
        return line;
    }

    function newsSandbox() {
        const sb = makeSandbox();
        run(sb, [
            decl('const INVERTED_EVENT_KEYWORDS'),
            'let selectedCurrencyFilters = new Set();',
            'const selectedImportanceFilters = new Set();',
            decl('let newsForecastOnly'), decl('let newsTimeFrom'), decl('let newsTimeTo'),
            fn('parseEventNumber'), fn('parseEventTimeToMinutes'), fn('newsDirectionHint'), fn('newsEventPasses')
        ].join('\n'));
        return sb;
    }

    test('news: beat/miss direction hint follows base/quote currency', () => {
        const sb = newsSandbox();
        const dir = args => run(sb, `newsDirectionHint(${args}).dir`);
        assertEqual(dir("'CPI m/m', 'USD', '0.5%', '0.3%', 'XAUUSD'"), -1, 'USD beat on XAUUSD (USD is quote) -> gold likely DOWN');
        assertEqual(dir("'CPI m/m', 'USD', '0.1%', '0.3%', 'XAUUSD'"), 1, 'USD miss -> gold likely UP');
        assertEqual(dir("'CPI y/y', 'EUR', '2.9%', '2.5%', 'EURUSD'"), 1, 'EUR beat on EURUSD (EUR is base) -> UP');
        assertEqual(dir("'Unemployment Rate', 'USD', '4.2%', '4.0%', 'XAUUSD'"), 1, 'higher US unemployment = weaker USD -> gold UP');
        assertEqual(dir("'GDP q/q', 'JPY', '1.0%', '0.5%', 'EURUSD'"), 0, 'JPY news on EURUSD -> no direction');
        assertEqual(dir("'CPI m/m', 'USD', '0.3%', '0.3%', 'XAUUSD'"), 0, 'in line with forecast -> no direction');
        assertEqual(dir("'Speech', 'USD', '', '', 'XAUUSD'"), 0, 'no numbers -> no direction');
        assertEqual(dir("'Retail Sales', 'USD', '1.2%', '0.4%', 'US500'"), -1, 'non-pair symbol treated as USD-priced');
    });

    test('news: forecast-only, exact time, time range and currency filters', () => {
        const sb = newsSandbox();
        const js = code => run(sb, code);
        js("var t1430 = parseEventTimeToMinutes('2:30pm')");
        assertEqual(js('t1430'), 870, '2:30pm parses to 14:30');
        assert(js("newsEventPasses('high', 'USD', true, t1430)"), 'no filters -> shown');
        js('newsForecastOnly = true');
        assert(!js("newsEventPasses('high', 'USD', false, t1430)"), 'forecast-only hides an event without forecast');
        assert(js("newsEventPasses('high', 'USD', true, t1430)"), 'forecast-only keeps an event with forecast');
        js('newsForecastOnly = false; newsTimeFrom = 870; newsTimeTo = 870');
        assert(js("newsEventPasses('high', 'USD', true, 870)"), 'exact 14:30 filter keeps the 14:30 release');
        assert(!js("newsEventPasses('high', 'USD', true, 900)"), 'exact 14:30 filter hides 15:00');
        assert(!js("newsEventPasses('high', 'USD', true, parseEventTimeToMinutes('All Day'))"), 'time filter hides events with no parseable time');
        js('newsTimeFrom = 480; newsTimeTo = 960');
        assert(js("newsEventPasses('low', 'EUR', false, 600) && !newsEventPasses('low', 'EUR', false, 1000)"), 'range 08:00-16:00 works');
        js("newsTimeFrom = null; newsTimeTo = null; selectedCurrencyFilters.add('USD')");
        assert(!js("newsEventPasses('high', 'EUR', true, 600)"), 'currency filter still applies');
    });
};
