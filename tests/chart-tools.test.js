// Chart indicators and drawings (chart-tools.js): the global indicator list
// and its migration, per-indicator chart scope, previous-day warm-up, and
// all-charts vertical lines. Runs as a guest (localStorage persistence).
module.exports = ({ test, assert, assertEqual, makeSandbox, loadInto, run }) => {
    function chartSandbox() {
        const sb = makeSandbox({ auth: { currentUser: null, onAuthStateChanged(cb) { cb(null); } } });
        loadInto(sb, ['chart-tools.js']);
        return sb;
    }
    const saved = sb => JSON.parse(sb.localStorage.getItem('bb_chart_drawings'));

    test('indicators: old per-chart lists migrate to one global list that persists', () => {
        const sb = chartSandbox();
        const js = code => run(sb, code);
        js(`chartToolsStore = {
            'XAUUSD|2026-01-05': { drawings: [{ id: 'd1', type: 'hline', price: 2000 }], indicators: ['ema20', 'rsi'] },
            'XAUUSD|2026-01-06': { drawings: [], indicators: ['ema20', 'sma200'] }
        }; var list = getGlobalIndicators();`);
        assertEqual(js('list.length'), 3, 'union of per-chart indicators, de-duplicated');
        assertEqual(js("list.map(i => i.type).sort().join()"), 'ema,rsi,sma', 'legacy ids mapped to types');
        assertEqual(js("list.filter(i => i.type === 'ema')[0].period"), 20, 'EMA keeps period 20');
        assert(js('getGlobalIndicators() === list'), 'stable cached list (uids do not change between calls)');
        assertEqual(js("chartToolsStore['XAUUSD|2026-01-05'].indicators.length"), 0, 'legacy per-chart lists cleared');

        js('saveChartToolsStore()');
        let s = saved(sb);
        assert(Array.isArray(s['global|indicators']) && s['global|indicators'].length === 3, 'global list persisted on save');
        assert(!!s['XAUUSD|2026-01-05'], 'chart record with drawings kept');
        assert(!s['XAUUSD|2026-01-06'], 'record that only held legacy indicators cleaned up');

        js('list.splice(0, list.length); saveChartToolsStore()');
        s = saved(sb);
        assert(Array.isArray(s['global|indicators']) && s['global|indicators'].length === 0, 'removing every indicator persists an EMPTY list');
        sb.__s = s;
        js('chartToolsStore = __s');
        assertEqual(js('getGlobalIndicators().length'), 0, 'after reload, deleted indicators do not come back');
    });

    test('indicators: previous-day warm-up, labels and per-indicator chart scope', () => {
        const sb = chartSandbox();
        const js = code => run(sb, code);
        js(`var prev = [], today = [];
            for (let i = 0; i < 30; i++) prev.push({ time: 1000 + i * 60, close: 100 + i });
            for (let j = 0; j < 10; j++) today.push({ time: 5000 + j * 60, close: 130 + j });
            var cold = chartIndicatorTrim(chartToolsEMA(today, 20), today[0].time);
            var warm = chartIndicatorTrim(chartToolsEMA(prev.concat(today), 20), today[0].time);`);
        assertEqual(js('cold.length'), 0, 'without warm-up, EMA20 has no values on a 10-bar day');
        assert(js('warm.length === 10 && warm[0].time === today[0].time'), 'with warm-up, EMA20 starts at the first bar of the day');
        assert(js('warm.every(p => p.time >= today[0].time)'), 'warm-up bars themselves are never plotted');

        assertEqual(js("chartIndicatorLabel({ type: 'bb', period: 20, mult: 2 })"), 'Bollinger Bands (20, 2)', 'label: bollinger');
        assertEqual(js("chartIndicatorLabel({ type: 'ema', period: 9 })"), 'EMA 9', 'label: edited EMA period');
        assertEqual(js("chartIndicatorLabel({ type: 'vwap' })"), 'VWAP', 'label: vwap');

        js(`chartToolsStore = { 'global|indicators': [
                { uid: 'a', type: 'ema', period: 20 },
                { uid: 'b', type: 'rsi', period: 14, chartKey: 'XAUUSD|2026-01-05' }
            ] };
            var chartA = { chartKey: 'XAUUSD|2026-01-05' }, chartB = { chartKey: 'XAUUSD|2026-01-06' };`);
        assertEqual(js('chartIndicatorsFor(chartA).map(i => i.uid).join()'), 'a,b', 'scoped chart gets all-charts + its own indicator');
        assertEqual(js('chartIndicatorsFor(chartB).map(i => i.uid).join()'), 'a', 'other chart only gets the all-charts indicator');
        assertEqual(js("chartKeyLabel('XAUUSD|2026-01-05')"), 'XAUUSD 2026-01-05', 'chart key label');
        js('getGlobalIndicators()[1].chartKey = null');
        assertEqual(js('chartIndicatorsFor(chartB).length'), 2, 're-ticking "all charts" puts it back on every chart');
        js('getGlobalIndicators()[0].chartKey = chartB.chartKey');
        assertEqual(js('chartIndicatorsFor(chartA).map(i => i.uid).join()'), 'b', 'unticking on chart B removes it from chart A');
    });

    test('vertical lines: "all charts" lines keep the same time on every chart', () => {
        const sb = chartSandbox();
        const js = code => run(sb, code);
        js(`var at = (d, h, m) => Date.UTC(2026, 0, d, h, m) / 1000;
            chartToolsStore = { 'XAUUSD|2026-01-05': { drawings: [{ id: 'v1', type: 'vline', t: at(5, 14, 30), color: '#ff0000' }], indicators: [] } };
            var c5 = { chartKey: 'XAUUSD|2026-01-05', data: [] }, c9 = { chartKey: 'EURUSD|2026-01-09', data: [] };`);
        assert(js("findChartDrawing(c9, 'v1') === null"), 'starts on its own chart only');
        js("toggleVlineAllCharts(c5, findChartDrawing(c5, 'v1'))");
        assertEqual(js("getChartToolsRecord('XAUUSD|2026-01-05', false).drawings.length"), 0, '"All charts" moves it out of the chart record');
        assert(js("getGlobalVlines()[0].tod === 52200 && getGlobalVlines()[0].color === '#ff0000'"), 'stored once as 14:30 time-of-day, style kept');
        js("var onC9 = findChartDrawing(c9, 'v1')");
        assert(js('onC9 && onC9.global && onC9.t === at(9, 14, 30)'), 'shows on another symbol + day at the same 14:30');
        assert(js("findChartDrawing(c5, 'v1').t === at(5, 14, 30)"), 'still at 14:30 on the original chart');
        js('onC9.t = at(9, 15, 0)');
        assert(js("findChartDrawing(c5, 'v1').t === at(5, 15, 0)"), 'dragging it on one chart moves it on every chart');
        js("onC9.color = '#00ff00'; onC9.locked = true");
        assert(js("getGlobalVlines()[0].color === '#00ff00' && getGlobalVlines()[0].locked === true"), 'restyle/lock on one chart applies everywhere');
        assertEqual(js('chartDrawingLabel(onC9)'), 'Vertical line @ 15:00 (all charts)', 'object tree label');
        js('saveChartToolsStore()');
        const s2 = saved(sb);
        assert(s2['global|vlines'].length === 1 && s2['global|vlines'][0].tod === 54000, 'persisted with the store');
        js("toggleVlineAllCharts(c9, findChartDrawing(c9, 'v1'))");
        assert(js("getGlobalVlines().length === 0 && findChartDrawing(c5, 'v1') === null"), 'toggling off removes it from other charts');
        js("var kept = getChartToolsRecord('EURUSD|2026-01-09', false).drawings[0]");
        assert(js("kept.t === at(9, 15, 0) && kept.color === '#00ff00' && kept.locked === true"), 'kept on the chart it was toggled on, same time + style');
        js("getChartToolsRecord('XAUUSD|2026-01-05', true).drawings.push({ id: 'v2', type: 'vline', t: at(5, 9, 0) })");
        js("toggleVlineAllCharts(c5, findChartDrawing(c5, 'v2'))");
        assertEqual(js('Object.keys(getGlobalVlines()[0]).join()'), 'id,tod', 'no undefined style fields written (Firestore rejects undefined)');
        js("deleteChartDrawing(c9, 'v2')");
        assertEqual(js('getGlobalVlines().length'), 0, 'deleting an all-charts line removes it everywhere');
        js('saveChartToolsStore()');
        assert(Array.isArray(saved(sb)['global|vlines']), 'empty shared list persists (not cleaned up as an empty chart)');
        assertEqual(js('chartTimeOfDayLabel(52200)'), '14:30', 'manager: time-of-day label');
    });
};
