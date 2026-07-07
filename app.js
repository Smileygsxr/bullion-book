// 1. GLOBAL STATE TRACKERS
// date string -> { chart, series, container, markersApi, events, data, filesByInterval, currentInterval }
const cpiChartInstances = new Map();

// Re-generate this file (via scripts/Export_USD_Calendar.mq5, run inside
// MT5) whenever you want fresher economic events - it's already
// pre-filtered to USD only, so nothing here needs to filter by currency.
const ECONOMIC_EVENTS_CSV_PATH = './data/EconomicEvents.csv';

// Header row: date,time,name,actual,forecast,previous,importance - one row
// per event, date already ISO ("2026-07-03"), time already "8:30am"-style,
// importance one of high/moderate/low/none (matches MT5's own Calendar tab).
const IMPORTANCE_RANK = { high: 3, moderate: 2, low: 1, none: 0 };

function loadUsdEconomicEvents() {
    return fetch(`${ECONOMIC_EVENTS_CSV_PATH}?t=${Date.now()}`)
        .then(response => {
            if (!response.ok) throw new Error("EconomicEvents.csv not found.");
            return response.text();
        })
        .then(csvText => {
            const parsed = Papa.parse(csvText.trim(), { header: true, skipEmptyLines: true });
            const eventsByDate = {};

            parsed.data.forEach(row => {
                const date = (row.date || '').trim();
                const name = (row.name || '').trim();
                if (!date || !name) return;

                const importance = (row.importance || '').trim().toLowerCase();

                if (!eventsByDate[date]) eventsByDate[date] = [];
                eventsByDate[date].push({
                    time: (row.time || '').trim().replace(/\s+/g, '').toLowerCase(),
                    name,
                    actual: (row.actual || '').trim(),
                    forecast: (row.forecast || '').trim(),
                    previous: (row.previous || '').trim(),
                    importance: IMPORTANCE_RANK.hasOwnProperty(importance) ? importance : 'none'
                });
            });

            // High-impact first within each day, so the events that actually
            // move price aren't buried under a pile of low-impact noise.
            Object.values(eventsByDate).forEach(events => {
                events.sort((a, b) => IMPORTANCE_RANK[b.importance] - IMPORTANCE_RANK[a.importance]);
            });

            return eventsByDate;
        });
}

// Event-name filter tabs (multi-select) for the chart blocks
const selectedEventFilters = new Set();

function renderEventFilterTabs(eventsByDate) {
    const tabsContainer = document.getElementById('event-filter-tabs');
    if (!tabsContainer) return;

    const eventNames = new Set();
    Object.values(eventsByDate).forEach(events => {
        events.forEach(({ name }) => eventNames.add(name));
    });

    tabsContainer.innerHTML = '';
    Array.from(eventNames).sort().forEach(name => {
        const button = document.createElement('button');
        button.className = 'news-tab';
        button.textContent = name;
        button.addEventListener('click', () => toggleEventFilter(name, button));
        tabsContainer.appendChild(button);
    });
}

function toggleEventFilter(name, clickedButton) {
    if (selectedEventFilters.has(name)) {
        selectedEventFilters.delete(name);
        clickedButton.classList.remove('active');
    } else {
        selectedEventFilters.add(name);
        clickedButton.classList.add('active');
    }
    document.getElementById('all-charts-tab').classList.toggle('active', selectedEventFilters.size === 0);
    applyEventFilterAndReload();
}

function clearEventFilters() {
    selectedEventFilters.clear();
    document.querySelectorAll('#event-filter-tabs .news-tab').forEach(btn => btn.classList.remove('active'));
    document.getElementById('all-charts-tab').classList.add('active');
    applyEventFilterAndReload();
}

// Date range (inclusive, ISO "YYYY-MM-DD" strings) narrowing which chart
// dates are shown - independent of tradeLogFilters (filters.js), since this
// filters CSV chart files by date, not trades.
let chartDateFrom = null;
let chartDateTo = null;

function toggleChartDatePopover(event) {
    const popover = document.getElementById('chart-date-range-popover');
    if (!popover) return;

    if (popover.style.display === 'block') {
        popover.style.display = 'none';
        return;
    }

    document.getElementById('chart-date-from').value = chartDateFrom || '';
    document.getElementById('chart-date-to').value = chartDateTo || '';

    const rect = event.currentTarget.getBoundingClientRect();
    popover.style.left = `${rect.left}px`;
    popover.style.top = `${rect.bottom + 6}px`;
    popover.style.display = 'block';
}

function applyChartDateFilter() {
    const fromVal = document.getElementById('chart-date-from').value;
    const toVal = document.getElementById('chart-date-to').value;

    chartDateFrom = fromVal || null;
    chartDateTo = toVal || null;

    document.getElementById('chart-date-filter-btn').classList.toggle('active', !!(chartDateFrom || chartDateTo));
    document.getElementById('chart-date-range-popover').style.display = 'none';
    applyEventFilterAndReload();
}

function clearChartDateFilter() {
    chartDateFrom = null;
    chartDateTo = null;
    document.getElementById('chart-date-from').value = '';
    document.getElementById('chart-date-to').value = '';
    document.getElementById('chart-date-filter-btn').classList.remove('active');
    document.getElementById('chart-date-range-popover').style.display = 'none';
    applyEventFilterAndReload();
}

document.addEventListener('click', event => {
    const popover = document.getElementById('chart-date-range-popover');
    if (!popover || popover.style.display === 'none') return;
    const filterBtn = event.target.closest('#chart-date-filter-btn');
    if (popover.contains(event.target) || filterBtn) return;
    popover.style.display = 'none';
});

// Re-filters allChartFiles by the selected event-name tags and date range
// (empty/unset filters show everything) and restarts batch-loading from
// scratch. This has to re-filter the underlying data and reset pagination -
// not just hide/show already-rendered DOM blocks - because with lazy-loaded
// batches, a filter applied against only-whatever-happens-to-be-loaded-so-far
// would miss matching dates further down the list that haven't rendered yet
// (e.g. a monthly event like Unemployment Rate might only have 1 hit in the
// first batch of 10 recent days, even though many more matches exist earlier).
function applyEventFilterAndReload() {
    const container = document.getElementById('chart-blocks-container');
    const template = document.getElementById('xauusd-chart-block-template');
    if (!container || !template) return;

    let files = allChartFiles;

    if (chartDateFrom) files = files.filter(({ date }) => date >= chartDateFrom);
    if (chartDateTo) files = files.filter(({ date }) => date <= chartDateTo);

    displayedChartFiles = selectedEventFilters.size === 0
        ? files
        : files.filter(({ date }) => {
            const events = allChartEventsByDate[date] || [];
            return events.some(({ name }) => selectedEventFilters.has(name));
        });

    resetChartBatches(container, template);
}

// Narrows the (potentially long) list of event-name filter tabs down to
// ones matching the search text - doesn't touch which filters are actually
// selected/active, just what's visible to search through.
function filterEventTabs(query) {
    const normalized = query.trim().toLowerCase();
    document.querySelectorAll('#event-filter-tabs .news-tab').forEach(btn => {
        const matches = !normalized || btn.textContent.toLowerCase().includes(normalized);
        btn.style.display = matches ? '' : 'none';
    });
}

function toggleNewsInfoPanel() {
    const panel = document.getElementById('news-info-panel');
    const toggleBtn = document.getElementById('news-info-toggle');
    if (!panel) return;
    const isHidden = panel.style.display === 'none';
    panel.style.display = isHidden ? 'block' : 'none';
    if (toggleBtn) toggleBtn.classList.toggle('active', isHidden);
}

function toggleEventTabsCollapse() {
    const tabsContainer = document.getElementById('event-filter-tabs');
    const toggleButton = document.getElementById('event-tabs-toggle');
    const isCollapsed = tabsContainer.style.display === 'none';
    tabsContainer.style.display = isCollapsed ? 'flex' : 'none';
    toggleButton.innerHTML = isCollapsed ? '&#9662;' : '&#9656;';
}

function showPage(pageId, clickedElement) {
    const views = document.querySelectorAll('.view-section');
    views.forEach(view => { view.style.display = 'none'; });
    const targetView = document.getElementById(pageId);
    if (targetView) { targetView.style.display = 'flex'; }
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => { link.classList.remove('active'); });
    if (clickedElement && clickedElement.classList.contains('nav-link')) {
        clickedElement.classList.add('active');
    } else {
        const dashLink = document.querySelector('.nav-link[onclick*="page-dashboard"]');
        if (dashLink) dashLink.classList.add('active');
    }
    if (pageId === 'page-news') {
        window.setTimeout(function () { initCpiChart(); }, 150);
    }
    if (pageId === 'page-stats') {
        window.setTimeout(function () { renderStatsPage(); }, 50);
    }
    if (pageId === 'page-calendar') {
        window.setTimeout(function () { renderCalendarPage(); }, 50);
    }
    if (pageId === 'page-review') {
        window.setTimeout(function () { renderReviewPage(); }, 50);
    }
    if (pageId === 'page-settings') {
        window.setTimeout(function () { renderSettingsPage(); }, 50);
    }
}

// Help page search: hides whole topic sections whose text doesn't match, and
// hides the quick-links row while actively searching (it's redundant once
// sections are already filtered).
function filterHelpSections(query) {
    const normalized = query.trim().toLowerCase();
    document.querySelectorAll('.help-section').forEach(section => {
        const matches = !normalized || section.textContent.toLowerCase().includes(normalized);
        section.classList.toggle('help-hidden', !matches);
    });
    const quicklinks = document.getElementById('help-quicklinks');
    if (quicklinks) quicklinks.style.display = normalized ? 'none' : 'flex';
}

// Symbols selectable via the News page's chart tabs. filePrefix must match
// this app's filename convention (see mt5_fetch_button.py's SYMBOLS dict);
// symbol must match how it's stored on trade.symbol, so Trade Levels
// overlays can be scoped to whichever symbol's chart is currently shown
// (otherwise a XAUUSD trade's target/stop-loss would get plotted on a
// EURUSD chart's completely different price scale).
const CHART_SYMBOLS = [
    { symbol: 'XAUUSD', filePrefix: 'XAU-USD', label: 'XAUUSD' },
    { symbol: 'BTCUSD', filePrefix: 'BTC-USD', label: 'BTCUSD' },
    { symbol: 'US500', filePrefix: 'US500', label: 'US500' },
    { symbol: 'EURUSD', filePrefix: 'EUR-USD', label: 'EURUSD' },
    { symbol: 'GBPUSD', filePrefix: 'GBP-USD', label: 'GBPUSD' },
    { symbol: 'USDJPY', filePrefix: 'USD-JPY', label: 'USDJPY' },
    { symbol: 'USDCHF', filePrefix: 'USD-CHF', label: 'USDCHF' },
    { symbol: 'AUDUSD', filePrefix: 'AUD-USD', label: 'AUDUSD' },
    { symbol: 'USDCAD', filePrefix: 'USD-CAD', label: 'USDCAD' },
    { symbol: 'NZDUSD', filePrefix: 'NZD-USD', label: 'NZDUSD' }
];

const CHART_FILENAME_PATTERN = /^([A-Z0-9]+(?:-[A-Z0-9]+)?)_(1|5|15)Minute_BID_(\d{4}-\d{2}-\d{2})_00_00-23_59_.+\.csv$/i;

// Chart blocks are heavy (CSV fetch + chart instance each), so load them in
// batches of CHART_BLOCKS_BATCH_SIZE instead of rendering every date up front.
const CHART_BLOCKS_BATCH_SIZE = 10;
let allDiscoveredFiles = []; // every symbol's files, from one discovery pass
let allChartFiles = []; // allDiscoveredFiles filtered to activeChartSymbol
let displayedChartFiles = []; // allChartFiles further filtered by selectedEventFilters - what pagination actually walks
let allChartEventsByDate = {};
let renderedChartFileCount = 0;
let isLoadingChartBatch = false;
let activeChartSymbol = CHART_SYMBOLS[0]; // XAUUSD by default

function renderChartSymbolTabs() {
    const container = document.getElementById('chart-symbol-tabs');
    if (!container) return;

    const availablePrefixes = new Set(allDiscoveredFiles.map(f => f.filePrefix));
    container.innerHTML = CHART_SYMBOLS.map(s => {
        const available = availablePrefixes.has(s.filePrefix);
        const activeClass = s.filePrefix === activeChartSymbol.filePrefix ? ' active' : '';
        const disabledAttr = available ? '' : 'disabled title="No chart data found for this symbol yet"';
        return `<button type="button" class="news-tab chart-symbol-tab${activeClass}" data-file-prefix="${s.filePrefix}" ${disabledAttr} onclick="selectChartSymbol('${s.filePrefix}')">${s.label}</button>`;
    }).join('');
}

function selectChartSymbol(filePrefix) {
    const match = CHART_SYMBOLS.find(s => s.filePrefix === filePrefix);
    if (!match) return;
    activeChartSymbol = match;
    document.querySelectorAll('#chart-symbol-tabs .chart-symbol-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filePrefix === filePrefix);
    });
    applyActiveSymbolFilter();
}

// Re-filters the already-discovered file list down to the active symbol and
// re-renders - no re-fetch needed, since discoverChartFiles() found every
// symbol's files in one pass.
function applyActiveSymbolFilter() {
    allChartFiles = allDiscoveredFiles.filter(f => f.filePrefix === activeChartSymbol.filePrefix);
    selectedEventFilters.clear();
    document.querySelectorAll('#event-filter-tabs .news-tab').forEach(btn => btn.classList.remove('active'));
    const allChartsTab = document.getElementById('all-charts-tab');
    if (allChartsTab) allChartsTab.classList.add('active');
    applyEventFilterAndReload();
}

function initCpiChart() {
    const container = document.getElementById('chart-blocks-container');
    const template = document.getElementById('xauusd-chart-block-template');
    const scrollArea = document.querySelector('#page-news .news-content-area');
    if (!container || !template) return;

    Promise.all([
        discoverChartFiles(),
        loadUsdEconomicEvents().catch(err => {
            console.error("Economic events load error:", err.message);
            return {};
        })
    ])
        .then(([files, eventsByDate]) => {
            // Newest date first
            files.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

            allDiscoveredFiles = files;
            allChartEventsByDate = eventsByDate;
            renderChartSymbolTabs();
            applyActiveSymbolFilter();
            renderEventFilterTabs(eventsByDate);
        })
        .catch(err => {
            console.error("Data folder listing error:", err.message);
            container.innerHTML = `
                <div style="color: var(--text-muted); text-align: center; padding: 40px; font-family: sans-serif;">
                    <div style="color: #f6465d; font-size: 1.1rem; font-weight: bold; margin-bottom: 6px;">Could not list /data folder</div>
                    ${err.message}
                </div>`;
        });

    if (scrollArea) {
        scrollArea.removeEventListener('scroll', handleChartScrollLoad);
        scrollArea.addEventListener('scroll', handleChartScrollLoad);
    }

    window.onresize = function () {
        requestAnimationFrame(() => {
            cpiChartInstances.forEach(({ chart, container: chartContainer }, dateString) => {
                chart.resize(chartContainer.clientWidth, 520);
                chart.timeScale().fitContent();
                applyTradeOverlays(dateString);
            });
        });
    };
}

// Loads the next batch once the chart list is scrolled near its bottom
function handleChartScrollLoad(e) {
    const el = e.target;
    if (el.scrollTop + el.clientHeight < el.scrollHeight - 200) return;

    const container = document.getElementById('chart-blocks-container');
    const template = document.getElementById('xauusd-chart-block-template');
    if (container && template) loadNextChartBatch(container, template);
}

function loadNextChartBatch(container, template) {
    if (isLoadingChartBatch || renderedChartFileCount >= displayedChartFiles.length) return;

    isLoadingChartBatch = true;
    const batch = displayedChartFiles.slice(renderedChartFileCount, renderedChartFileCount + CHART_BLOCKS_BATCH_SIZE);
    renderedChartFileCount += batch.length;

    renderChartBlocks(batch, container, template, allChartEventsByDate);
    isLoadingChartBatch = false;
}

// Wipes whatever chart blocks are currently rendered and starts back at the first batch of 10
function resetChartBatches(container, template) {
    cpiChartInstances.forEach(({ chart, chartTools }) => {
        if (chartTools) chartTools.dispose();
        chart.remove();
    });
    cpiChartInstances.clear();
    container.innerHTML = '';
    renderedChartFileCount = 0;

    if (displayedChartFiles.length === 0) {
        const noteParts = [];
        if (selectedEventFilters.size > 0) noteParts.push('the selected event filter(s)');
        if (chartDateFrom || chartDateTo) noteParts.push('the selected date range');
        const filterNote = noteParts.length > 0 ? ` matching ${noteParts.join(' and ')}` : '';
        container.innerHTML = `
            <div style="color: var(--text-muted); text-align: center; padding: 40px; font-family: sans-serif;">
                No ${activeChartSymbol.label} chart data found in /data${filterNote}.
            </div>`;
    } else {
        loadNextChartBatch(container, template);
    }
}

// 2. DISCOVER WHICH CSV FILES CURRENTLY EXIST IN /data
// Tries the Vercel serverless listing first (production); falls back to parsing
// a directory-listing response (e.g. `python -m http.server` for local dev).
function discoverChartFiles() {
    function namesToDatedFiles(filenames) {
        const filesByKey = new Map(); // "filePrefix|date" -> { filePrefix, date, files: {1,5,15} }
        filenames.forEach(filename => {
            const match = filename.match(CHART_FILENAME_PATTERN);
            if (!match) return;
            const filePrefix = match[1].toUpperCase();
            const interval = match[2];
            const date = match[3];
            const key = `${filePrefix}|${date}`;
            if (!filesByKey.has(key)) filesByKey.set(key, { filePrefix, date, files: {} });
            const entry = filesByKey.get(key);
            if (!entry.files[interval]) entry.files[interval] = filename;
        });
        return Array.from(filesByKey.values());
    }

    return fetch('/api/data-files')
        .then(response => {
            if (!response.ok) throw new Error("api/data-files unavailable");
            return response.json();
        })
        .then(namesToDatedFiles)
        .catch(() =>
            fetch('./data/')
                .then(response => {
                    if (!response.ok) throw new Error("Unable to read the data folder listing.");
                    return response.text();
                })
                .then(html => {
                    const dirDoc = new DOMParser().parseFromString(html, 'text/html');
                    const links = Array.from(dirDoc.querySelectorAll('a'));
                    const filenames = links.map(link =>
                        decodeURIComponent((link.getAttribute('href') || '').split('/').pop())
                    );
                    return namesToDatedFiles(filenames);
                })
        );
}

// 3. APPEND ONE CHART BLOCK PER CSV FILE IN THIS BATCH
function renderChartBlocks(fileEntries, container, template, eventsByDate) {
    fileEntries.forEach(({ date, files }) => {
        const block = template.content.firstElementChild.cloneNode(true);

        const titleEl = block.querySelector('.cpi-chart-title');
        if (titleEl) titleEl.textContent = activeChartSymbol.label;

        const caption = block.querySelector('.cpi-chart-caption');
        const dateInput = block.querySelector('.cpi-date-input');
        const chartContainer = block.querySelector('.xauusd-lightweight-chart');

        caption.textContent = date;
        if (dateInput) dateInput.value = date;

        const events = eventsByDate[date] || [];
        block.dataset.eventNames = events.map(({ name }) => name).join('|');
        renderEventsForDate(block, date, eventsByDate);

        const defaultInterval = files['5'] ? '5' : (files['1'] ? '1' : '15');
        block.querySelectorAll('.interval-toggle-btn').forEach(btn => {
            const available = !!files[btn.dataset.interval];
            btn.disabled = !available;
            btn.classList.toggle('active', available && btn.dataset.interval === defaultInterval);
        });

        container.appendChild(block);
        createOneDayChart(date, files, chartContainer, events, defaultInterval, activeChartSymbol.symbol);
    });
}

// Click handler for the 1m/5m/15m pills on a chart block
function switchChartInterval(buttonEl) {
    if (buttonEl.disabled) return;
    const block = buttonEl.closest('.xauusd-chart-panel');
    const dateString = block.querySelector('.cpi-chart-caption').textContent.trim();

    block.querySelectorAll('.interval-toggle-btn').forEach(btn => btn.classList.toggle('active', btn === buttonEl));
    loadChartInterval(dateString, buttonEl.dataset.interval);
}

// ---- NEWS TIME MARKERS: a toggle that drops one arrow-below-bar marker per
// unique event time, so simultaneous events (e.g. two events both at 4:00pm)
// only draw a single marker rather than stacking duplicates.
let newsTimeLinesEnabled = false;

function toggleNewsTimeLines() {
    newsTimeLinesEnabled = !newsTimeLinesEnabled;
    document.getElementById('news-time-lines-toggle').classList.toggle('active', newsTimeLinesEnabled);
    cpiChartInstances.forEach((_, dateString) => applyNewsTimeMarkers(dateString));
}

// Parses "4:00pm" / "12:30am" (no space, lowercase, as produced by
// loadUsdEconomicEvents' time column) into 24-hour { hour, minute }. Returns null if unparseable.
function parseEventClockTime(timeStr) {
    const match = (timeStr || '').match(/^(\d{1,2}):(\d{2})(am|pm)$/i);
    if (!match) return null;
    let hour = parseInt(match[1], 10) % 12;
    if (match[3].toLowerCase() === 'pm') hour += 12;
    return { hour, minute: parseInt(match[2], 10) };
}

function buildNewsTimeMarkers(dateString, events) {
    const dateMatch = dateString.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!dateMatch) return [];

    const seenTimes = new Set();
    const markers = [];

    events.forEach(({ time }) => {
        const clock = parseEventClockTime(time);
        if (!clock || seenTimes.has(time)) return;
        seenTimes.add(time);

        const epochSeconds = Date.UTC(
            +dateMatch[1], +dateMatch[2] - 1, +dateMatch[3], clock.hour, clock.minute, 0
        ) / 1000;

        markers.push({
            time: epochSeconds,
            position: 'belowBar',
            color: '#ffeb3b',
            shape: 'arrowUp'
        });
    });

    return markers.sort((a, b) => a.time - b.time);
}

function applyNewsTimeMarkers(dateString) {
    const instance = cpiChartInstances.get(dateString);
    if (!instance || !instance.markersApi) return;

    instance.markersApi.setMarkers(
        newsTimeLinesEnabled ? buildNewsTimeMarkers(dateString, instance.events || []) : []
    );
}

// ---- TRADE LEVELS: draws entry/target/stop-loss zones (from the New Trade
// modal's Target/Stop-Loss fields) over the chart for any trade entered that
// day, similar to TradingView's Long/Short Position tool but read-only.
let tradeOverlaysEnabled = false;

function toggleTradeOverlays() {
    tradeOverlaysEnabled = !tradeOverlaysEnabled;
    document.getElementById('trade-overlays-toggle').classList.toggle('active', tradeOverlaysEnabled);
    // Always re-run (not the gated refreshAllTradeOverlays helper below) - applyTradeOverlays
    // clears each chart's layer first regardless of state, which is what actually removes
    // the boxes when turning this off.
    cpiChartInstances.forEach((_, dateString) => applyTradeOverlays(dateString));
}

// Called from trades.js whenever a trade is saved/edited/deleted, so a chart
// already open in the News tab updates immediately rather than on next load.
function refreshAllTradeOverlays() {
    if (!tradeOverlaysEnabled) return;
    cpiChartInstances.forEach((_, dateString) => applyTradeOverlays(dateString));
}

// Panning/zooming can fire the visible-range-change event many times within a
// single frame; rebuilding the overlay DOM on every one of those ticks is what
// caused the flicker/glitch. Collapse repeated calls into a single rebuild per
// animation frame instead.
const tradeOverlayFrameRequests = new Map(); // dateString -> requestAnimationFrame id

function scheduleTradeOverlayUpdate(dateString) {
    if (tradeOverlayFrameRequests.has(dateString)) return;
    const frameId = requestAnimationFrame(() => {
        tradeOverlayFrameRequests.delete(dateString);
        applyTradeOverlays(dateString);
    });
    tradeOverlayFrameRequests.set(dateString, frameId);
}

function ensureTradeOverlayLayer(container) {
    let layer = container.querySelector('.trade-overlay-layer');
    if (!layer) {
        container.style.position = 'relative';
        layer = document.createElement('div');
        layer.className = 'trade-overlay-layer';
        container.appendChild(layer);
    }
    return layer;
}

// "YYYY-MM-DDTHH:MM" (ignoring any offset) -> epoch seconds, matching how candle
// timestamps are parsed elsewhere so the overlay lines up with the right bar.
function parseLegEpoch(datetimeStr) {
    const stamp = datetimeStr && datetimeStr.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!stamp) return null;
    return Date.UTC(+stamp[1], +stamp[2] - 1, +stamp[3], +stamp[4], +stamp[5], 0) / 1000;
}

// timeToCoordinate only resolves timestamps that exactly match an existing bar.
// A trade entered at e.g. 07:32 lines up with a real 1m bar but not with 5m/15m
// bars (which only land on :00/:05/:10... or :00/:15/:30...), so snap to
// whichever loaded bar is closest instead of requiring an exact match - that's
// what made overlays disappear when switching timeframes.
function nearestBarTime(data, targetEpoch) {
    if (!data || data.length === 0) return null;
    let nearest = data[0].time;
    let bestDiff = Math.abs(data[0].time - targetEpoch);
    for (let i = 1; i < data.length; i++) {
        const diff = Math.abs(data[i].time - targetEpoch);
        if (diff < bestDiff) {
            bestDiff = diff;
            nearest = data[i].time;
        }
    }
    return nearest;
}

function applyTradeOverlays(dateString) {
    const instance = cpiChartInstances.get(dateString);
    if (!instance) return;

    const layer = ensureTradeOverlayLayer(instance.container);
    layer.innerHTML = '';
    if (!tradeOverlaysEnabled || typeof getActiveAccount !== 'function') return;

    const account = getActiveAccount();
    const trades = ((account && account.trades) || []).filter(trade => {
        if (instance.tradeSymbol && trade.symbol !== instance.tradeSymbol) return false;
        const legs = trade.legs.slice().sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
        return legs[0] && legs[0].datetime.slice(0, 10) === dateString;
    });

    trades.forEach(trade => renderTradeOverlay(instance, trade));
}

function renderTradeOverlay(instance, trade) {
    const target = parseFloat(trade.target);
    const stopLoss = parseFloat(trade.stopLoss);
    if (isNaN(target) && isNaN(stopLoss)) return; // nothing meaningful to draw

    const { chart, series, container } = instance;
    const summary = computeTradeSummary(trade);

    const legs = trade.legs.slice().sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
    const entryEpoch = parseLegEpoch(legs[0].datetime);
    const exitEpoch = parseLegEpoch(legs[legs.length - 1].datetime);
    if (entryEpoch === null) return;

    const timeScale = chart.timeScale();
    const entryBarTime = nearestBarTime(instance.data, entryEpoch);
    const entryX = entryBarTime !== null ? timeScale.timeToCoordinate(entryBarTime) : null;
    if (entryX === null) return;

    const exitBarTime = exitEpoch !== null ? nearestBarTime(instance.data, exitEpoch) : null;
    let exitX = exitBarTime !== null ? timeScale.timeToCoordinate(exitBarTime) : null;
    if (exitX === null) exitX = container.clientWidth;

    const entryY = series.priceToCoordinate(summary.entryPrice);
    if (entryY === null) return;

    const layer = ensureTradeOverlayLayer(container);
    const left = Math.min(entryX, exitX);
    const width = Math.max(2, Math.abs(exitX - entryX));
    const isLong = summary.direction !== 'short';

    // Colors by which side of entry is actually favorable for THIS trade's
    // direction (long profits above entry, short profits below it) - not by
    // which field the price came from, so a long and a short render as mirror
    // images of each other instead of always putting "Target" on top.
    function drawZone(price) {
        if (isNaN(price)) return;

        // priceToCoordinate returns null when the price falls outside the chart's
        // auto-scaled visible range (e.g. a stop-loss well beyond the candles shown).
        // Clamp to the container edge instead of skipping, so the zone still shows
        // (cut off) rather than silently vanishing.
        let y = series.priceToCoordinate(price);
        if (y === null) y = price > summary.entryPrice ? 0 : container.clientHeight;

        const isProfitSide = isLong ? price > summary.entryPrice : price < summary.entryPrice;
        const amount = Math.abs(price - summary.entryPrice) * summary.qty;
        const pct = summary.entryPrice !== 0 ? (Math.abs(price - summary.entryPrice) / summary.entryPrice) * 100 : 0;
        const top = Math.min(entryY, y);
        const height = Math.abs(y - entryY);
        const isAboveEntry = y < entryY;

        const box = document.createElement('div');
        box.className = `trade-overlay-box ${isProfitSide ? 'profit' : 'risk'}`;
        box.style.left = `${left}px`;
        box.style.width = `${width}px`;
        box.style.top = `${top}px`;
        box.style.height = `${height}px`;
        layer.appendChild(box);

        const label = document.createElement('div');
        label.className = `trade-overlay-label ${isProfitSide ? 'profit-label' : 'risk-label'} ${isAboveEntry ? 'above' : 'below'}`;
        label.style.left = `${left}px`;
        label.style.top = `${isAboveEntry ? top : top + height}px`;
        label.textContent = `${isProfitSide ? '+' : '-'}${formatTotal(amount)} (${pct.toFixed(2)}%)`;
        layer.appendChild(label);
    }

    drawZone(target);
    drawZone(stopLoss);

    const entryLine = document.createElement('div');
    entryLine.className = 'trade-overlay-entry-line';
    entryLine.style.left = `${left}px`;
    entryLine.style.width = `${width}px`;
    entryLine.style.top = `${entryY}px`;
    layer.appendChild(entryLine);

    const exitLine = document.createElement('div');
    exitLine.className = 'trade-overlay-exit-line';
    exitLine.style.left = `${Math.max(entryX, exitX)}px`;
    layer.appendChild(exitLine);
}

// Importance filter chips (High/Medium/Low) - multi-select, same pattern as
// the event-name filter tabs: empty selection shows everything, one or more
// selected shows only those tiers (events are already sorted high-to-low
// within each day regardless of this filter).
const selectedImportanceFilters = new Set();

// News is hidden above the charts by default (starts true) until the user
// picks High/Medium/Low, or explicitly re-shows it by toggling "None" off -
// keeps the News page uncluttered on first load rather than dumping every
// event on every chart immediately.
let hideAllNews = true;

function toggleImportanceFilter(level, clickedButton) {
    if (selectedImportanceFilters.has(level)) {
        selectedImportanceFilters.delete(level);
        clickedButton.classList.remove('active');
    } else {
        selectedImportanceFilters.add(level);
        clickedButton.classList.add('active');
    }
    // Picking any real tier implies the user wants to see news again.
    hideAllNews = false;
    const noneBtn = document.getElementById('news-none-filter-btn');
    if (noneBtn) noneBtn.classList.remove('active');

    refreshNewsVisibility();
    document.querySelectorAll('#chart-blocks-container .cpi-mini-event').forEach(row => {
        const visible = selectedImportanceFilters.size === 0 || selectedImportanceFilters.has(row.dataset.importance);
        row.style.display = visible ? '' : 'none';
    });
}

// "None" chip - hides the whole events strip above every chart, regardless
// of the High/Medium/Low selection. Click again to go back to showing
// everything (the same "empty selection" state the other chips use).
function toggleNoNewsFilter(clickedButton) {
    hideAllNews = !clickedButton.classList.contains('active');
    clickedButton.classList.toggle('active', hideAllNews);
    if (hideAllNews) {
        selectedImportanceFilters.clear();
        document.querySelectorAll('.importance-filter-btn').forEach(btn => {
            if (btn !== clickedButton) btn.classList.remove('active');
        });
    }
    refreshNewsVisibility();
}

// Shows/hides each already-rendered chart's events strip based on
// hideAllNews - separate from the per-row High/Medium/Low filtering, which
// only matters once the strip itself is visible.
function refreshNewsVisibility() {
    document.querySelectorAll('#chart-blocks-container .cpi-mini-data').forEach(miniData => {
        const eventsList = miniData.querySelector('.cpi-mini-events');
        const hasEvents = eventsList && eventsList.children.length > 0;
        miniData.style.display = (hasEvents && !hideAllNews) ? 'flex' : 'none';
    });
}

// Populates (or hides) the USD events strip above a chart block for its date
function renderEventsForDate(block, date, eventsByDate) {
    const miniData = block.querySelector('.cpi-mini-data');
    const eventsList = block.querySelector('.cpi-mini-events');
    const events = eventsByDate[date];

    if (!miniData || !eventsList || !events || events.length === 0) return;

    eventsList.innerHTML = events.map(({ time, name, actual, forecast, previous, importance }) => {
        const actualColorClass = getActualColorClass(name, actual, forecast);
        const hidden = selectedImportanceFilters.size > 0 && !selectedImportanceFilters.has(importance || 'none');
        return `
        <div class="cpi-mini-event" data-importance="${importance || 'none'}" style="${hidden ? 'display:none;' : ''}">
            <span class="cpi-mini-event-name">${name}</span>
            <span class="cpi-mini-event-importance-dot importance-${importance || 'none'}" title="${(importance || 'none')} impact"></span>
            <span class="cpi-mini-event-vals">
                <input type="text" class="cpi-edit-input cpi-mini-input ${actualColorClass}" value="${actual}" title="Actual" readonly>
                <input type="text" class="cpi-edit-input cpi-mini-input" value="${forecast}" title="Forecast" readonly>
                <input type="text" class="cpi-edit-input cpi-mini-input" value="${previous}" title="Previous" readonly>
            </span>
            <span class="cpi-mini-event-time">${time || ''}</span>
        </div>
    `;
    }).join('');

    miniData.style.display = hideAllNews ? 'none' : 'flex';
}

// Parses values like "0.3%", "225K", "7.62M" into comparable numbers
function parseEventNumber(value) {
    if (!value) return null;
    const match = value.match(/-?\d+(\.\d+)?/);
    if (!match) return null;
    let num = parseFloat(match[0]);
    if (/B/i.test(value)) num *= 1e9;
    else if (/M/i.test(value)) num *= 1e6;
    else if (/K/i.test(value)) num *= 1e3;
    return num;
}

// Indicators where a higher Actual than Forecast is bad news (red), not good (green)
const INVERTED_EVENT_KEYWORDS = ['unemployment claims', 'unemployment rate', 'jobless claims'];

// Green if Actual beat Forecast, red if it missed, otherwise left neutral/white
function getActualColorClass(name, actual, forecast) {
    const actualNum = parseEventNumber(actual);
    const forecastNum = parseEventNumber(forecast);
    if (actualNum === null || forecastNum === null) return '';

    const isInverted = INVERTED_EVENT_KEYWORDS.some(keyword => name.toLowerCase().includes(keyword));
    if (actualNum === forecastNum) return '';
    const beatForecast = isInverted ? actualNum < forecastNum : actualNum > forecastNum;
    return beatForecast ? 'cpi-value-up' : 'cpi-value-down';
}

// 4. THE CSV READING AND RENDER ENGINE
function createOneDayChart(dateString, filesByInterval, chartContainer, events, defaultInterval, tradeSymbol) {
    if (!chartContainer) return;

    const chart = LightweightCharts.createChart(chartContainer, {
        width: chartContainer.clientWidth || 900,
        height: 520,
        layout: { background: { color: '#0f1220' }, textColor: '#d1d4dc', attributionLogo: false },
        grid: {
            vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
            horzLines: { color: 'rgba(255, 255, 255, 0.05)' }
        },
        rightPriceScale: {
            borderColor: '#2a2e39',
            localization: { priceFormatter: price => parseFloat(price).toFixed(2) }
        },
        timeScale: {
            borderColor: '#2a2e39',
            timeVisible: true,
            secondsVisible: false,
            fixLeftEdge: true,
            fixRightEdge: true
        },
        crosshair: {
            mode: LightweightCharts.CrosshairMode.Normal,
            // Native crosshair labels are plain canvas rectangles with no rounded-corner
            // option - hidden here in favor of custom DOM "pill" badges (see
            // attachCrosshairPillLabels in trades.js).
            vertLine: { labelVisible: false },
            horzLine: { labelVisible: false }
        },
        // Locked by default so wheel/drag scrolls the page, not the chart, between stacked charts
        handleScroll: false,
        handleScale: false
    });

    const series = chart.addSeries(LightweightCharts.CandlestickSeries, {
        upColor: '#2ebd85', downColor: '#f6465d',
        borderDownColor: '#f6465d', borderUpColor: '#2ebd85',
        wickDownColor: '#f6465d', wickUpColor: '#2ebd85',
        priceLineVisible: false
    });

    attachLockToggle(chart, chartContainer);
    attachMeasureTool(chart, series, chartContainer, dateString);
    attachCrosshairPillLabels(chart, series, chartContainer, '', { showTime: true, showAxisPriceLabel: true });

    const markersApi = LightweightCharts.createSeriesMarkers(series, []);
    // Drawing tools/indicators/object tree (chart-tools.js). Keyed by
    // symbol+day so the same drawings appear on this day's Trade View chart.
    const chartTools = typeof attachChartTools === 'function'
        ? attachChartTools({ chart, series, container: chartContainer, chartKey: `${tradeSymbol}|${dateString}` })
        : null;
    cpiChartInstances.set(dateString, {
        chart, series, container: chartContainer, events: events || [], markersApi,
        filesByInterval, currentInterval: null, tradeSymbol, chartTools
    });

    // Trade Levels overlay needs repositioning whenever the visible range pans/zooms
    chart.timeScale().subscribeVisibleTimeRangeChange(() => scheduleTradeOverlayUpdate(dateString));

    loadChartInterval(dateString, defaultInterval);
}

// Fetches and renders one interval's CSV into an already-created chart/series -
// used both for the initial render and whenever the 1m/5m/15m toggle is clicked.
function loadChartInterval(dateString, interval) {
    const instance = cpiChartInstances.get(dateString);
    if (!instance) return;
    const filename = instance.filesByInterval[interval];
    if (!filename) return;

    instance.currentInterval = interval;
    const { chart, series, container: chartContainer } = instance;
    const targetPath = `./data/${filename}`;

    fetch(targetPath)
        .then(response => {
            if (!response.ok) throw new Error("File not found.");
            return response.text();
        })
        .then(csvText => {
            // Use PapaParse to split the spreadsheet rows into JavaScript data structures
            const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
            // The timestamp column is named after the CSV's timezone (e.g. "Etc/UTC", "Africa/Johannesburg")
            const timestampField = parsed.meta.fields[0];

            const formattedData = parsed.data.map(row => {
                const stringTimestamp = row[timestampField];
                // Use the literal date/time digits as-is (ignore any UTC offset suffix),
                // so the chart shows the same wall-clock time recorded in the CSV.
                const stamp = stringTimestamp && stringTimestamp.match(
                    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/
                );
                const epochSeconds = stamp
                    ? Date.UTC(+stamp[1], +stamp[2] - 1, +stamp[3], +stamp[4], +stamp[5], +stamp[6]) / 1000
                    : NaN;

                return {
                    time: epochSeconds,
                    open: parseFloat(row.Open),
                    high: parseFloat(row.High),
                    low: parseFloat(row.Low),
                    close: parseFloat(row.Close),
                    volume: parseFloat(row.Volume)
                };
            });

            // Filter out any broken header rows or text fragments and sort chronologically
            const cleanData = formattedData.filter(d => !isNaN(d.time) && !isNaN(d.close));
            cleanData.sort((a, b) => a.time - b.time);

            if (cleanData.length > 0) {
                series.setData(cleanData);
                chart.timeScale().fitContent();
                instance.data = cleanData;
                applyNewsTimeMarkers(dateString);
                applyTradeOverlays(dateString);
                // Recompute indicators + re-render saved drawings against the
                // freshly loaded interval's bars
                if (instance.chartTools) instance.chartTools.setData(cleanData);
            } else {
                throw new Error("No readable rows found.");
            }
        })
        .catch(err => {
            console.error("Data load trace error:", err.message);
            chartContainer.innerHTML = `
                <div style="color: var(--text-muted); text-align: center; padding-top: 200px; font-family: sans-serif;">
                    <div style="color: #f6465d; font-size: 1.1rem; font-weight: bold; margin-bottom: 6px;">Offline Chart File Missing</div>
                    Looking for path: <code style="color: #2979ff;">${targetPath}</code>
                </div>`;
        });
}

// 5. SHIFT+DRAG MEASURE TOOL (price/percent/bars/time/volume between two points)
function formatMeasureDuration(seconds) {
    const totalMinutes = Math.round(seconds / 60);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    const parts = [];
    if (days) parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    if (minutes || parts.length === 0) parts.push(`${minutes}m`);
    return parts.join(' ');
}

function formatMeasureVolume(volume) {
    if (volume >= 1e6) return `${(volume / 1e6).toFixed(2)}M`;
    if (volume >= 1e3) return `${(volume / 1e3).toFixed(2)}K`;
    return volume.toFixed(0);
}

function attachMeasureTool(chart, series, container, dateString) {
    container.style.position = 'relative';

    const box = document.createElement('div');
    box.className = 'measure-box';
    const label = document.createElement('div');
    label.className = 'measure-label';
    container.appendChild(box);
    container.appendChild(label);

    function clientToLocal(clientX, clientY) {
        const rect = container.getBoundingClientRect();
        return { x: clientX - rect.left, y: clientY - rect.top };
    }

    function updateOverlay(startX, startY, startTime, startPrice, curX, curY, curTime, curPrice) {
        const left = Math.min(startX, curX);
        const top = Math.min(startY, curY);

        box.style.left = `${left}px`;
        box.style.top = `${top}px`;
        box.style.width = `${Math.abs(curX - startX)}px`;
        box.style.height = `${Math.abs(curY - startY)}px`;
        box.style.display = 'block';

        const priceDiff = curPrice - startPrice;
        const pctDiff = startPrice !== 0 ? (priceDiff / startPrice) * 100 : 0;

        const data = (cpiChartInstances.get(dateString) || {}).data || [];
        const lo = Math.min(startTime, curTime);
        const hi = Math.max(startTime, curTime);
        const barsInRange = data.filter(d => d.time >= lo && d.time <= hi);
        const volumeSum = barsInRange.reduce((sum, d) => sum + (d.volume || 0), 0);

        label.textContent =
            `${priceDiff >= 0 ? '+' : ''}${priceDiff.toFixed(3)} (${pctDiff >= 0 ? '+' : ''}${pctDiff.toFixed(2)}%) ${curPrice.toFixed(3)}\n` +
            `${barsInRange.length} bars, ${formatMeasureDuration(hi - lo)}\n` +
            `Vol ${formatMeasureVolume(volumeSum)}`;
        label.style.background = priceDiff >= 0 ? '#2ebd85' : '#f6465d';
        label.style.left = `${left}px`;
        label.style.top = `${Math.max(top - 70, 0)}px`;
        label.style.display = 'block';
    }

    container.addEventListener('mousedown', (e) => {
        if (!e.shiftKey || e.button !== 0) {
            box.style.display = 'none';
            label.style.display = 'none';
            return;
        }
        e.preventDefault();
        e.stopPropagation();

        const start = clientToLocal(e.clientX, e.clientY);
        const startTime = chart.timeScale().coordinateToTime(start.x);
        const startPrice = series.coordinateToPrice(start.y);
        if (startTime === null || startPrice === null) return;

        chart.applyOptions({ handleScroll: false, handleScale: false });

        function onMouseMove(moveEvent) {
            const cur = clientToLocal(moveEvent.clientX, moveEvent.clientY);
            const curTime = chart.timeScale().coordinateToTime(cur.x);
            const curPrice = series.coordinateToPrice(cur.y);
            if (curTime === null || curPrice === null) return;
            updateOverlay(start.x, start.y, startTime, startPrice, cur.x, cur.y, curTime, curPrice);
        }

        function onMouseUp() {
            const stillLocked = container.dataset.locked !== 'false';
            chart.applyOptions({ handleScroll: !stillLocked, handleScale: !stillLocked });
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }, true);
}

// Bottom-right lock button: locked by default so dragging/scrolling the page
// between stacked charts doesn't accidentally pan/zoom whichever chart is under the cursor
function attachLockToggle(chart, container) {
    container.style.position = 'relative';
    container.dataset.locked = 'true';

    const button = document.createElement('button');
    button.className = 'chart-lock-toggle locked';
    button.innerHTML = '<i class="fa-solid fa-lock"></i>';
    button.title = 'Chart is locked — click to enable scroll/zoom';

    button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const locked = container.dataset.locked !== 'false';
        const nowLocked = !locked;
        container.dataset.locked = String(nowLocked);
        chart.applyOptions({ handleScroll: !nowLocked, handleScale: !nowLocked });
        button.classList.toggle('locked', nowLocked);
        button.innerHTML = nowLocked ? '<i class="fa-solid fa-lock"></i>' : '<i class="fa-solid fa-lock-open"></i>';
        button.title = nowLocked ? 'Chart is locked — click to enable scroll/zoom' : 'Chart is interactive — click to lock';
    });

    container.appendChild(button);
}

// ---- Help page "Go to" shortcuts ----
// Each help-tile lives inside a .help-section whose id + <h3> title identify
// it. Rather than hand-annotate ~60 tiles in the HTML, every tile's
// destination is looked up here: a section-wide default (most tiles just go
// to that feature's page), with per-tile overrides for the handful that
// point somewhere more specific (a particular Settings tab, or a different
// page entirely, e.g. "Playbook Performance" living in the Playbooks section
// but actually being a Stats-page feature). Sections with no single sensible
// destination (Login & Guest Mode, FAQ, Contact, Disclaimer) are omitted, so
// their tiles are left as plain (non-interactive) reference cards.
// "highlight" is a CSS selector for the actual on-page element(s) that
// feature lives in - resolved and pulsed for ~1.8s after navigating, so the
// user isn't just dropped on the right page but shown exactly where to look.
// Selectors that could also match a same-named element on another (hidden)
// page are scoped with a page id prefix to avoid grabbing the wrong one.
const HELP_SECTION_GOTO = {
    'help-dashboard': { page: 'page-dashboard' },
    'help-trades': { page: 'page-dashboard' },
    'help-playbooks': { page: 'page-settings', tab: 'playbooks', highlight: '#settings-panel-playbooks' },
    'help-import': { page: 'page-settings', tab: 'import', highlight: '#settings-panel-import' },
    'help-tags': { page: 'page-settings', tab: 'tags', highlight: '#settings-panel-tags' },
    'help-accounts': { page: 'page-dashboard', highlight: '.account-box' },
    'help-notes': { page: 'page-dashboard', highlight: '.table-container' },
    'help-calendar': { page: 'page-calendar' },
    'help-stats': { page: 'page-stats' },
    'help-news': { page: 'page-news', highlight: '#chart-blocks-container' },
    'help-settings': { page: 'page-settings' }
};

const HELP_TILE_GOTO_OVERRIDES = {
    'help-dashboard::Equity Curve': { highlight: '.chart-card' },
    'help-dashboard::Performance Rings': { highlight: '.metrics-group' },
    'help-dashboard::Trade Log': { highlight: '.table-container' },
    'help-dashboard::Account Balance': { highlight: '.account-box' },
    'help-dashboard::Privacy Blur': { highlight: '#privacy-toggle-btn' },
    'help-dashboard::Trade Filter': { highlight: '#filter-toggle-btn' },
    'help-dashboard::Quick Date Range': { highlight: '#page-dashboard .page-date-range-bar' },
    'help-dashboard::Quick CSV Import': { highlight: '#import-trades-btn' },

    'help-trades::New Trade': { highlight: '.sidebar-actions .btn-blue' },
    'help-trades::Breakeven Range': { tab: 'account', highlight: '#settings-breakeven-range' },
    'help-trades::R-Multiple': { highlight: '.table-container' },
    'help-trades::Playbooks': { tab: 'playbooks', highlight: '#settings-panel-playbooks' },
    'help-trades::Mark as Wash': { highlight: '.table-container' },
    'help-trades::Edit & Delete': { highlight: '.table-container' },

    'help-playbooks::Assigning to a Trade': { page: 'page-dashboard', tab: null, highlight: '.sidebar-actions .btn-blue' },
    'help-playbooks::Playbook Performance': { page: 'page-stats', tab: null, highlight: '#stats-playbook-table-body' },

    'help-import::Time Adjustment': { highlight: '#csv-timezone-dropdown' },
    'help-import::Exporting': { tab: 'account', highlight: '[onclick="exportTradesToCsv()"]' },

    'help-tags::Adding Tags': { page: 'page-dashboard', tab: null, highlight: '.sidebar-actions .btn-blue' },
    'help-tags::Spotting Tags': { page: 'page-dashboard', tab: null, highlight: '.table-container' },
    'help-tags::Custom Categories': { highlight: '#tag-category-chips' },
    'help-tags::Tag Performance': { page: 'page-stats', tab: null, highlight: '#stats-tag-table-body' },

    'help-accounts::Multiple Accounts': { highlight: '.account-switcher' },

    'help-notes::Mood & Conditions': { highlight: '.sidebar-actions .btn-gold' },
    'help-notes::Multiple Per Day': { highlight: '.sidebar-actions .btn-gold' },

    'help-calendar::Month Grid': { highlight: '.calendar-grid-wrap' },
    'help-calendar::Weekly Summary': { highlight: '.calendar-weekly-summary' },
    'help-calendar::Day Drill-Down': { highlight: '.calendar-grid-wrap' },

    'help-stats::Key Metrics': { highlight: '#stats-metrics-row-1' },
    'help-stats::Pro Score': { highlight: '.pro-score-panel' },
    'help-stats::Equity Curve': { highlight: '#stats-equity-chart' },
    'help-stats::Wins vs. Losses': { highlight: '#wins-losses-compare' },
    'help-stats::Day & Hour Breakdown': { highlight: '#stats-day-chart, #stats-hour-chart' },
    'help-stats::Tag, Symbol & Playbook Tables': { highlight: '#stats-tag-table-body, #stats-symbol-table-body, #stats-playbook-table-body' },
    'help-stats::MAE / MFE': { highlight: '#stats-mae-mfe-result' },
    'help-stats::Performance vs. Volatility': { highlight: '#stats-volatility-result' },

    'help-settings::Personal Info': { tab: 'personal', highlight: '#settings-panel-personal' },
    'help-settings::Account Settings': { tab: 'account', highlight: '#settings-panel-account' },
    'help-settings::Contract Sizes': { tab: 'contracts', highlight: '#settings-panel-contracts' },
    'help-settings::Playbooks': { tab: 'playbooks', highlight: '#settings-panel-playbooks' },
    'help-settings::Tag Management': { tab: 'tags', highlight: '#settings-panel-tags' },
    'help-settings::Import Trades': { tab: 'import', highlight: '#settings-panel-import' },
    'help-settings::Share Your Journal': { tab: 'account', highlight: '#settings-panel-account' },
    'help-settings::Export Trade History': { tab: 'account', highlight: '[onclick="exportTradesToCsv()"]' },
    'help-settings::Password & Security': { tab: 'security', highlight: '#settings-panel-security' },
    'help-settings::Danger Zone': { tab: 'danger', highlight: '#settings-panel-danger' }
};

function resolveHelpTileGoto(tile) {
    const section = tile.closest('.help-section');
    if (!section) return null;
    const base = HELP_SECTION_GOTO[section.id];
    if (!base) return null;

    const titleEl = tile.querySelector('h3');
    const title = titleEl ? titleEl.textContent.trim() : '';
    const override = HELP_TILE_GOTO_OVERRIDES[`${section.id}::${title}`];
    const target = Object.assign({}, base, override);
    if (target.tab === null) delete target.tab;
    return target;
}

// Pulses a gold ring around the target element(s) so the user isn't just
// dropped on the right page but shown exactly where to look. Runs on a short
// delay so the page/tab switch's DOM updates (and any re-render) settle
// first, and filters out anything not actually visible (e.g. a same-named
// element left over on a still-hidden panel).
function highlightHelpTarget(selector) {
    if (!selector) return;
    window.setTimeout(() => {
        const elements = Array.from(document.querySelectorAll(selector)).filter(el => el.offsetParent !== null);
        if (elements.length === 0) return;

        elements[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
        elements.forEach(el => {
            el.classList.remove('help-target-highlight');
            void el.offsetWidth; // restart the animation if it's already mid-pulse from a fast repeat click
            el.classList.add('help-target-highlight');
            window.setTimeout(() => el.classList.remove('help-target-highlight'), 1800);
        });
    }, 150);
}

function navigateFromHelpTile(pageId, tab, highlight) {
    const navLink = document.querySelector(`.nav-link[onclick*="'${pageId}'"]`);
    showPage(pageId, navLink);
    if (tab && typeof switchSettingsPanel === 'function') switchSettingsPanel(tab);
    highlightHelpTarget(highlight);
}

// Click a tile to reveal its "Go to →" shortcut; click that button to jump
// straight to the relevant page (and Settings tab, if applicable).
function initHelpTileGoTo() {
    document.querySelectorAll('.help-tile').forEach(tile => {
        const target = resolveHelpTileGoto(tile);
        if (!target) return;

        tile.classList.add('help-tile-actionable');

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'help-tile-goto-btn';
        btn.innerHTML = '<i class="fa-solid fa-arrow-right"></i> Go to';
        btn.addEventListener('click', event => {
            event.stopPropagation();
            navigateFromHelpTile(target.page, target.tab, target.highlight);
        });
        tile.appendChild(btn);

        tile.addEventListener('click', () => {
            const alreadyRevealed = tile.classList.contains('help-tile-revealed');
            document.querySelectorAll('.help-tile-revealed').forEach(t => t.classList.remove('help-tile-revealed'));
            if (!alreadyRevealed) tile.classList.add('help-tile-revealed');
        });
    });
}

document.addEventListener('DOMContentLoaded', initHelpTileGoTo);
