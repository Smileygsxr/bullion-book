// ==== Chart tools: TradingView-style drawings, indicators & object tree ====
// Attached to every Lightweight Charts day-chart (News page + Trade View
// modal). Provides:
//   - Drawing tools: trend line, horizontal line, rectangle, fib retracement
//   - Indicators: EMA 20/50, SMA 200, Bollinger Bands, VWAP, RSI (own pane)
//   - An object tree per chart to hide/remove any drawing or indicator
//   - Persistence: everything saves per symbol+day to the user's Firestore
//     doc (localStorage for guests) and re-appears until deleted.
//
// Drawings are keyed "SYMBOL|YYYY-MM-DD", so a line drawn on the News page's
// XAUUSD chart for a given day also shows on that day's Trade View chart.

// chartKey -> { drawings: [...], indicators: [...] }
let chartToolsStore = {};
let chartToolsSaveTimer = null;

// All tool instances currently alive, so a late Firestore load can restore
// saved drawings onto charts that rendered before the fetch finished.
const liveChartTools = new Set();

function loadChartToolsStore() {
    auth.onAuthStateChanged(user => {
        if (user && db) {
            db.collection('users').doc(user.uid).get()
                .then(doc => {
                    chartToolsStore = (doc.exists && doc.data().chartDrawings) || {};
                    liveChartTools.forEach(tools => chartToolsRestore(tools));
                })
                .catch(err => console.error('Chart drawings load error:', err.message));
        } else {
            try { chartToolsStore = JSON.parse(localStorage.getItem('bb_chart_drawings')) || {}; } catch (e) { chartToolsStore = {}; }
            liveChartTools.forEach(tools => chartToolsRestore(tools));
        }
    });
}

function saveChartToolsStore() {
    clearTimeout(chartToolsSaveTimer);
    chartToolsSaveTimer = setTimeout(() => {
        // Drop empty records so the doc doesn't accumulate dead keys forever
        Object.keys(chartToolsStore).forEach(key => {
            const rec = chartToolsStore[key];
            if ((!rec.drawings || rec.drawings.length === 0) && (!rec.indicators || rec.indicators.length === 0)) {
                delete chartToolsStore[key];
            }
        });

        const uid = auth.currentUser && auth.currentUser.uid;
        if (uid && db) {
            // update() REPLACES the chartDrawings field (unlike set+merge, whose
            // deep-merge would resurrect deleted drawings); set is only the
            // first-write fallback when the user doc doesn't exist yet.
            db.collection('users').doc(uid).update({ chartDrawings: chartToolsStore })
                .catch(() => db.collection('users').doc(uid).set({ chartDrawings: chartToolsStore }, { merge: true }))
                .catch(err => console.error('Chart drawings save error:', err.message));
        } else {
            localStorage.setItem('bb_chart_drawings', JSON.stringify(chartToolsStore));
        }
    }, 600);
}

function getChartToolsRecord(chartKey, createIfMissing) {
    let rec = chartToolsStore[chartKey];
    if (!rec && createIfMissing) {
        rec = { drawings: [], indicators: [] };
        chartToolsStore[chartKey] = rec;
    }
    return rec || { drawings: [], indicators: [] };
}

// ---- Indicator definitions & math ----
const CHART_INDICATORS = {
    ema20: { label: 'EMA 20', color: '#f0b45c' },
    ema50: { label: 'EMA 50', color: '#26b8cf' },
    sma200: { label: 'SMA 200', color: '#9d6bff' },
    bb: { label: 'Bollinger Bands (20, 2)', color: '#7f97a1' },
    vwap: { label: 'VWAP', color: '#ff8a3d' },
    rsi: { label: 'RSI (14)', color: '#9d6bff' }
};

function chartToolsSMA(data, period) {
    const out = [];
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
        sum += data[i].close;
        if (i >= period) sum -= data[i - period].close;
        if (i >= period - 1) out.push({ time: data[i].time, value: sum / period });
    }
    return out;
}

function chartToolsEMA(data, period) {
    const out = [];
    const k = 2 / (period + 1);
    let ema = null;
    for (let i = 0; i < data.length; i++) {
        ema = ema === null ? data[i].close : data[i].close * k + ema * (1 - k);
        if (i >= period - 1) out.push({ time: data[i].time, value: ema });
    }
    return out;
}

function chartToolsBB(data, period, mult) {
    const upper = [], middle = [], lower = [];
    let sum = 0, sumSq = 0;
    for (let i = 0; i < data.length; i++) {
        sum += data[i].close;
        sumSq += data[i].close * data[i].close;
        if (i >= period) {
            sum -= data[i - period].close;
            sumSq -= data[i - period].close * data[i - period].close;
        }
        if (i >= period - 1) {
            const mean = sum / period;
            const variance = Math.max(0, sumSq / period - mean * mean);
            const sd = Math.sqrt(variance);
            middle.push({ time: data[i].time, value: mean });
            upper.push({ time: data[i].time, value: mean + mult * sd });
            lower.push({ time: data[i].time, value: mean - mult * sd });
        }
    }
    return { upper, middle, lower };
}

function chartToolsVWAP(data) {
    const out = [];
    let cumPV = 0, cumV = 0;
    for (let i = 0; i < data.length; i++) {
        const typical = (data[i].high + data[i].low + data[i].close) / 3;
        const vol = data[i].volume || 1;
        cumPV += typical * vol;
        cumV += vol;
        out.push({ time: data[i].time, value: cumPV / cumV });
    }
    return out;
}

function chartToolsRSI(data, period) {
    const out = [];
    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i < data.length; i++) {
        const change = data[i].close - data[i - 1].close;
        const gain = Math.max(change, 0);
        const loss = Math.max(-change, 0);
        if (i <= period) {
            avgGain += gain / period;
            avgLoss += loss / period;
        } else {
            avgGain = (avgGain * (period - 1) + gain) / period;
            avgLoss = (avgLoss * (period - 1) + loss) / period;
        }
        if (i >= period) {
            const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
            out.push({ time: data[i].time, value: avgLoss === 0 ? 100 : 100 - 100 / (1 + rs) });
        }
    }
    return out;
}

// ---- Coordinate helpers ----
function chartToolsNearestIndex(data, t) {
    if (!data || data.length === 0) return -1;
    let best = 0, bestDiff = Math.abs(data[0].time - t);
    for (let i = 1; i < data.length; i++) {
        const diff = Math.abs(data[i].time - t);
        if (diff < bestDiff) { bestDiff = diff; best = i; }
    }
    return best;
}

function chartToolsTimeToX(tools, t) {
    const ts = tools.chart.timeScale();
    let x = ts.timeToCoordinate(t);
    if (x === null && tools.data.length > 0) {
        // Off the visible range: fall back to the bar's logical index so
        // partially-visible drawings still render at the right slope.
        const idx = chartToolsNearestIndex(tools.data, t);
        x = ts.logicalToCoordinate(idx);
    }
    return x;
}

// ---- Attach: one call per chart instance ----
// opts: { chart, series, container, chartKey }
function attachChartTools(opts) {
    const tools = {
        chart: opts.chart,
        series: opts.series,
        container: opts.container,
        chartKey: opts.chartKey,
        data: [],
        activeTool: null,
        pending: null,          // first click of a two-point drawing
        indicatorSeries: {},    // indicatorId -> [ISeriesApi...]
        priceLines: {},         // drawingId -> IPriceLine (hlines)
        disposed: false
    };

    tools.container.style.position = 'relative';

    // SVG overlay for trend lines / rects / fibs (kept below the toolbar,
    // above the chart canvas; never intercepts the mouse).
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'chart-tools-svg');
    tools.container.appendChild(svg);
    tools.svg = svg;

    buildChartToolsToolbar(tools);
    buildChartToolsTreePanel(tools);

    tools.chart.subscribeClick(param => handleChartToolsClick(tools, param));
    tools.chart.timeScale().subscribeVisibleLogicalRangeChange(() => renderChartDrawings(tools));

    tools.resizeObserver = new ResizeObserver(() => renderChartDrawings(tools));
    tools.resizeObserver.observe(tools.container);

    tools.keyHandler = e => {
        if (e.key === 'Escape' && (tools.activeTool || tools.pending)) {
            setChartToolsActive(tools, null);
        }
    };
    document.addEventListener('keydown', tools.keyHandler);

    tools.setData = newData => {
        tools.data = newData || [];
        chartToolsRestore(tools);
    };

    tools.dispose = () => {
        tools.disposed = true;
        document.removeEventListener('keydown', tools.keyHandler);
        if (tools.resizeObserver) tools.resizeObserver.disconnect();
        liveChartTools.delete(tools);
    };

    liveChartTools.add(tools);
    return tools;
}

// Re-applies everything saved for this chart against the CURRENT data -
// called after every data (re)load and after the Firestore store arrives.
function chartToolsRestore(tools) {
    if (tools.disposed || tools.data.length === 0) return;
    const rec = getChartToolsRecord(tools.chartKey, false);

    // Indicators: sync active set with the saved list
    Object.keys(tools.indicatorSeries).forEach(id => {
        if (!rec.indicators.includes(id)) removeChartIndicator(tools, id, false);
    });
    rec.indicators.forEach(id => applyChartIndicator(tools, id));

    // Horizontal lines live as native price lines; recreate from scratch
    Object.keys(tools.priceLines).forEach(id => {
        try { tools.series.removePriceLine(tools.priceLines[id]); } catch (e) { /* series may be gone */ }
        delete tools.priceLines[id];
    });
    rec.drawings.filter(d => d.type === 'hline').forEach(d => ensureChartHLine(tools, d));

    renderChartDrawings(tools);
    renderChartObjectTree(tools);
}

// ---- Toolbar ----
const CHART_TOOL_DEFS = [
    { id: 'trend', icon: 'fa-slash', title: 'Trend line (2 clicks)' },
    { id: 'hline', icon: 'fa-minus', title: 'Horizontal line (1 click)' },
    { id: 'rect', icon: 'fa-vector-square', title: 'Rectangle zone (2 clicks)' },
    { id: 'fib', icon: 'fa-bars', title: 'Fib retracement (2 clicks: high, low)' }
];

function buildChartToolsToolbar(tools) {
    const bar = document.createElement('div');
    bar.className = 'chart-tools-bar';

    // Grip handle: drag to move the whole toolbar anywhere inside the chart,
    // so it never has to sit on top of the candles you care about.
    const grip = document.createElement('div');
    grip.className = 'chart-tools-grip';
    grip.title = 'Drag to move';
    grip.innerHTML = '<i class="fa-solid fa-grip-lines"></i>';
    grip.addEventListener('mousedown', e => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX, startY = e.clientY;
        const startLeft = bar.offsetLeft, startTop = bar.offsetTop;

        const onMove = ev => {
            const maxLeft = tools.container.clientWidth - bar.offsetWidth;
            const maxTop = tools.container.clientHeight - bar.offsetHeight;
            bar.style.left = `${Math.max(0, Math.min(maxLeft, startLeft + ev.clientX - startX))}px`;
            bar.style.top = `${Math.max(0, Math.min(maxTop, startTop + ev.clientY - startY))}px`;
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            positionChartToolsPanels(tools);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
    bar.appendChild(grip);

    CHART_TOOL_DEFS.forEach(def => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chart-tools-btn';
        btn.dataset.tool = def.id;
        btn.title = def.title;
        btn.innerHTML = `<i class="fa-solid ${def.icon}"></i>`;
        btn.addEventListener('click', e => {
            e.stopPropagation();
            setChartToolsActive(tools, tools.activeTool === def.id ? null : def.id);
        });
        bar.appendChild(btn);
    });

    const sep = document.createElement('div');
    sep.className = 'chart-tools-sep';
    bar.appendChild(sep);

    // Indicators dropdown
    const indBtn = document.createElement('button');
    indBtn.type = 'button';
    indBtn.className = 'chart-tools-btn';
    indBtn.title = 'Indicators';
    indBtn.innerHTML = '<i class="fa-solid fa-chart-line"></i>';
    indBtn.addEventListener('click', e => {
        e.stopPropagation();
        tools.treePanel.style.display = 'none';
        tools.indMenu.style.display = tools.indMenu.style.display === 'none' ? 'block' : 'none';
        positionChartToolsPanels(tools);
        renderChartIndMenu(tools);
    });
    bar.appendChild(indBtn);

    // Object tree toggle
    const treeBtn = document.createElement('button');
    treeBtn.type = 'button';
    treeBtn.className = 'chart-tools-btn';
    treeBtn.title = 'Object tree (drawings & indicators)';
    treeBtn.innerHTML = '<i class="fa-solid fa-layer-group"></i>';
    treeBtn.addEventListener('click', e => {
        e.stopPropagation();
        tools.indMenu.style.display = 'none';
        tools.treePanel.style.display = tools.treePanel.style.display === 'none' ? 'block' : 'none';
        positionChartToolsPanels(tools);
        renderChartObjectTree(tools);
    });
    bar.appendChild(treeBtn);

    tools.container.appendChild(bar);
    tools.toolbar = bar;

    // Indicators dropdown panel
    const indMenu = document.createElement('div');
    indMenu.className = 'chart-tools-panel';
    indMenu.style.display = 'none';
    tools.container.appendChild(indMenu);
    tools.indMenu = indMenu;
}

// Keeps the dropdown panels glued next to the (movable) toolbar, flipping to
// its left side when dragged against the chart's right edge.
function positionChartToolsPanels(tools) {
    const bar = tools.toolbar;
    if (!bar) return;
    [tools.indMenu, tools.treePanel].forEach(panel => {
        if (!panel) return;
        const panelWidth = panel.offsetWidth || 240;
        const rightOfBar = bar.offsetLeft + bar.offsetWidth + 8;
        const fitsRight = rightOfBar + panelWidth <= tools.container.clientWidth;
        panel.style.left = `${fitsRight ? rightOfBar : Math.max(0, bar.offsetLeft - panelWidth - 8)}px`;
        panel.style.top = `${bar.offsetTop}px`;
    });
}

function setChartToolsActive(tools, toolId) {
    tools.activeTool = toolId;
    tools.pending = null;
    tools.toolbar.querySelectorAll('.chart-tools-btn[data-tool]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tool === toolId);
    });
    tools.container.classList.toggle('chart-tools-drawing', !!toolId);
    renderChartDrawings(tools); // clears any pending-point marker
}

// ---- Click handling / drawing placement ----
function handleChartToolsClick(tools, param) {
    if (!tools.activeTool || !param.point || tools.data.length === 0) return;

    // Resolve the clicked bar time: prefer the exact bar, fall back to the
    // nearest logical index for clicks in the margins.
    let t = param.time;
    if (t === undefined && typeof param.logical === 'number') {
        const idx = Math.max(0, Math.min(tools.data.length - 1, Math.round(param.logical)));
        t = tools.data[idx].time;
    }
    if (t === undefined) return;

    const price = tools.series.coordinateToPrice(param.point.y);
    if (price === null) return;

    const rec = getChartToolsRecord(tools.chartKey, true);

    if (tools.activeTool === 'hline') {
        const drawing = { id: chartToolsId(), type: 'hline', price };
        rec.drawings.push(drawing);
        ensureChartHLine(tools, drawing);
        finishChartDrawing(tools);
        return;
    }

    if (!tools.pending) {
        tools.pending = { t, price };
        renderChartDrawings(tools); // shows the first-point dot
        return;
    }

    const drawing = {
        id: chartToolsId(),
        type: tools.activeTool,
        p1: { t: tools.pending.t, price: tools.pending.price },
        p2: { t, price }
    };
    rec.drawings.push(drawing);
    finishChartDrawing(tools);
}

function finishChartDrawing(tools) {
    tools.pending = null;
    setChartToolsActive(tools, null);
    saveChartToolsStore();
    renderChartDrawings(tools);
    renderChartObjectTree(tools);
}

function chartToolsId() {
    return `ct_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ---- Horizontal lines (native price lines: full width + axis label) ----
function ensureChartHLine(tools, drawing) {
    if (tools.priceLines[drawing.id]) return;
    tools.priceLines[drawing.id] = tools.series.createPriceLine({
        price: drawing.price,
        color: '#dfb15b',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: ''
    });
}

// ---- SVG rendering for trend / rect / fib ----
function chartToolsSvgEl(name, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', name);
    Object.keys(attrs).forEach(k => el.setAttribute(k, attrs[k]));
    return el;
}

const CHART_FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

function renderChartDrawings(tools) {
    if (tools.disposed) return;
    const svg = tools.svg;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (tools.data.length === 0) return;

    const rec = getChartToolsRecord(tools.chartKey, false);

    rec.drawings.forEach(d => {
        if (d.type === 'hline') return; // native price line handles it

        const x1 = chartToolsTimeToX(tools, d.p1.t);
        const x2 = chartToolsTimeToX(tools, d.p2.t);
        const y1 = tools.series.priceToCoordinate(d.p1.price);
        const y2 = tools.series.priceToCoordinate(d.p2.price);
        if (x1 === null || x2 === null || y1 === null || y2 === null) return;

        if (d.type === 'trend') {
            svg.appendChild(chartToolsSvgEl('line', {
                x1, y1, x2, y2,
                stroke: '#dfb15b', 'stroke-width': 2, 'stroke-linecap': 'round'
            }));
        } else if (d.type === 'rect') {
            svg.appendChild(chartToolsSvgEl('rect', {
                x: Math.min(x1, x2), y: Math.min(y1, y2),
                width: Math.abs(x2 - x1), height: Math.abs(y2 - y1),
                fill: 'rgba(41, 121, 255, 0.14)', stroke: '#2979ff', 'stroke-width': 1
            }));
        } else if (d.type === 'fib') {
            const left = Math.min(x1, x2), right = Math.max(x1, x2);
            CHART_FIB_LEVELS.forEach(level => {
                const price = d.p1.price + (d.p2.price - d.p1.price) * level;
                const y = tools.series.priceToCoordinate(price);
                if (y === null) return;
                svg.appendChild(chartToolsSvgEl('line', {
                    x1: left, y1: y, x2: right, y2: y,
                    stroke: '#26b8cf', 'stroke-width': 1,
                    'stroke-dasharray': level === 0 || level === 1 ? 'none' : '4 3',
                    opacity: 0.9
                }));
                const label = chartToolsSvgEl('text', {
                    x: left + 4, y: y - 3,
                    fill: '#26b8cf', 'font-size': '10'
                });
                label.textContent = `${level} (${price.toFixed(2)})`;
                svg.appendChild(label);
            });
        }
    });

    // First click of a two-point drawing: show a dot so it's clear it "took"
    if (tools.pending) {
        const px = chartToolsTimeToX(tools, tools.pending.t);
        const py = tools.series.priceToCoordinate(tools.pending.price);
        if (px !== null && py !== null) {
            svg.appendChild(chartToolsSvgEl('circle', {
                cx: px, cy: py, r: 4, fill: '#dfb15b', stroke: '#0f1220', 'stroke-width': 1.5
            }));
        }
    }
}

// ---- Indicators ----
function applyChartIndicator(tools, id) {
    const def = CHART_INDICATORS[id];
    if (!def || tools.data.length === 0) return;

    const lineOpts = color => ({
        color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
    });

    // Create the series once; afterwards only refresh data
    if (!tools.indicatorSeries[id]) {
        const seriesList = [];
        if (id === 'bb') {
            seriesList.push(tools.chart.addSeries(LightweightCharts.LineSeries, lineOpts(def.color)));
            seriesList.push(tools.chart.addSeries(LightweightCharts.LineSeries, lineOpts(def.color)));
            seriesList.push(tools.chart.addSeries(LightweightCharts.LineSeries, { ...lineOpts(def.color), lineStyle: LightweightCharts.LineStyle.Dashed }));
        } else if (id === 'rsi') {
            const rsiSeries = tools.chart.addSeries(LightweightCharts.LineSeries, { ...lineOpts(def.color), lineWidth: 2 }, 1);
            rsiSeries.createPriceLine({ price: 70, color: 'rgba(246,70,93,0.55)', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: false, title: '' });
            rsiSeries.createPriceLine({ price: 30, color: 'rgba(46,189,133,0.55)', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: false, title: '' });
            seriesList.push(rsiSeries);
            const panes = tools.chart.panes ? tools.chart.panes() : [];
            if (panes[1] && panes[1].setHeight) panes[1].setHeight(110);
        } else {
            seriesList.push(tools.chart.addSeries(LightweightCharts.LineSeries, { ...lineOpts(def.color), lineWidth: 2 }));
        }
        tools.indicatorSeries[id] = seriesList;
    }

    const seriesList = tools.indicatorSeries[id];
    if (id === 'ema20') seriesList[0].setData(chartToolsEMA(tools.data, 20));
    else if (id === 'ema50') seriesList[0].setData(chartToolsEMA(tools.data, 50));
    else if (id === 'sma200') seriesList[0].setData(chartToolsSMA(tools.data, 200));
    else if (id === 'vwap') seriesList[0].setData(chartToolsVWAP(tools.data));
    else if (id === 'rsi') seriesList[0].setData(chartToolsRSI(tools.data, 14));
    else if (id === 'bb') {
        const bands = chartToolsBB(tools.data, 20, 2);
        seriesList[0].setData(bands.upper);
        seriesList[1].setData(bands.lower);
        seriesList[2].setData(bands.middle);
    }
}

function removeChartIndicator(tools, id, updateRecord) {
    const seriesList = tools.indicatorSeries[id];
    if (seriesList) {
        seriesList.forEach(s => { try { tools.chart.removeSeries(s); } catch (e) { /* already gone */ } });
        delete tools.indicatorSeries[id];
    }
    if (updateRecord) {
        const rec = getChartToolsRecord(tools.chartKey, true);
        rec.indicators = rec.indicators.filter(i => i !== id);
        saveChartToolsStore();
    }
}

function toggleChartIndicator(tools, id) {
    const rec = getChartToolsRecord(tools.chartKey, true);
    if (rec.indicators.includes(id)) {
        removeChartIndicator(tools, id, true);
    } else {
        rec.indicators.push(id);
        applyChartIndicator(tools, id);
        saveChartToolsStore();
    }
    renderChartIndMenu(tools);
    renderChartObjectTree(tools);
}

function renderChartIndMenu(tools) {
    if (tools.indMenu.style.display === 'none') return;
    const rec = getChartToolsRecord(tools.chartKey, false);
    tools.indMenu.innerHTML = '<div class="chart-tools-panel-title">INDICATORS</div>' +
        Object.keys(CHART_INDICATORS).map(id => {
            const active = rec.indicators.includes(id);
            return `<div class="chart-tools-row${active ? ' active' : ''}" data-ind="${id}">
                <span class="chart-tools-row-dot" style="background:${CHART_INDICATORS[id].color}"></span>
                <span class="chart-tools-row-label">${CHART_INDICATORS[id].label}</span>
                <i class="fa-solid ${active ? 'fa-check' : 'fa-plus'}"></i>
            </div>`;
        }).join('');

    tools.indMenu.querySelectorAll('[data-ind]').forEach(row => {
        row.addEventListener('click', e => {
            e.stopPropagation();
            toggleChartIndicator(tools, row.dataset.ind);
        });
    });
}

// ---- Object tree ----
function buildChartToolsTreePanel(tools) {
    const panel = document.createElement('div');
    panel.className = 'chart-tools-panel';
    panel.style.display = 'none';
    tools.container.appendChild(panel);
    tools.treePanel = panel;
}

function chartDrawingLabel(d) {
    if (d.type === 'hline') return `Horizontal line @ ${d.price.toFixed(2)}`;
    if (d.type === 'trend') return `Trend line ${d.p1.price.toFixed(2)} → ${d.p2.price.toFixed(2)}`;
    if (d.type === 'rect') return `Rectangle ${Math.min(d.p1.price, d.p2.price).toFixed(2)} - ${Math.max(d.p1.price, d.p2.price).toFixed(2)}`;
    if (d.type === 'fib') return `Fib ${d.p1.price.toFixed(2)} → ${d.p2.price.toFixed(2)}`;
    return d.type;
}

const CHART_DRAWING_ICONS = { trend: 'fa-slash', hline: 'fa-minus', rect: 'fa-vector-square', fib: 'fa-bars' };

function renderChartObjectTree(tools) {
    if (!tools.treePanel || tools.treePanel.style.display === 'none') return;
    const rec = getChartToolsRecord(tools.chartKey, false);

    const drawingsHtml = rec.drawings.length === 0
        ? '<div class="chart-tools-empty">No drawings yet</div>'
        : rec.drawings.map(d => `
            <div class="chart-tools-row" data-drawing="${d.id}">
                <i class="fa-solid ${CHART_DRAWING_ICONS[d.type] || 'fa-pen'} chart-tools-row-icon"></i>
                <span class="chart-tools-row-label">${chartDrawingLabel(d)}</span>
                <button type="button" class="chart-tools-row-del" title="Remove"><i class="fa-solid fa-trash"></i></button>
            </div>`).join('');

    const indicatorsHtml = rec.indicators.length === 0
        ? '<div class="chart-tools-empty">No indicators yet</div>'
        : rec.indicators.map(id => `
            <div class="chart-tools-row" data-ind-tree="${id}">
                <span class="chart-tools-row-dot" style="background:${(CHART_INDICATORS[id] || {}).color || '#888'}"></span>
                <span class="chart-tools-row-label">${(CHART_INDICATORS[id] || {}).label || id}</span>
                <button type="button" class="chart-tools-row-del" title="Remove"><i class="fa-solid fa-trash"></i></button>
            </div>`).join('');

    tools.treePanel.innerHTML = `
        <div class="chart-tools-panel-title">OBJECT TREE</div>
        <div class="chart-tools-section">Drawings</div>
        ${drawingsHtml}
        <div class="chart-tools-section">Indicators</div>
        ${indicatorsHtml}
        ${(rec.drawings.length > 0 || rec.indicators.length > 0)
            ? '<button type="button" class="chart-tools-clear-all"><i class="fa-solid fa-trash"></i> Clear all</button>'
            : ''}`;

    tools.treePanel.querySelectorAll('[data-drawing] .chart-tools-row-del').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            deleteChartDrawing(tools, btn.closest('[data-drawing]').dataset.drawing);
        });
    });
    tools.treePanel.querySelectorAll('[data-ind-tree] .chart-tools-row-del').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            removeChartIndicator(tools, btn.closest('[data-ind-tree]').dataset.indTree, true);
            renderChartObjectTree(tools);
        });
    });
    const clearBtn = tools.treePanel.querySelector('.chart-tools-clear-all');
    if (clearBtn) {
        clearBtn.addEventListener('click', e => {
            e.stopPropagation();
            clearAllChartObjects(tools);
        });
    }
}

function deleteChartDrawing(tools, drawingId) {
    const rec = getChartToolsRecord(tools.chartKey, true);
    const drawing = rec.drawings.find(d => d.id === drawingId);
    rec.drawings = rec.drawings.filter(d => d.id !== drawingId);

    if (drawing && drawing.type === 'hline' && tools.priceLines[drawingId]) {
        try { tools.series.removePriceLine(tools.priceLines[drawingId]); } catch (e) { /* gone */ }
        delete tools.priceLines[drawingId];
    }

    saveChartToolsStore();
    renderChartDrawings(tools);
    renderChartObjectTree(tools);
}

function clearAllChartObjects(tools) {
    const rec = getChartToolsRecord(tools.chartKey, true);

    Object.keys(tools.priceLines).forEach(id => {
        try { tools.series.removePriceLine(tools.priceLines[id]); } catch (e) { /* gone */ }
        delete tools.priceLines[id];
    });
    rec.indicators.slice().forEach(id => removeChartIndicator(tools, id, false));

    rec.drawings = [];
    rec.indicators = [];

    saveChartToolsStore();
    renderChartDrawings(tools);
    renderChartObjectTree(tools);
}

// Load persisted drawings/indicators as soon as auth state is known
loadChartToolsStore();
