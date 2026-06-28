// 1. GLOBAL STATE TRACKERS
const cpiChartInstances = new Map(); // date string -> { chart, series, container }

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
}

const XAUUSD_FILENAME_PATTERN = /^XAU-USD_5Minute_BID_(\d{4}-\d{2}-\d{2})_00_00-23_59_.+\.csv$/i;

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
            cpiChartInstances.forEach(({ chart, container: chartContainer }) => {
                chart.resize(chartContainer.clientWidth, 520);
                chart.timeScale().fitContent();
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
                No XAUUSD 5m chart data found in /data.
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
        const filesByDate = new Map(); // date -> filename (first match wins)
        filenames.forEach(filename => {
            const match = filename.match(XAUUSD_FILENAME_PATTERN);
            if (match && !filesByDate.has(match[1])) {
                filesByDate.set(match[1], filename);
            }
        });
        return Array.from(filesByDate, ([date, filename]) => ({ date, filename }));
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
function renderChartBlocks(files, container, template, eventsByDate) {
    files.forEach(({ date, filename }) => {
        const block = template.content.firstElementChild.cloneNode(true);

        const caption = block.querySelector('.cpi-chart-caption');
        const dateInput = block.querySelector('.cpi-date-input');
        const chartContainer = block.querySelector('.xauusd-lightweight-chart');

        caption.textContent = date;
        if (dateInput) dateInput.value = date;

        const events = eventsByDate[date] || [];
        block.dataset.eventNames = events.map(({ name }) => name).join('|');
        renderEventsForDate(block, date, eventsByDate);

        container.appendChild(block);
        createOneDayChart(date, filename, chartContainer);
    });
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
function createOneDayChart(dateString, filename, chartContainer) {
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
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
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

    cpiChartInstances.set(dateString, { chart, series, container: chartContainer });

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
                const instance = cpiChartInstances.get(dateString);
                if (instance) instance.data = cleanData;
                attachMeasureTool(chart, series, chartContainer, dateString);
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
