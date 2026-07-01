// 1. GLOBAL STATE TRACKERS
// date string -> { chart, series, container, markersApi, events, data, filesByInterval, currentInterval }
const cpiChartInstances = new Map();

// Re-upload/replace this file in /data whenever new economic events come in.
const ECONOMIC_EVENTS_CSV_PATH = './data/EconomicEvents.csv';
const ECONOMIC_EVENTS_YEAR = 2026;
const MONTH_ABBR_TO_NUM = {
    Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
    Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12'
};

// CSV has no header row: [dateLabel, time, currency, _, event, _, _, actual, forecast, previous].
// dateLabel/time are blank on rows that share the same day/time as the row above (forward-filled).
function loadUsdEconomicEvents() {
    return fetch(`${ECONOMIC_EVENTS_CSV_PATH}?t=${Date.now()}`)
        .then(response => {
            if (!response.ok) throw new Error("EconomicEvents.csv not found.");
            return response.text();
        })
        .then(csvText => {
            const parsed = Papa.parse(csvText.trim(), { header: false, skipEmptyLines: true });
            const eventsByDate = {};
            let currentDate = null;
            let currentTime = '';

            parsed.data.forEach(row => {
                const [dateLabel, time, currency, , name, , , actual, forecast, previous] = row;

                if (dateLabel && dateLabel.trim()) {
                    currentDate = parseEventDateLabel(dateLabel.trim());
                }
                if (time && time.trim()) {
                    currentTime = time.trim().replace(/\s+/g, '').toLowerCase();
                }
                if (!currentDate || !name || !name.trim()) return;
                if (!currency || currency.trim().toUpperCase() !== 'USD') return;

                if (!eventsByDate[currentDate]) eventsByDate[currentDate] = [];
                eventsByDate[currentDate].push({
                    time: currentTime,
                    name: name.trim(),
                    actual: (actual || '').trim(),
                    forecast: (forecast || '').trim(),
                    previous: (previous || '').trim()
                });
            });

            return eventsByDate;
        });
}

// Converts a label like "WedJun 10" into "2026-06-10"
function parseEventDateLabel(label) {
    const match = label.match(/^[A-Za-z]{3}([A-Za-z]{3})\s*(\d{1,2})$/);
    if (!match) return null;
    const month = MONTH_ABBR_TO_NUM[match[1]];
    if (!month) return null;
    return `${ECONOMIC_EVENTS_YEAR}-${month}-${match[2].padStart(2, '0')}`;
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
    applyEventFilters();
}

function clearEventFilters() {
    selectedEventFilters.clear();
    document.querySelectorAll('#event-filter-tabs .news-tab').forEach(btn => btn.classList.remove('active'));
    document.getElementById('all-charts-tab').classList.add('active');

    const container = document.getElementById('chart-blocks-container');
    const template = document.getElementById('xauusd-chart-block-template');
    if (container && template) resetChartBatches(container, template);
}

function applyEventFilters() {
    document.querySelectorAll('#chart-blocks-container .xauusd-chart-panel').forEach(block => {
        const blockEvents = (block.dataset.eventNames || '').split('|').filter(Boolean);
        const matches = selectedEventFilters.size === 0 ||
            blockEvents.some(name => selectedEventFilters.has(name));
        block.style.display = matches ? '' : 'none';
    });
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

const XAUUSD_FILENAME_PATTERN = /^XAU-USD_(1|5|15)Minute_BID_(\d{4}-\d{2}-\d{2})_00_00-23_59_.+\.csv$/i;

// Chart blocks are heavy (CSV fetch + chart instance each), so load them in
// batches of CHART_BLOCKS_BATCH_SIZE instead of rendering every date up front.
const CHART_BLOCKS_BATCH_SIZE = 10;
let allChartFiles = [];
let allChartEventsByDate = {};
let renderedChartFileCount = 0;
let isLoadingChartBatch = false;

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

            allChartFiles = files;
            allChartEventsByDate = eventsByDate;
            selectedEventFilters.clear();
            resetChartBatches(container, template);
            renderEventFilterTabs(eventsByDate);
        })
        .catch(err => {
            console.error("Data folder listing error:", err.message);
            container.innerHTML = `
                <div style="color: #848e9c; text-align: center; padding: 40px; font-family: sans-serif;">
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
    if (isLoadingChartBatch || renderedChartFileCount >= allChartFiles.length) return;

    isLoadingChartBatch = true;
    const batch = allChartFiles.slice(renderedChartFileCount, renderedChartFileCount + CHART_BLOCKS_BATCH_SIZE);
    renderedChartFileCount += batch.length;

    renderChartBlocks(batch, container, template, allChartEventsByDate);
    applyEventFilters();
    isLoadingChartBatch = false;
}

// Wipes whatever chart blocks are currently rendered and starts back at the first batch of 10
function resetChartBatches(container, template) {
    cpiChartInstances.forEach(({ chart }) => chart.remove());
    cpiChartInstances.clear();
    container.innerHTML = '';
    renderedChartFileCount = 0;

    if (allChartFiles.length === 0) {
        container.innerHTML = `
            <div style="color: #848e9c; text-align: center; padding: 40px; font-family: sans-serif;">
                No XAUUSD chart data found in /data.
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
        const filesByDate = new Map(); // date -> { '1': filename, '5': filename, '15': filename }
        filenames.forEach(filename => {
            const match = filename.match(XAUUSD_FILENAME_PATTERN);
            if (!match) return;
            const interval = match[1];
            const date = match[2];
            if (!filesByDate.has(date)) filesByDate.set(date, {});
            if (!filesByDate.get(date)[interval]) filesByDate.get(date)[interval] = filename;
        });
        return Array.from(filesByDate, ([date, files]) => ({ date, files }));
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
        createOneDayChart(date, files, chartContainer, events, defaultInterval);
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

// Parses "4:00pm" / "12:30am" (no space, lowercase, as produced by parseEventDateLabel's
// forward-filled time column) into 24-hour { hour, minute }. Returns null if unparseable.
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

// Populates (or hides) the USD events strip above a chart block for its date
function renderEventsForDate(block, date, eventsByDate) {
    const miniData = block.querySelector('.cpi-mini-data');
    const eventsList = block.querySelector('.cpi-mini-events');
    const events = eventsByDate[date];

    if (!miniData || !eventsList || !events || events.length === 0) return;

    eventsList.innerHTML = events.map(({ time, name, actual, forecast, previous }) => {
        const actualColorClass = getActualColorClass(name, actual, forecast);
        return `
        <div class="cpi-mini-event">
            <span class="cpi-mini-event-name">${name}</span>
            <span class="cpi-mini-event-vals">
                <input type="text" class="cpi-edit-input cpi-mini-input ${actualColorClass}" value="${actual}" title="Actual" readonly>
                <input type="text" class="cpi-edit-input cpi-mini-input" value="${forecast}" title="Forecast" readonly>
                <input type="text" class="cpi-edit-input cpi-mini-input" value="${previous}" title="Previous" readonly>
            </span>
            <span class="cpi-mini-event-time">${time || ''}</span>
        </div>
    `;
    }).join('');

    miniData.style.display = 'flex';
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
function createOneDayChart(dateString, filesByInterval, chartContainer, events, defaultInterval) {
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
    cpiChartInstances.set(dateString, {
        chart, series, container: chartContainer, events: events || [], markersApi,
        filesByInterval, currentInterval: null
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
            } else {
                throw new Error("No readable rows found.");
            }
        })
        .catch(err => {
            console.error("Data load trace error:", err.message);
            chartContainer.innerHTML = `
                <div style="color: #848e9c; text-align: center; padding-top: 200px; font-family: sans-serif;">
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
