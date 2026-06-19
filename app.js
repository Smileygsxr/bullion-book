/////////////////////////////////////////////////////////////////////////////////////////////////////////
// MAIN JAVASCRIPT FILE FOR BULLION BOOK
// This file contains all the core interactive functionality for the Bullion Book application, including:
/////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////NEWS SUB TABS///////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////
function switchNewsTab(tabId, clickedButton) {
    // 1. Find and hide all nested news feed subsections
    const subPages = document.querySelectorAll('.news-sub-page');
    subPages.forEach(page => {
        page.style.display = 'none';
    });

    // 2. Open up the specifically selected index tab area
    const activeTab = document.getElementById(tabId);
    if (activeTab) {
        activeTab.style.display = 'block';
    }

    // 3. Cycle active visual indicator highlights on header pills
    const newsButtons = document.querySelectorAll('.news-tab');
    newsButtons.forEach(btn => {
        btn.classList.remove('active');
    });
    
    if (clickedButton) {
        clickedButton.classList.add('active');
    }
}

// ADD THIS FUNCTION TO THE BOTTOM OF YOUR FILE
function showPage(pageId, clickedElement) {
    // 1. Hide every main view container block out of sight
    const views = document.querySelectorAll('.view-section');
    views.forEach(view => {
        view.style.display = 'none';
    });

    // 2. Display the selected targeted main view panel
    const targetView = document.getElementById(pageId);
    if (targetView) {
        targetView.style.display = 'flex';
    }

    // 3. Cycle active highlights across the main sidebar links
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
        link.classList.remove('active');
    });

    // 4. Highlight the correct active sidebar item
    if (clickedElement && clickedElement.classList.contains('nav-link')) {
        clickedElement.classList.add('active');
    } else {
        // Fallback default: light up dashboard if logo branding text is chosen
        const dashLink = document.querySelector('.nav-link[onclick*="page-dashboard"]');
        if (dashLink) {
            dashLink.classList.add('active');
        }
    }

    if (pageId === 'page-news') {
        window.setTimeout(function () {
            if (typeof initCpiChart === 'function') {
                initCpiChart();
            }
            if (window.resizeCpiChart) {
                window.resizeCpiChart();
            }
        }, 80);
    }
}

function initCpiChart() {
    const dateInput = document.querySelector('.cpi-date-input');
    const caption = document.getElementById('xauusdDateCaption');
    const chartContainer = document.getElementById('xauusd-lightweight-chart');

    if (!dateInput || !caption || !chartContainer) {
        return;
    }

    if (chartContainer.dataset.cpiInitialized === 'true') {
        return;
    }
    chartContainer.dataset.cpiInitialized = 'true';

    let chartInstance = null;

    function updateChartCaption() {
        const dateValue = dateInput.value || '2026-06-12';
        caption.textContent = dateValue;
    }

    function resizeChart() {
        if (!chartInstance || !chartContainer) {
            return;
        }
        chartContainer.style.display = 'block';
        requestAnimationFrame(function () {
            chartInstance.resize();
            chartInstance.timeScale().fitContent();
        });
    }

    function createOneDayChart(dateString) {
        if (!chartContainer || !window.LightweightCharts) {
            window.setTimeout(function () {
                createOneDayChart(dateString);
            }, 300);
            return;
        }

        if (chartInstance) {
            chartInstance.remove();
            chartInstance = null;
        }

        chartContainer.innerHTML = '';
        chartContainer.style.display = 'block';

        chartInstance = window.LightweightCharts.createChart(chartContainer, {
            width: chartContainer.clientWidth || 900,
            height: chartContainer.clientHeight || 520,
            layout: {
                background: { color: '#0f1220' },
                textColor: '#d1d4dc'
            },
            grid: {
                vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
                horzLines: { color: 'rgba(255, 255, 255, 0.05)' }
            },
            rightPriceScale: {
                borderColor: '#2a2e39'
            },
            timeScale: {
                borderColor: '#2a2e39'
            },
            crosshair: {
                mode: window.LightweightCharts.CrosshairMode.Normal
            }
        });

        const series = chartInstance.addSeries(window.LightweightCharts.CandlestickSeries, {
            upColor: '#2ebd85',
            downColor: '#f6465d',
            borderDownColor: '#f6465d',
            borderUpColor: '#2ebd85',
            wickDownColor: '#f6465d',
            wickUpColor: '#2ebd85'
        });

        const selectedDate = dateString ? new Date(`${dateString}T12:00:00`) : new Date('2026-06-12T12:00:00');
        const start = new Date(selectedDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(selectedDate);
        end.setHours(23, 59, 59, 999);

        const offsetMinutes = 120;
        const startUtc = new Date(start.getTime() - offsetMinutes * 60 * 1000);
        const endUtc = new Date(end.getTime() - offsetMinutes * 60 * 1000);

        const data = [];
        const pointCount = 96;
        let current = new Date(startUtc);

        for (let i = 0; i < pointCount; i++) {
            if (current > endUtc) {
                break;
            }
            const time = Math.floor(current.getTime() / 1000);
            const base = 2330 + Math.sin(i / 3) * 9 + (i % 4) * 0.4;
            const open = base;
            const close = base + Math.sin(i / 2) * 6;
            const high = Math.max(open, close) + 3;
            const low = Math.min(open, close) - 3;
            data.push({ time, open, high, low, close });
            current = new Date(current.getTime() + 5 * 60 * 1000);
        }

        if (data.length > 0) {
            series.setData(data);
            window.resizeCpiChart = resizeChart;
            window.setTimeout(function () {
                resizeChart();
            }, 50);
        }
    }

    dateInput.addEventListener('change', function () {
        updateChartCaption();
        createOneDayChart(dateInput.value);
    });

    window.addEventListener('resize', resizeChart);
    updateChartCaption();
    createOneDayChart(dateInput.value || '2026-06-12');
}

document.addEventListener('DOMContentLoaded', function () {
    initCpiChart();
});
///////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////             ///////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////


