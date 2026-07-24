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
    buildChartEditBar(tools);

    tools.chart.subscribeClick(param => handleChartToolsClick(tools, param));
    tools.chart.timeScale().subscribeVisibleLogicalRangeChange(() => renderChartDrawings(tools));

    // Live preview: while a tool is armed, the ghost shape follows the
    // crosshair (TradingView-style rubber banding).
    tools.chart.subscribeCrosshairMove(param => {
        if (!tools.activeTool || tools.data.length === 0) { tools.hoverPoint = null; return; }
        if (!param.point) { tools.hoverPoint = null; renderChartDrawings(tools); return; }
        let t = param.time;
        if (t === undefined && typeof param.logical === 'number') {
            const idx = Math.max(0, Math.min(tools.data.length - 1, Math.round(param.logical)));
            t = tools.data[idx].time;
        }
        const price = tools.series.coordinateToPrice(param.point.y);
        if (t === undefined || price === null) { tools.hoverPoint = null; renderChartDrawings(tools); return; }
        tools.hoverPoint = { t, price };
        renderChartDrawings(tools);
    });

    // Editing: drag handles/bodies of placed drawings (mousedown starts on
    // the SVG shapes, move/up tracked window-wide so fast drags don't slip)
    tools.svg.addEventListener('mousedown', e => beginChartDrawingDrag(tools, e));
    tools.windowMoveHandler = e => moveChartDrawingDrag(tools, e);
    tools.windowUpHandler = () => endChartDrawingDrag(tools);
    window.addEventListener('mousemove', tools.windowMoveHandler);
    window.addEventListener('mouseup', tools.windowUpHandler);

    // Touch equivalents so drawings can be grabbed and dragged on phones/tablets.
    // touchstart is non-passive so beginChartDrawingDrag can preventDefault when
    // it lands on a handle; touchmove is non-passive so an in-progress drag can
    // stop the page/chart from scrolling underneath the finger.
    tools.svg.addEventListener('touchstart', e => beginChartDrawingDrag(tools, e), { passive: false });
    tools.windowTouchMoveHandler = e => {
        if (tools.drag) e.preventDefault();
        moveChartDrawingDrag(tools, e);
    };
    tools.windowTouchEndHandler = () => endChartDrawingDrag(tools);
    window.addEventListener('touchmove', tools.windowTouchMoveHandler, { passive: false });
    window.addEventListener('touchend', tools.windowTouchEndHandler);
    window.addEventListener('touchcancel', tools.windowTouchEndHandler);

    tools.resizeObserver = new ResizeObserver(() => renderChartDrawings(tools));
    tools.resizeObserver.observe(tools.container);

    // Vertical rescales fire NO event in Lightweight Charts (dragging the
    // price axis, the A/L auto-scale/log buttons, autoscale adjusting to new
    // data) - drawings used to lag behind the candles until the next
    // crosshair move re-rendered them. A cheap per-frame probe of where two
    // reference prices land catches any vertical shift/stretch and re-renders
    // only when the mapping actually changed.
    const probeVerticalScale = () => {
        if (tools.disposed) return;
        if (tools.data.length > 0) {
            const p = tools.data[0].close;
            const fingerprint = `${tools.series.priceToCoordinate(p)}|${tools.series.priceToCoordinate(p * 1.01 + 1)}`;
            if (fingerprint !== tools.scaleFingerprint) {
                tools.scaleFingerprint = fingerprint;
                renderChartDrawings(tools);
            }
        }
        requestAnimationFrame(probeVerticalScale);
    };
    requestAnimationFrame(probeVerticalScale);

    tools.keyHandler = e => {
        if (e.key === 'Escape' && (tools.activeTool || tools.pending || tools.selectedId)) {
            tools.selectedId = null;
            setChartToolsActive(tools, null);
        }
        if ((e.key === 'Delete' || e.key === 'Backspace') && tools.selectedId && !tools.activeTool) {
            const target = e.target;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
            e.preventDefault();
            deleteChartDrawing(tools, tools.selectedId);
            tools.selectedId = null;
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
        window.removeEventListener('mousemove', tools.windowMoveHandler);
        window.removeEventListener('mouseup', tools.windowUpHandler);
        window.removeEventListener('touchmove', tools.windowTouchMoveHandler);
        window.removeEventListener('touchend', tools.windowTouchEndHandler);
        window.removeEventListener('touchcancel', tools.windowTouchEndHandler);
        if (tools.resizeObserver) tools.resizeObserver.disconnect();
        liveChartTools.delete(tools);
    };

    liveChartTools.add(tools);
    return tools;
}

// ---- Drag-to-edit ----
function chartToolsCoordToTime(tools, x) {
    const logical = tools.chart.timeScale().coordinateToLogical(x);
    if (logical === null || tools.data.length === 0) return null;
    const idx = Math.max(0, Math.min(tools.data.length - 1, Math.round(logical)));
    return tools.data[idx].time;
}

// Works for both mouse and touch events - a touch drag reads the first
// (or last, on touchend) touch point, so the same drag logic drives finger
// and cursor alike.
function chartToolsMouseXY(tools, e) {
    const rect = tools.svg.getBoundingClientRect();
    const p = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;
    return { x: p.clientX - rect.left, y: p.clientY - rect.top };
}

function beginChartDrawingDrag(tools, e) {
    if (tools.activeTool) return; // drawing mode: clicks pass through to placement
    const target = e.target.closest('[data-drawing-id]');
    if (!target) return;

    e.preventDefault();
    e.stopPropagation();

    const id = target.dataset.drawingId;
    const rec = getChartToolsRecord(tools.chartKey, false);
    const drawing = rec.drawings.find(d => d.id === id);
    if (!drawing) return;

    tools.selectedId = id;

    // Locked drawings can be selected (to unlock/restyle/delete via the
    // edit bar) but never dragged
    if (drawing.locked) {
        renderChartDrawings(tools);
        return;
    }

    const { x, y } = chartToolsMouseXY(tools, e);
    tools.drag = {
        id,
        mode: target.dataset.handle || 'move',
        startX: x,
        startY: y,
        orig: JSON.parse(JSON.stringify(drawing)),
        moved: false
    };
    renderChartDrawings(tools);
}

function moveChartDrawingDrag(tools, e) {
    if (!tools.drag || tools.disposed) return;
    const rec = getChartToolsRecord(tools.chartKey, false);
    const drawing = rec.drawings.find(d => d.id === tools.drag.id);
    if (!drawing) { tools.drag = null; return; }

    const { x, y } = chartToolsMouseXY(tools, e);
    const dx = x - tools.drag.startX;
    const dy = y - tools.drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 2) tools.drag.moved = true;

    const orig = tools.drag.orig;
    const ts = tools.chart.timeScale();

    const movePoint = (origPoint, targetPoint) => {
        const origX = ts.timeToCoordinate(origPoint.t);
        const origY = tools.series.priceToCoordinate(origPoint.price);
        if (origX === null || origY === null) return;
        const t = chartToolsCoordToTime(tools, origX + dx);
        const price = tools.series.coordinateToPrice(origY + dy);
        if (t !== null) targetPoint.t = t;
        if (price !== null) targetPoint.price = price;
    };

    if (drawing.type === 'longpos' || drawing.type === 'shortpos') {
        const long = drawing.type === 'longpos';
        const priceAt = (origPrice) => {
            const origY = tools.series.priceToCoordinate(origPrice);
            return origY === null ? null : tools.series.coordinateToPrice(origY + dy);
        };
        const timeAt = (origT) => {
            const origX = tools.chart.timeScale().timeToCoordinate(origT);
            return origX === null ? null : chartToolsCoordToTime(tools, origX + dx);
        };

        if (tools.drag.mode === 'target') {
            const p = priceAt(orig.target);
            if (p !== null) drawing.target = long ? Math.max(p, drawing.entry) : Math.min(p, drawing.entry);
        } else if (tools.drag.mode === 'stop') {
            const p = priceAt(orig.stop);
            if (p !== null) drawing.stop = long ? Math.min(p, drawing.entry) : Math.max(p, drawing.entry);
        } else if (tools.drag.mode === 'entry') {
            const p = priceAt(orig.entry);
            if (p !== null) {
                drawing.entry = long
                    ? Math.max(drawing.stop, Math.min(drawing.target, p))
                    : Math.max(drawing.target, Math.min(drawing.stop, p));
            }
        } else if (tools.drag.mode === 'left') {
            const t = timeAt(orig.t1);
            if (t !== null && t !== drawing.t2) drawing.t1 = t;
        } else if (tools.drag.mode === 'right') {
            const t = timeAt(orig.t2);
            if (t !== null && t !== drawing.t1) drawing.t2 = t;
        } else {
            const pEntry = priceAt(orig.entry), pTarget = priceAt(orig.target), pStop = priceAt(orig.stop);
            const t1 = timeAt(orig.t1), t2 = timeAt(orig.t2);
            if (pEntry !== null && pTarget !== null && pStop !== null) {
                drawing.entry = pEntry; drawing.target = pTarget; drawing.stop = pStop;
            }
            if (t1 !== null && t2 !== null && t1 !== t2) { drawing.t1 = t1; drawing.t2 = t2; }
        }
        renderChartDrawings(tools);
        return;
    }

    if (drawing.type === 'hline') {
        const origY = tools.series.priceToCoordinate(orig.price);
        if (origY !== null) {
            const price = tools.series.coordinateToPrice(origY + dy);
            if (price !== null) {
                drawing.price = price;
                if (tools.priceLines[drawing.id]) tools.priceLines[drawing.id].applyOptions({ price });
            }
        }
    } else if (drawing.type === 'vline') {
        const origX = ts.timeToCoordinate(orig.t);
        if (origX !== null) {
            const t = chartToolsCoordToTime(tools, origX + dx);
            if (t !== null) drawing.t = t;
        }
    } else if (tools.drag.mode === 'p1') {
        movePoint(orig.p1, drawing.p1);
    } else if (tools.drag.mode === 'p2') {
        movePoint(orig.p2, drawing.p2);
    } else {
        movePoint(orig.p1, drawing.p1);
        movePoint(orig.p2, drawing.p2);
    }

    renderChartDrawings(tools);
}

function endChartDrawingDrag(tools) {
    if (!tools.drag) return;
    const moved = tools.drag.moved;
    tools.drag = null;
    if (moved) {
        saveChartToolsStore();
        renderChartObjectTree(tools);
    }
    renderChartDrawings(tools);
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
    { id: 'vline', icon: 'fa-grip-lines-vertical', title: 'Vertical line (1 click)' },
    { id: 'rect', icon: 'fa-vector-square', title: 'Rectangle zone (2 clicks)' },
    { id: 'fib', icon: 'fa-bars', title: 'Fib retracement (2 clicks: high, low)' },
    { id: 'longpos', icon: 'fa-arrow-trend-up', title: 'Long position (1 click - drag target/stop after)' },
    { id: 'shortpos', icon: 'fa-arrow-trend-down', title: 'Short position (1 click - drag target/stop after)' }
];

// Sensible defaults for a freshly placed position: stop 2 ATR(14) away,
// target 4 ATR (2:1 reward-to-risk), spanning ~20 bars to the right.
function buildPositionDrawing(tools, type, t, price) {
    const data = tools.data;
    const idx = chartToolsNearestIndex(data, t);
    const recent = data.slice(Math.max(0, idx - 14), idx + 1);
    const atr = recent.length > 0
        ? recent.reduce((s, bar) => s + (bar.high - bar.low), 0) / recent.length
        : price * 0.005;
    const risk = Math.max(atr * 2, price * 0.0005);

    let endIdx = Math.min(data.length - 1, idx + 20);
    let t1 = t, t2 = data[endIdx].time;
    if (endIdx === idx) { t1 = data[Math.max(0, idx - 20)].time; t2 = t; }

    return {
        id: chartToolsId(),
        type,
        t1, t2,
        entry: price,
        stop: type === 'longpos' ? price - risk : price + risk,
        target: type === 'longpos' ? price + risk * 2 : price - risk * 2
    };
}

function buildChartToolsToolbar(tools) {
    const bar = document.createElement('div');
    // Starts minimized on every chart (down to just the grip + chevron) -
    // drawing tools are opt-in, so there's no reason to eat vertical space
    // on charts nobody's drawing on yet. One click expands it.
    bar.className = 'chart-tools-bar collapsed';

    // Grip handle: drag to move the whole toolbar anywhere inside the chart,
    // so it never has to sit on top of the candles you care about.
    const grip = document.createElement('div');
    grip.className = 'chart-tools-grip';
    grip.title = 'Drag to move';
    grip.innerHTML = '<i class="fa-solid fa-grip-lines"></i>';
    // Draggable by mouse or touch. A tiny coord helper reads whichever the
    // event carries, so one code path serves both.
    const gripPoint = ev => {
        const p = (ev.touches && ev.touches[0]) || (ev.changedTouches && ev.changedTouches[0]) || ev;
        return { x: p.clientX, y: p.clientY };
    };
    const startGripDrag = e => {
        e.preventDefault();
        e.stopPropagation();
        const start = gripPoint(e);
        const startLeft = bar.offsetLeft, startTop = bar.offsetTop;

        const onMove = ev => {
            if (ev.cancelable) ev.preventDefault();
            const pt = gripPoint(ev);
            const maxLeft = tools.container.clientWidth - bar.offsetWidth;
            const maxTop = tools.container.clientHeight - bar.offsetHeight;
            bar.style.left = `${Math.max(0, Math.min(maxLeft, startLeft + pt.x - start.x))}px`;
            bar.style.top = `${Math.max(0, Math.min(maxTop, startTop + pt.y - start.y))}px`;
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchend', onUp);
            positionChartToolsPanels(tools);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onUp);
    };
    grip.addEventListener('mousedown', startGripDrag);
    grip.addEventListener('touchstart', startGripDrag, { passive: false });
    bar.appendChild(grip);

    // Collapse/expand the rail down to just the grip + this chevron
    const collapseBtn = document.createElement('button');
    collapseBtn.type = 'button';
    collapseBtn.className = 'chart-tools-btn chart-tools-collapse';
    collapseBtn.title = 'Expand toolbar';
    collapseBtn.innerHTML = '<i class="fa-solid fa-chevron-down"></i>';
    collapseBtn.addEventListener('click', e => {
        e.stopPropagation();
        const collapsed = bar.classList.toggle('collapsed');
        collapseBtn.querySelector('i').className = `fa-solid ${collapsed ? 'fa-chevron-down' : 'fa-chevron-up'}`;
        collapseBtn.title = collapsed ? 'Expand toolbar' : 'Minimize toolbar';
        if (collapsed) {
            tools.indMenu.style.display = 'none';
            tools.treePanel.style.display = 'none';
            setChartToolsActive(tools, null);
        }
    });
    bar.appendChild(collapseBtn);

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
    tools.hoverPoint = null;
    tools.selectedId = null;
    tools.toolbar.querySelectorAll('.chart-tools-btn[data-tool]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tool === toolId);
    });
    tools.container.classList.toggle('chart-tools-drawing', !!toolId);
    renderChartDrawings(tools); // clears any pending-point marker
}

// ---- Click handling / drawing placement ----
function handleChartToolsClick(tools, param) {
    // Clicking empty chart with no tool armed deselects (drawing clicks are
    // captured by the SVG shapes and never reach the chart)
    if (!tools.activeTool) {
        if (tools.selectedId) {
            tools.selectedId = null;
            renderChartDrawings(tools);
        }
        return;
    }
    if (!param.point || tools.data.length === 0) return;

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

    if (tools.activeTool === 'vline') {
        rec.drawings.push({ id: chartToolsId(), type: 'vline', t });
        finishChartDrawing(tools);
        return;
    }

    if (tools.activeTool === 'longpos' || tools.activeTool === 'shortpos') {
        const drawing = buildPositionDrawing(tools, tools.activeTool, t, price);
        rec.drawings.push(drawing);
        finishChartDrawing(tools);
        // Select immediately (after finish clears state) so the target/stop
        // handles are ready to drag, like TradingView
        tools.selectedId = drawing.id;
        renderChartDrawings(tools);
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

// ---- Per-drawing style (editable via the floating edit bar) ----
const CHART_DRAWING_DEFAULTS = {
    trend: { color: '#dfb15b', width: 2, style: 'solid' },
    hline: { color: '#dfb15b', width: 1, style: 'dashed' },
    vline: { color: '#dfb15b', width: 1.5, style: 'dashed' },
    rect: { color: '#2979ff', width: 1, style: 'solid' },
    fib: { color: '#26b8cf', width: 1, style: 'solid' }
};

const CHART_EDIT_COLORS = ['#dfb15b', '#2979ff', '#26b8cf', '#2ebd85', '#f6465d', '#9d6bff', '#e8e8e8'];

function drawingColor(d) { return d.color || (CHART_DRAWING_DEFAULTS[d.type] || {}).color || '#dfb15b'; }
function drawingWidth(d) { return d.width || (CHART_DRAWING_DEFAULTS[d.type] || {}).width || 2; }
function drawingStyle(d) { return d.style || (CHART_DRAWING_DEFAULTS[d.type] || {}).style || 'solid'; }

function drawingDashArray(d, ghost) {
    if (ghost) return '6 4';
    const style = drawingStyle(d);
    if (style === 'dashed') return '6 4';
    if (style === 'dotted') return '2 3';
    return 'none';
}

function chartHexToRgba(hex, alpha) {
    const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return hex;
    return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

function chartLineStyleEnum(d) {
    const style = drawingStyle(d);
    if (style === 'dashed') return LightweightCharts.LineStyle.Dashed;
    if (style === 'dotted') return LightweightCharts.LineStyle.Dotted;
    return LightweightCharts.LineStyle.Solid;
}

// ---- Horizontal lines (native price lines: full width + axis label) ----
function ensureChartHLine(tools, drawing) {
    if (tools.priceLines[drawing.id]) return;
    tools.priceLines[drawing.id] = tools.series.createPriceLine({
        price: drawing.price,
        color: drawingColor(drawing),
        lineWidth: Math.round(drawingWidth(drawing)),
        lineStyle: chartLineStyleEnum(drawing),
        axisLabelVisible: true,
        title: ''
    });
}

function refreshChartHLineStyle(tools, drawing) {
    const line = tools.priceLines[drawing.id];
    if (!line) return;
    line.applyOptions({
        price: drawing.price,
        color: drawingColor(drawing),
        lineWidth: Math.round(drawingWidth(drawing)),
        lineStyle: chartLineStyleEnum(drawing)
    });
}

// ---- SVG rendering for trend / rect / fib ----
function chartToolsSvgEl(name, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', name);
    Object.keys(attrs).forEach(k => el.setAttribute(k, attrs[k]));
    return el;
}

const CHART_FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

// Renders one drawing's shapes into the svg. opts: { ghost, selected,
// interactive } - ghost = live preview styling, interactive = shapes accept
// mouse events (selection/drag) via data-drawing-id.
function renderChartDrawingShape(tools, svg, d, opts) {
    const ghost = !!opts.ghost;
    const selected = !!opts.selected;
    const pe = opts.interactive && !ghost ? 'stroke' : 'none';
    const dash = ghost ? '6 4' : 'none';
    const alpha = ghost ? 0.6 : 1;
    const grabAttrs = el => {
        if (!ghost && opts.interactive) {
            el.setAttribute('data-drawing-id', d.id);
            el.setAttribute('class', 'ct-grab');
        }
        return el;
    };

    const color = drawingColor(d);
    const baseWidth = drawingWidth(d);
    const dashPattern = drawingDashArray(d, ghost);

    const handles = [];
    const addHandle = (x, y, which) => {
        if (!selected || d.locked) return;
        handles.push(chartToolsSvgEl('circle', {
            cx: x, cy: y, r: 5,
            fill: '#ffffff', stroke: '#2979ff', 'stroke-width': 2,
            'data-drawing-id': d.id, 'data-handle': which,
            'class': 'ct-handle', 'pointer-events': 'all'
        }));
    };

    if (d.type === 'hline') {
        const y = tools.series.priceToCoordinate(d.price);
        if (y === null) return;
        const w = svg.clientWidth || tools.container.clientWidth;
        // Wide invisible grab strip over the native price line
        const grab = grabAttrs(chartToolsSvgEl('line', {
            x1: 0, y1: y, x2: w, y2: y,
            stroke: 'rgba(0,0,0,0)', 'stroke-width': 10, 'pointer-events': pe
        }));
        svg.appendChild(grab);
        if (selected || ghost) {
            svg.appendChild(chartToolsSvgEl('line', {
                x1: 0, y1: y, x2: w, y2: y,
                stroke: color, 'stroke-width': Math.max(2, baseWidth),
                'stroke-dasharray': ghost ? '6 4' : 'none', opacity: alpha,
                'pointer-events': 'none'
            }));
            if (selected && !ghost) addHandle(w / 2, y, 'move');
        }
        handles.forEach(h => svg.appendChild(h));
        return;
    }

    if (d.type === 'vline') {
        const x = chartToolsTimeToX(tools, d.t);
        if (x === null) return;
        const h = svg.clientHeight || tools.container.clientHeight;
        svg.appendChild(chartToolsSvgEl('line', {
            x1: x, y1: 0, x2: x, y2: h,
            stroke: color, 'stroke-width': selected ? baseWidth + 0.5 : baseWidth,
            'stroke-dasharray': dashPattern === 'none' ? '4 3' : dashPattern, opacity: alpha,
            'pointer-events': 'none'
        }));

        // Time badge pinned over the time axis at the foot of the line,
        // like TradingView's axis tag. Same UTC formatting the axis uses.
        const timeText = new Date(d.t * 1000).toISOString().slice(11, 16);
        let badgeTop = h - 18;
        try {
            const axisH = tools.chart.timeScale().height();
            if (axisH > 0) badgeTop = h - axisH + 1;
        } catch (e) { /* keep fallback */ }
        const badgeW = 40, badgeH = 15;
        svg.appendChild(chartToolsSvgEl('rect', {
            x: x - badgeW / 2, y: badgeTop, width: badgeW, height: badgeH,
            rx: 3, fill: color, opacity: alpha, 'pointer-events': 'none'
        }));
        const timeLabel = chartToolsSvgEl('text', {
            x, y: badgeTop + badgeH / 2 + 3.5, fill: '#0f1220', 'font-size': '10',
            'font-weight': '700', 'text-anchor': 'middle', 'pointer-events': 'none'
        });
        timeLabel.textContent = timeText;
        svg.appendChild(timeLabel);

        const grab = grabAttrs(chartToolsSvgEl('line', {
            x1: x, y1: 0, x2: x, y2: h,
            stroke: 'rgba(0,0,0,0)', 'stroke-width': 10, 'pointer-events': pe
        }));
        svg.appendChild(grab);
        addHandle(x, h / 2, 'move');
        handles.forEach(el => svg.appendChild(el));
        return;
    }

    if (d.type === 'longpos' || d.type === 'shortpos') {
        const xa = chartToolsTimeToX(tools, d.t1);
        const xb = chartToolsTimeToX(tools, d.t2);
        const yEntry = tools.series.priceToCoordinate(d.entry);
        const yTarget = tools.series.priceToCoordinate(d.target);
        const yStop = tools.series.priceToCoordinate(d.stop);
        if (xa === null || xb === null || yEntry === null || yTarget === null || yStop === null) return;

        const left = Math.min(xa, xb), right = Math.max(xa, xb);
        const width = Math.max(right - left, 1);
        const midX = left + width / 2;
        const decimals = d.entry < 10 ? 4 : 2;
        const posPe = opts.interactive && !ghost ? 'all' : 'none';

        const zone = (yA, yB, fillColor, zoneHandle) => {
            const rect = chartToolsSvgEl('rect', {
                x: left, y: Math.min(yA, yB),
                width, height: Math.max(Math.abs(yB - yA), 1),
                fill: fillColor, stroke: 'none', opacity: alpha,
                'pointer-events': posPe
            });
            if (!ghost && opts.interactive) {
                rect.setAttribute('data-drawing-id', d.id);
                rect.setAttribute('class', 'ct-grab');
            }
            svg.appendChild(rect);
        };

        zone(yEntry, yTarget, 'rgba(46, 189, 133, 0.16)');
        zone(yEntry, yStop, 'rgba(246, 70, 93, 0.16)');

        // Target / stop / entry edge lines
        [[yTarget, '#2ebd85'], [yStop, '#f6465d'], [yEntry, 'rgba(255,255,255,0.75)']].forEach(([y, stroke]) => {
            svg.appendChild(chartToolsSvgEl('line', {
                x1: left, y1: y, x2: right, y2: y,
                stroke, 'stroke-width': selected ? 2 : 1.2, opacity: alpha, 'pointer-events': 'none'
            }));
        });

        if (!ghost) {
            const long = d.type === 'longpos';
            const risk = Math.abs(d.entry - d.stop);
            const reward = Math.abs(d.target - d.entry);
            const rr = risk > 0 ? (reward / risk) : 0;
            const pct = v => ((v / d.entry) * 100).toFixed(2);

            const svgH = svg.clientHeight || tools.container.clientHeight;
            const clampY = y => Math.max(12, Math.min(svgH - 12, y));

            // TradingView-style solid label pill: the text is appended first
            // so its real rendered width can be measured, then a snug rounded
            // rect is slotted in underneath - readable over any candles,
            // unlike the old bare floating text.
            const addPill = (cx, cy, text, bg) => {
                const t = chartToolsSvgEl('text', {
                    x: cx, y: cy + 3.5, fill: '#ffffff', 'font-size': '10',
                    'font-weight': '700', 'text-anchor': 'middle', 'pointer-events': 'none'
                });
                t.textContent = text;
                svg.appendChild(t);
                let w;
                try { w = t.getComputedTextLength(); } catch (e) { w = text.length * 5.6; }
                svg.insertBefore(chartToolsSvgEl('rect', {
                    x: cx - w / 2 - 8, y: cy - 9, width: w + 16, height: 18,
                    rx: 4, fill: bg, opacity: alpha, 'pointer-events': 'none'
                }), t);
            };

            // Pills sit OUTSIDE the box like TradingView's: target pill on the
            // far side of the target edge, stop pill on the far side of the
            // stop edge - clamped so they never disappear off-chart.
            const outside = (yEdge, yRef) => clampY(yEdge < yRef ? yEdge - 11 : yEdge + 11);
            addPill(midX, outside(yTarget, yEntry),
                `Target: ${d.target.toFixed(decimals)} (+${reward.toFixed(decimals)} / ${pct(reward)}%)`, '#2ebd85');
            addPill(midX, outside(yStop, yEntry),
                `Stop: ${d.stop.toFixed(decimals)} (-${risk.toFixed(decimals)} / ${pct(risk)}%)`, '#f6465d');

            // Centered info card straddling the entry line (TradingView's
            // middle "Risk/Reward ratio" box), dark to match the app theme.
            const cardLines = [
                `${long ? 'Long' : 'Short'} ${d.entry.toFixed(decimals)}`,
                `Risk/Reward ratio: ${rr.toFixed(2)}`
            ];
            const cardTexts = cardLines.map((line, i) => {
                const t = chartToolsSvgEl('text', {
                    x: midX, y: clampY(yEntry) - 16 + 13 + i * 13 + 3.5,
                    fill: i === 0 ? '#ffffff' : '#d1d4dc', 'font-size': '10',
                    'font-weight': i === 0 ? '700' : '400',
                    'text-anchor': 'middle', 'pointer-events': 'none'
                });
                t.textContent = line;
                svg.appendChild(t);
                return t;
            });
            let cardW = 0;
            cardTexts.forEach(t => {
                try { cardW = Math.max(cardW, t.getComputedTextLength()); } catch (e) { cardW = Math.max(cardW, t.textContent.length * 5.6); }
            });
            svg.insertBefore(chartToolsSvgEl('rect', {
                x: midX - cardW / 2 - 10, y: clampY(yEntry) - 16, width: cardW + 20, height: 32,
                rx: 4, fill: 'rgba(15, 18, 32, 0.92)', stroke: '#2a2e39',
                'stroke-width': 1, opacity: alpha, 'pointer-events': 'none'
            }), cardTexts[0]);
        }

        // Square drag handles like TradingView's (the shared addHandle circles
        // are for line tools) - same class/data attributes, so the existing
        // drag logic works unchanged.
        const addSquareHandle = (x, y, which) => {
            if (!selected || d.locked) return;
            handles.push(chartToolsSvgEl('rect', {
                x: x - 4.5, y: y - 4.5, width: 9, height: 9, rx: 1.5,
                fill: '#ffffff', stroke: '#2979ff', 'stroke-width': 2,
                'data-drawing-id': d.id, 'data-handle': which,
                'class': 'ct-handle', 'pointer-events': 'all'
            }));
        };
        addSquareHandle(midX, yTarget, 'target');
        addSquareHandle(midX, yStop, 'stop');
        addSquareHandle(midX, yEntry, 'entry');
        addSquareHandle(left, yEntry, 'left');
        addSquareHandle(right, yEntry, 'right');
        handles.forEach(el => svg.appendChild(el));
        return;
    }

    const x1 = chartToolsTimeToX(tools, d.p1.t);
    const x2 = chartToolsTimeToX(tools, d.p2.t);
    const y1 = tools.series.priceToCoordinate(d.p1.price);
    const y2 = tools.series.priceToCoordinate(d.p2.price);
    if (x1 === null || x2 === null || y1 === null || y2 === null) return;

    if (d.type === 'trend') {
        svg.appendChild(chartToolsSvgEl('line', {
            x1, y1, x2, y2,
            stroke: color, 'stroke-width': selected ? baseWidth + 1 : baseWidth,
            'stroke-linecap': 'round', 'stroke-dasharray': dashPattern, opacity: alpha,
            'pointer-events': 'none'
        }));
        svg.appendChild(grabAttrs(chartToolsSvgEl('line', {
            x1, y1, x2, y2,
            stroke: 'rgba(0,0,0,0)', 'stroke-width': 12, 'pointer-events': pe
        })));
    } else if (d.type === 'rect') {
        const rect = grabAttrs(chartToolsSvgEl('rect', {
            x: Math.min(x1, x2), y: Math.min(y1, y2),
            width: Math.abs(x2 - x1), height: Math.abs(y2 - y1),
            fill: chartHexToRgba(color, 0.14), stroke: color,
            'stroke-width': selected ? baseWidth + 1 : baseWidth, 'stroke-dasharray': dashPattern, opacity: alpha,
            'pointer-events': opts.interactive && !ghost ? 'all' : 'none'
        }));
        svg.appendChild(rect);
    } else if (d.type === 'fib') {
        const left = Math.min(x1, x2), right = Math.max(x1, x2);
        CHART_FIB_LEVELS.forEach(level => {
            const price = d.p1.price + (d.p2.price - d.p1.price) * level;
            const y = tools.series.priceToCoordinate(price);
            if (y === null) return;
            svg.appendChild(chartToolsSvgEl('line', {
                x1: left, y1: y, x2: right, y2: y,
                stroke: color, 'stroke-width': level === 0 || level === 1 ? (selected ? baseWidth + 1 : baseWidth) : baseWidth,
                'stroke-dasharray': ghost ? '6 4' : (level === 0 || level === 1 ? dashPattern : '4 3'),
                opacity: ghost ? 0.6 : 0.9,
                'pointer-events': 'none'
            }));
            if (!ghost) {
                const label = chartToolsSvgEl('text', {
                    x: left + 4, y: y - 3,
                    fill: color, 'font-size': '10', 'pointer-events': 'none'
                });
                label.textContent = `${level} (${price.toFixed(2)})`;
                svg.appendChild(label);
            }
        });
        // Grab strips along the two anchor levels
        [y1, y2].forEach(y => {
            svg.appendChild(grabAttrs(chartToolsSvgEl('line', {
                x1: left, y1: y, x2: right, y2: y,
                stroke: 'rgba(0,0,0,0)', 'stroke-width': 10, 'pointer-events': pe
            })));
        });
    }

    addHandle(x1, y1, 'p1');
    addHandle(x2, y2, 'p2');
    handles.forEach(el => svg.appendChild(el));
}

function renderChartDrawings(tools) {
    if (tools.disposed) return;
    const svg = tools.svg;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (tools.data.length === 0) return;

    const rec = getChartToolsRecord(tools.chartKey, false);
    const interactive = !tools.activeTool;

    rec.drawings.forEach(d => {
        renderChartDrawingShape(tools, svg, d, {
            interactive,
            selected: d.id === tools.selectedId && interactive
        });
    });

    // Live preview: ghost of the shape being drawn, following the crosshair
    if (tools.activeTool && tools.hoverPoint) {
        if (tools.pending) {
            renderChartDrawingShape(tools, svg, {
                id: '__preview__', type: tools.activeTool,
                p1: tools.pending, p2: tools.hoverPoint
            }, { ghost: true });
        } else if (tools.activeTool === 'hline') {
            renderChartDrawingShape(tools, svg, { id: '__preview__', type: 'hline', price: tools.hoverPoint.price }, { ghost: true });
        } else if (tools.activeTool === 'vline') {
            renderChartDrawingShape(tools, svg, { id: '__preview__', type: 'vline', t: tools.hoverPoint.t }, { ghost: true });
        } else if (tools.activeTool === 'longpos' || tools.activeTool === 'shortpos') {
            const preview = buildPositionDrawing(tools, tools.activeTool, tools.hoverPoint.t, tools.hoverPoint.price);
            preview.id = '__preview__';
            renderChartDrawingShape(tools, svg, preview, { ghost: true });
        }
    }

    // First click of a two-point drawing: anchor dot
    if (tools.pending) {
        const px = chartToolsTimeToX(tools, tools.pending.t);
        const py = tools.series.priceToCoordinate(tools.pending.price);
        if (px !== null && py !== null) {
            svg.appendChild(chartToolsSvgEl('circle', {
                cx: px, cy: py, r: 4, fill: '#dfb15b', stroke: '#0f1220', 'stroke-width': 1.5, 'pointer-events': 'none'
            }));
        }
    }

    updateChartEditBar(tools);
}

// ---- Floating per-drawing edit bar (color / width / style / lock / delete) ----
function buildChartEditBar(tools) {
    const bar = document.createElement('div');
    bar.className = 'ct-edit-bar';
    bar.style.display = 'none';
    bar.addEventListener('mousedown', e => e.stopPropagation());

    bar.innerHTML = `
        <div class="ct-edit-colors">${CHART_EDIT_COLORS.map(c =>
            `<button type="button" class="ct-edit-color" data-color="${c}" style="background:${c}" title="Line color"></button>`).join('')}
        </div>
        <div class="chart-tools-sep ct-edit-sep"></div>
        <button type="button" class="ct-edit-btn" data-action="width" title="Line thickness (click to cycle)">2px</button>
        <button type="button" class="ct-edit-btn" data-action="style" title="Line style (click to cycle)"><span class="ct-style-preview"></span></button>
        <div class="chart-tools-sep ct-edit-sep"></div>
        <button type="button" class="ct-edit-btn" data-action="lock" title="Lock (prevents dragging)"><i class="fa-solid fa-lock-open"></i></button>
        <button type="button" class="ct-edit-btn ct-edit-del" data-action="delete" title="Delete drawing"><i class="fa-solid fa-trash"></i></button>`;

    bar.addEventListener('click', e => {
        e.stopPropagation();
        const rec = getChartToolsRecord(tools.chartKey, false);
        const drawing = rec.drawings.find(d => d.id === tools.selectedId);
        if (!drawing) return;

        const colorBtn = e.target.closest('.ct-edit-color');
        if (colorBtn) {
            drawing.color = colorBtn.dataset.color;
        } else {
            const action = (e.target.closest('[data-action]') || {}).dataset && e.target.closest('[data-action]').dataset.action;
            if (action === 'width') {
                const widths = [1, 2, 3, 4];
                drawing.width = widths[(widths.indexOf(Math.round(drawingWidth(drawing))) + 1) % widths.length];
            } else if (action === 'style') {
                const styles = ['solid', 'dashed', 'dotted'];
                drawing.style = styles[(styles.indexOf(drawingStyle(drawing)) + 1) % styles.length];
            } else if (action === 'lock') {
                drawing.locked = !drawing.locked;
            } else if (action === 'delete') {
                deleteChartDrawing(tools, drawing.id);
                tools.selectedId = null;
                renderChartDrawings(tools);
                return;
            } else {
                return;
            }
        }

        if (drawing.type === 'hline') refreshChartHLineStyle(tools, drawing);
        saveChartToolsStore();
        renderChartDrawings(tools);
    });

    tools.container.appendChild(bar);
    tools.editBar = bar;
}

function updateChartEditBar(tools) {
    const bar = tools.editBar;
    if (!bar) return;

    const rec = getChartToolsRecord(tools.chartKey, false);
    const drawing = rec.drawings.find(d => d.id === tools.selectedId);
    if (!drawing || tools.activeTool) {
        bar.style.display = 'none';
        return;
    }

    bar.style.display = 'flex';
    // Position tools have fixed green/red semantics - only lock/delete apply
    bar.classList.toggle('position-mode', drawing.type === 'longpos' || drawing.type === 'shortpos');
    // Top-center of the chart, clear of the left tool rail
    bar.style.left = `${Math.max(60, (tools.container.clientWidth - bar.offsetWidth) / 2)}px`;
    bar.style.top = '8px';

    const currentColor = drawingColor(drawing);
    bar.querySelectorAll('.ct-edit-color').forEach(swatch => {
        swatch.classList.toggle('active', swatch.dataset.color.toLowerCase() === currentColor.toLowerCase());
    });
    bar.querySelector('[data-action="width"]').textContent = `${Math.round(drawingWidth(drawing))}px`;

    const stylePreview = bar.querySelector('.ct-style-preview');
    stylePreview.className = `ct-style-preview ${drawingStyle(drawing)}`;

    const lockIcon = bar.querySelector('[data-action="lock"] i');
    lockIcon.className = `fa-solid ${drawing.locked ? 'fa-lock' : 'fa-lock-open'}`;
    bar.querySelector('[data-action="lock"]').classList.toggle('active', !!drawing.locked);
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
    if (d.type === 'vline') return `Vertical line @ ${new Date(d.t * 1000).toISOString().slice(11, 16)}`;
    if (d.type === 'trend') return `Trend line ${d.p1.price.toFixed(2)} → ${d.p2.price.toFixed(2)}`;
    if (d.type === 'rect') return `Rectangle ${Math.min(d.p1.price, d.p2.price).toFixed(2)} - ${Math.max(d.p1.price, d.p2.price).toFixed(2)}`;
    if (d.type === 'fib') return `Fib ${d.p1.price.toFixed(2)} → ${d.p2.price.toFixed(2)}`;
    if (d.type === 'longpos' || d.type === 'shortpos') {
        const rr = Math.abs(d.entry - d.stop) > 0 ? (Math.abs(d.target - d.entry) / Math.abs(d.entry - d.stop)).toFixed(1) : '?';
        return `${d.type === 'longpos' ? 'Long' : 'Short'} @ ${d.entry.toFixed(2)} (RR ${rr})`;
    }
    return d.type;
}

const CHART_DRAWING_ICONS = {
    trend: 'fa-slash', hline: 'fa-minus', vline: 'fa-grip-lines-vertical',
    rect: 'fa-vector-square', fib: 'fa-bars',
    longpos: 'fa-arrow-trend-up', shortpos: 'fa-arrow-trend-down'
};

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
