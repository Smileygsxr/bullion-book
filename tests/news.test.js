// Charts page news logic (app.js): the beat/miss "?" direction hint and the
// news filters. app.js is the whole page controller, so only these
// self-contained functions are lifted out of it and run on their own
// (from the original source - that needs its line structure, which the
// minified build doesn't have).
module.exports = ({ test, assert, assertEqual, makeSandbox, loadInto, run, readOriginalSource }) => {
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

    // (with event-info.js - the "?" explanations, and the polarity rule the
    // colours and the hint share with them)
    function newsSandbox() {
        const sb = makeSandbox();
        loadInto(sb, ['event-info.js']);
        run(sb, [
            decl('const INVERTED_EVENT_KEYWORDS'),
            'let selectedCurrencyFilters = new Set();',
            'const selectedImportanceFilters = new Set();',
            decl('let newsForecastOnly'), decl('let newsTimeFrom'), decl('let newsTimeTo'),
            fn('parseEventNumber'), fn('parseEventTimeToMinutes'), fn('eventPolarity'), fn('getActualColorClass'),
            fn('newsDirectionHint'), fn('newsEventPasses')
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

    // One name per event family in the MT5 calendar (the full list is in
    // data/EconomicEvents.csv, which CI doesn't check out)
    const SAMPLE_EVENTS = [
        ['Goods Trade Balance', 'GBP'], ['Nonfarm Payrolls', 'USD'], ['ADP Nonfarm Employment Change', 'USD'],
        ['Unemployment Rate', 'AUD'], ['U6 Unemployment Rate', 'USD'], ['Claimant Count Change', 'GBP'],
        ['Unemployment Change', 'EUR'], ['Jobseekers Total', 'EUR'], ['Initial Jobless Claims', 'USD'],
        ['Continuing Jobless Claims', 'USD'], ['Challenger Job Cuts', 'USD'], ['JOLTS Job Openings', 'USD'],
        ['Employment Change', 'CAD'], ['Average Hourly Earnings m/m', 'USD'], ['CPI m/m', 'USD'], ['Core CPI y/y', 'EUR'],
        ['Tokyo Core CPI y/y', 'JPY'], ['HICP y/y', 'EUR'], ['CPIH y/y', 'GBP'], ['RPI y/y', 'GBP'], ['PPI Input m/m', 'GBP'],
        ['Core PCE Price Index m/m', 'USD'], ['Michigan Inflation Expectations', 'USD'], ['GDP q/q', 'NZD'], ['GDP Price Index q/q', 'USD'],
        ['Retail Sales m/m', 'AUD'], ['Retail Control m/m', 'USD'], ['ISM Manufacturing PMI', 'USD'], ['ISM Manufacturing Prices Paid', 'USD'],
        ['S&P Global Services PMI', 'EUR'], ['Caixin Manufacturing PMI', 'CNY'], ['Ivey PMI', 'CAD'], ['Philadelphia Fed Manufacturing Index', 'USD'],
        ['Kansas City Fed Manufacturing Production', 'USD'], ['Ifo Business Climate', 'EUR'], ['ZEW Economic Sentiment Indicator', 'EUR'],
        ['BoJ Tankan Large Manufacturing Index', 'JPY'], ['CB Consumer Confidence Index', 'USD'], ['GfK Consumer Climate', 'EUR'],
        ['Fed Interest Rate Decision', 'USD'], ['ECB Deposit Facility Rate Decision', 'EUR'], ['FOMC Press Conference', 'USD'],
        ['FOMC Minutes', 'USD'], ['ECB President Lagarde Speech', 'EUR'], ['BoE MPC Vote Cut', 'GBP'], ['BoE MPC Vote Hike', 'GBP'],
        ['Public Sector Net Borrowing', 'GBP'], ['Federal Budget Balance', 'USD'], ['Current Account - GDP Ratio', 'NZD'],
        ['Housing Starts', 'USD'], ['Building Permits', 'USD'], ['Existing Home Sales', 'USD'], ['Halifax HPI m/m', 'GBP'],
        ['EIA Crude Oil Stocks Change', 'USD'], ['Baker Hughes US Oil Rig Count', 'USD'], ['CFTC Gold Non-Commercial Net Positions', 'USD'],
        ['10-Year Note Auction', 'USD'], ['Christmas Day', 'NZD'], ['Imports', 'NZD'], ['Business Inventories m/m', 'USD'],
        ['Electronic Card Retail Sales m/m', 'NZD'], ['GDT Price Index', 'NZD'], ['TIC Net Long-Term Transactions', 'USD']
    ];

    test('news "?": every event family has an explanation, and colours/hint agree with it', () => {
        const sb = newsSandbox();
        SAMPLE_EVENTS.forEach(([name, currency]) => {
            sb.__n = name;
            sb.__c = currency;
            const d = run(sb, 'describeEconomicEvent(__n, __c, "")');
            assert(d.summary.length > 40, `${name}: no explanation`);
            assert(d.effect.length > 20, `${name}: no effect sentence`);
            assert(d.summary.indexOf("States's") < 0 && d.summary.indexOf('undefined') < 0, `${name}: bad wording: ${d.summary}`);
            const keywordInverted = run(sb, 'INVERTED_EVENT_KEYWORDS.some(k => __n.toLowerCase().includes(k))');
            if (d.polarity === 'up' || d.polarity === 'down') {
                assertEqual(d.polarity === 'down', keywordInverted, `${name}: "higher is bad" disagrees with INVERTED_EVENT_KEYWORDS`);
            }
            assertEqual(run(sb, 'eventPolarity(__n)'), d.polarity, `${name}: colours/hint use a different polarity`);
        });
    });

    test('news "?": the examples read right and drive the colours', () => {
        const sb = newsSandbox();
        const js = code => run(sb, code);
        const trade = js("describeEconomicEvent('Goods Trade Balance', 'GBP', '')");
        assert(/United Kingdom/.test(trade.summary) && /pound/.test(trade.summary), `trade balance names the place and currency: ${trade.summary}`);
        assert(/good for GBP/.test(trade.effect), 'a bigger surplus is good for GBP');
        const jobs = js("describeEconomicEvent('Unemployment Rate', 'AUD', '')");
        assert(/labour force/.test(jobs.summary) && /bad for AUD/.test(jobs.effect), 'higher unemployment is bad for AUD');
        assertEqual(js("getActualColorClass('Unemployment Rate', '4.2%', '4.0%')"), 'cpi-value-down', 'higher unemployment shows red');
        assertEqual(js("getActualColorClass('Claimant Count Change', '30.1K', '20.0K')"), 'cpi-value-down', 'more benefit claims show red');
        assertEqual(js("getActualColorClass('BoE MPC Vote Cut', '4', '2')"), 'cpi-value-down', 'more votes to cut is bad for GBP');
        // oil inventories: no currency direction, no colour, and the hint says so
        assertEqual(js("getActualColorClass('EIA Crude Oil Stocks Change', '5.2M', '1.0M')"), '', 'no colour for crude stocks');
        const hint = js("newsDirectionHint('EIA Crude Oil Stocks Change', 'USD', '5.2M', '1.0M', 'XAUUSD')");
        assert(hint.dir === 0 && /consistent way/.test(hint.text), `no direction for crude stocks: ${hint.text}`);
        // euro events: the country column (or a tell-tale name) picks the economy
        assert(/Germany/.test(js("describeEconomicEvent('Ifo Business Climate', 'EUR', '').summary")), 'Ifo is German');
        assert(/France/.test(js("describeEconomicEvent('CPI m/m', 'EUR', 'France').summary")), 'country column used');
        assert(/euro area/.test(js("describeEconomicEvent('CPI m/m', 'EUR', '').summary")), 'otherwise the euro area');
        assert(/one or more euro-area countries/.test(js("describeEconomicEvent('All Saints\\' Day', 'EUR', '').summary")), 'euro holiday wording');
        // only the head of a central bank gets the "most market-moving" note
        assert(/head of the central bank/.test(js("describeEconomicEvent('ECB President Lagarde Speech', 'EUR', '').summary")), 'Lagarde is the head');
        assert(!/head of the central bank/.test(js("describeEconomicEvent('Bbk President Nagel Speech', 'EUR', '').summary")), 'Nagel is not the ECB head');
        assert(/m\/m: change from the previous month/.test(js("describeEconomicEvent('CPI m/m', 'USD', '').periodNote")), 'period note');
    });
};
