// 1. GLOBAL STATE TRACKERS
const cpiChartInstances = new Map(); // date string -> { chart, series, container }

function switchNewsTab(tabId, clickedButton) {
    const subPages = document.querySelectorAll('.news-sub-page');
    subPages.forEach(page => { page.style.display = 'none'; });
    const activeTab = document.getElementById(tabId);
    if (activeTab) { activeTab.style.display = 'block'; }
    const newsButtons = document.querySelectorAll('.news-tab');
    newsButtons.forEach(btn => { btn.classList.remove('active'); });
    if (clickedButton) { clickedButton.classList.add('active'); }
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

function initCpiChart() {
    const container = document.getElementById('chart-blocks-container');
    const template = document.getElementById('xauusd-chart-block-template');
    if (!container || !template) return;

    discoverChartFiles()
        .then(files => {
            // Newest date first
            files.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
            renderChartBlocks(files, container, template);
        })
        .catch(err => {
            console.error("Data folder listing error:", err.message);
            container.innerHTML = `
                <div style="color: #848e9c; text-align: center; padding: 40px; font-family: sans-serif;">
                    <div style="color: #f6465d; font-size: 1.1rem; font-weight: bold; margin-bottom: 6px;">Could not list /data folder</div>
                    ${err.message}
                </div>`;
        });

    window.onresize = function () {
        requestAnimationFrame(() => {
            cpiChartInstances.forEach(({ chart, container: chartContainer }) => {
                chart.resize(chartContainer.clientWidth, 520);
                chart.timeScale().fitContent();
            });
        });
    };
}

// 2. DISCOVER WHICH CSV FILES CURRENTLY EXIST IN /data
function discoverChartFiles() {
    return fetch('./data/')
        .then(response => {
            if (!response.ok) throw new Error("Unable to read the data folder listing.");
            return response.text();
        })
        .then(html => {
            const dirDoc = new DOMParser().parseFromString(html, 'text/html');
            const links = Array.from(dirDoc.querySelectorAll('a'));

            const filesByDate = new Map(); // date -> filename (first match wins)
            links
                .map(link => decodeURIComponent((link.getAttribute('href') || '').split('/').pop()))
                .forEach(filename => {
                    const match = filename.match(XAUUSD_FILENAME_PATTERN);
                    if (match && !filesByDate.has(match[1])) {
                        filesByDate.set(match[1], filename);
                    }
                });

            return Array.from(filesByDate, ([date, filename]) => ({ date, filename }));
        });
}

// 3. BUILD ONE CHART BLOCK PER CSV FILE, NEWEST DATE ON TOP
function renderChartBlocks(files, container, template) {
    cpiChartInstances.forEach(({ chart }) => chart.remove());
    cpiChartInstances.clear();
    container.innerHTML = '';

    if (files.length === 0) {
        container.innerHTML = `
            <div style="color: #848e9c; text-align: center; padding: 40px; font-family: sans-serif;">
                No XAUUSD 5m chart data found in /data.
            </div>`;
        return;
    }

    files.forEach(({ date, filename }) => {
        const block = template.content.firstElementChild.cloneNode(true);

        const caption = block.querySelector('.cpi-chart-caption');
        const dateInput = block.querySelector('.cpi-date-input');
        const chartContainer = block.querySelector('.xauusd-lightweight-chart');

        caption.textContent = date;
        if (dateInput) dateInput.value = date;

        container.appendChild(block);
        createOneDayChart(date, filename, chartContainer);
    });
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
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal }
    });

    const series = chart.addSeries(LightweightCharts.CandlestickSeries, {
        upColor: '#2ebd85', downColor: '#f6465d',
        borderDownColor: '#f6465d', borderUpColor: '#2ebd85',
        wickDownColor: '#f6465d', wickUpColor: '#2ebd85',
        priceLineVisible: false
    });

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
                const epochSeconds = Math.floor(new Date(stringTimestamp).getTime() / 1000);

                return {
                    time: epochSeconds,
                    open: parseFloat(row.Open),
                    high: parseFloat(row.High),
                    low: parseFloat(row.Low),
                    close: parseFloat(row.Close)
                };
            });

            // Filter out any broken header rows or text fragments and sort chronologically
            const cleanData = formattedData.filter(d => !isNaN(d.time) && !isNaN(d.close));
            cleanData.sort((a, b) => a.time - b.time);

            if (cleanData.length > 0) {
                series.setData(cleanData);
                chart.timeScale().fitContent();
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
