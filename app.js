// 1. GLOBAL STATE TRACKERS
let cpiChartInstance = null;
let cpiSeriesInstance = null;

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

function initCpiChart() {
    const dateInput = document.querySelector('.cpi-date-input');
    const caption = document.getElementById('xauusdDateCaption');
    const chartContainer = document.getElementById('xauusd-lightweight-chart');

    if (!dateInput || !caption || !chartContainer) return;

    function updateChartCaption() {
        caption.textContent = dateInput.value || '2026-06-12';
    }

    dateInput.onchange = function () {
        updateChartCaption();
        createOneDayChart(dateInput.value);
    };

    window.onresize = function () {
        if (cpiChartInstance && chartContainer) {
            requestAnimationFrame(() => {
                cpiChartInstance.resize(chartContainer.clientWidth, 520);
                cpiChartInstance.timeScale().fitContent();
            });
        }
    };

    updateChartCaption();
    createOneDayChart(dateInput.value || '2026-06-12');
}

// 3. THE CSV READING AND RENDER ENGINE
function createOneDayChart(dateString) {
    const chartContainer = document.getElementById('xauusd-lightweight-chart');
    if (!chartContainer) return;

    if (cpiChartInstance) {
        cpiChartInstance.remove();
        cpiChartInstance = null;
        cpiSeriesInstance = null;
    }
    chartContainer.innerHTML = '';

    cpiChartInstance = LightweightCharts.createChart(chartContainer, {
        width: chartContainer.clientWidth || 900,
        height: 520,
        layout: { background: { color: '#0f1220' }, textColor: '#d1d4dc' },
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

    cpiSeriesInstance = cpiChartInstance.addSeries(LightweightCharts.CandlestickSeries, {
        upColor: '#2ebd85', downColor: '#f6465d',
        borderDownColor: '#f6465d', borderUpColor: '#2ebd85',
        wickDownColor: '#f6465d', wickUpColor: '#2ebd85'
    });

    // MATCHES YOUR EXACT FILENAME PATTERN SHOWN IN VS CODE
    const targetPath = `./data/XAU-USD_5Minute_BID_${dateString}_00_00-23_59_Etc_UTC.csv`;

    fetch(targetPath)
        .then(response => {
            if (!response.ok) throw new Error("File not found.");
            return response.text();
        })
        .then(csvText => {
            // Use PapaParse to split the spreadsheet rows into JavaScript data structures
            const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
            
            const formattedData = parsed.data.map(row => {
                // MATCHES YOUR CSV'S UNIQUE "Etc/UTC" HEADER SHOWN IN YOUR IMAGE
                const stringTimestamp = row['Etc/UTC']; 
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
                cpiSeriesInstance.setData(cleanData);
                cpiChartInstance.timeScale().fitContent();
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
