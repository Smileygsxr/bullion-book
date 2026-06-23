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
        if (dashLink) { dashLink.classList.add('active'); }
    }

    //  FIXED: Trigger chart initialization immediately when the tab is revealed
    if (pageId === 'page-news') {
        window.setTimeout(function () {
            initCpiChart();
        }, 150); // Small delay to let the CSS flex/display render complete layout width
    }
}

// 2. THE REFACTORED WORKHORSE METHOD
function initCpiChart() {
    const dateInput = document.querySelector('.cpi-date-input');
    const caption = document.getElementById('xauusdDateCaption');
    const chartContainer = document.getElementById('xauusd-lightweight-chart');

    if (!dateInput || !caption || !chartContainer) return;

    //  FIXED: Removed the strict width/height escape blockers that cause silent failures on hidden tabs
    function updateChartCaption() {
        caption.textContent = dateInput.value || '2026-06-12';
    }

    dateInput.onchange = function () {
        updateChartCaption();
        createOneDayChart(dateInput.value);
    };

    updateChartCaption();
    createOneDayChart(dateInput.value || '2026-06-12');
}

// 3. SEPARATED WIDGET GENERATOR
function createOneDayChart(dateString) {
    const chartContainer = document.getElementById('xauusd-lightweight-chart');
    if (!chartContainer) return;

    chartContainer.innerHTML = '';

    const widgetScript = document.createElement('script');
    widgetScript.type = 'text/javascript';
    widgetScript.src = 'https://tradingview.com';
    widgetScript.async = true;

    widgetScript.onload = function() {
        if (typeof TradingView !== 'undefined') {
            new TradingView.widget({
                "width": "100%",
                "height": 520, // Explicit pixel height value prevents 0px layout collapse
                "symbol": "FX:XAUUSD",         
                "interval": "5",               
                "timezone": "Etc/UTC",         
                "theme": "dark",               
                "style": "1",                  
                "locale": "en",
                "enable_publishing": false,
                "hide_side_toolbar": true,     
                "allow_symbol_change": false,  
                "container_id": "xauusd-lightweight-chart",
                "studies": [],                 
                "show_popup_button": false,
                "withdateranges": true,        
                "hide_volume": true
            });
        }
    };

    chartContainer.appendChild(widgetScript);
}
