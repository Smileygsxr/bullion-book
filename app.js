// 1. GLOBAL STATE TRACKERS (Crucial for cross-tab resizing and safe reconstruction)
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
        if (dashLink) { dashLink.classList.add('active'); }
    }

    // Tab visibility delay protection
    if (pageId === 'page-news') {
        window.setTimeout(function () {
            if (typeof initCpiChart === 'function') {
                initCpiChart();
            }
        }, 120);
    }
}

// 2. THE REFACTORED WORKHORSE METHOD
function initCpiChart() {
    const dateInput = document.querySelector('.cpi-date-input');
    const caption = document.getElementById('xauusdDateCaption');
    const chartContainer = document.getElementById('xauusd-lightweight-chart');

    if (!dateInput || !caption || !chartContainer) return;

    // Fast escape if container is hidden in DOM (Prevents zero-width crash loops)
    const chartStyle = window.getComputedStyle(chartContainer);
    if (chartContainer.clientWidth <= 0 || chartContainer.clientHeight <= 0 || chartStyle.display === 'none') {
        return; 
    }

    // Sync caption string helper
    function updateChartCaption() {
        caption.textContent = dateInput.value || '2026-06-12';
    }

    // Separate clean resize execution handler
    function resizeChart() {
        if (!cpiChartInstance || !chartContainer) return;
        requestAnimationFrame(() => {
            const width = chartContainer.clientWidth || 900;
            const height = chartContainer.clientHeight || 520;
            cpiChartInstance.resize(width, height);
            cpiChartInstance.timeScale().fitContent();
        });
    }

    function createOneDayChart(dateString) {
        if (!chartContainer || !window.LightweightCharts) return;

        // Clean up memory leaks and bindings cleanly before creating a new chart instance
        if (cpiChartInstance) {
            cpiChartInstance.remove();
            cpiChartInstance = null;
            cpiSeriesInstance = null;
        }

        // Set dimensions explicitly based on parent flex/grid bounds
        const targetWidth = chartContainer.clientWidth || 900;
        const targetHeight = chartContainer.clientHeight || 520;

        cpiChartInstance = window.LightweightCharts.createChart(chartContainer, {
            width: targetWidth,
            height: targetHeight,
            layout: {
                background: { color: '#0f1220' },
                textColor: '#d1d4dc'
            },
            grid: {
                vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
                horzLines: { color: 'rgba(255, 255, 255, 0.05)' }
            },
            rightPriceScale: { borderColor: '#2a2e39' },
            timeScale: {
                borderColor: '#2a2e39',
                timeVisible: true,        // REQUIRED: Shows HH:MM stamps instead of absolute dates
                secondsVisible: false,
                fixLeftEdge: true,        // Prevents dragging data past the left limit
                fixRightEdge: true,       // Prevents dragging data past the right limit
                tickMarkFormatter: function (time) {
                    if (!time || typeof time !== 'number') return '';
                    const date = new Date(time * 1000);
                    // Formats local hours and minutes cleanly on axis ticks
                    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
                }
            },
            crosshair: { mode: window.LightweightCharts.CrosshairMode.Normal }
        });

        // Use CandlestickSeries constructor correctly
        cpiSeriesInstance = cpiChartInstance.addSeries(window.LightweightCharts.CandlestickSeries, {
            upColor: '#2ebd85',
            downColor: '#f6465d',
            borderDownColor: '#f6465d',
            borderUpColor: '#2ebd85',
            wickDownColor: '#f6465d',
            wickUpColor: '#2ebd85'
        });

        // Single-day calculation configuration loops
        const targetDate = dateString ? `${dateString}T00:00:00` : '2026-06-12T00:00:00';
        const startOfDay = new Date(targetDate);
        const baseTimestamp = Math.floor(startOfDay.getTime() / 1000);

        const data = [];
        const pointCount = 288; // 288 segments * 15 minutes = Exact 24 Hour Single Day Display
        let runningPrice = 2330.00;

        for (let i = 0; i < pointCount; i++) {
            // Increments explicitly by 5-minute intervals (300 seconds)
            const timeOffset = baseTimestamp + (i * 5 * 60); 
            
            const change = (Math.sin(i / 12) * 2) + ((Math.random() - 0.5) * 2);
            const open = runningPrice;
            const close = runningPrice + change;
            const high = Math.max(open, close) + (Math.random() * 1);
            const low = Math.min(open, close) - (Math.random() * 1);

            data.push({ time: timeOffset, open, high, low, close });
            runningPrice = close; // Carry over price for fluid candlesticks
        }

        if (data.length > 0) {
            cpiSeriesInstance.setData(data);
            
            // Map global resize callback securely
            window.resizeCpiChart = resizeChart;
            
            // Ensure canvas fits inside container bounds completely
            window.setTimeout(resizeChart, 50);
        }
    }

    // Set up clean event listeners without stacking duplicates
    dateInput.removeEventListener('change', updateChartCaption);
    dateInput.addEventListener('change', function () {
        updateChartCaption();
        createOneDayChart(dateInput.value);
    });

    window.removeEventListener('resize', window.resizeCpiChart);
    window.addEventListener('resize', () => { if(window.resizeCpiChart) window.resizeCpiChart(); });

    // Initial Execute Sequence
    updateChartCaption();
    createOneDayChart(dateInput.value || '2026-06-12');
}
