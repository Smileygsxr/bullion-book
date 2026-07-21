// ---- First-run guided tour ----
// A TradingView-style spotlight onboarding: dims the app and highlights the
// REAL UI element for each step (so the "screenshots" are the live app itself,
// always current with every theme), with a floating card explaining it.
// Auto-starts once per account on first login (see maybeStartAutoTutorial,
// called from settings.js applyLoadedSettings) and can be replayed any time
// from the Help page's "Take the Guided Tour" button.

const TUTORIAL_STEPS = [
    {
        welcome: true,
        title: 'Welcome to Bullion Book!',
        text: 'Your free trading journal for gold & forex. This 60-second tour shows you where everything lives - or skip it and explore on your own. You can replay it any time from the Help page.'
    },
    {
        target: '.nav-menu', sidebar: true, page: 'page-dashboard',
        icon: 'fa-border-all', title: 'Your pages',
        text: 'Everything lives here: the Dashboard, deep Stats, your P&L Calendar, Weekly Review, a Coach that studies your trades, the Community wall, and real market Charts.'
    },
    {
        target: '.sidebar-actions', sidebar: true,
        icon: 'fa-square-plus', title: 'Log trades & notes',
        text: 'New Trade logs a trade with entries, exits, stop-loss and target. New Note captures your mood and market conditions for any day - both show up in your Dashboard log.'
    },
    {
        target: '.sidebar-toolbar', sidebar: true,
        icon: 'fa-sliders', title: 'Quick tools',
        text: 'Left to right: blur all money values for privacy, import your broker CSV from any page (free MT4/MT5 export scripts included), filter your trades, and switch between hamburger and pinned sidebar.'
    },
    {
        target: '.account-box', sidebar: true,
        icon: 'fa-wallet', title: 'Balance & accounts',
        text: 'Your balance = deposits and withdrawals plus real trade P&L. Click the pencil to manage transactions or create more accounts (live, demo, prop) and switch with the dropdown above.'
    },
    {
        target: '#page-dashboard .page-date-range-bar', page: 'page-dashboard',
        icon: 'fa-calendar', title: 'Focus any period',
        text: 'Today, This Week, Last Month or a custom range - one click narrows the whole Dashboard and Stats to that period. Reset clears it.'
    },
    {
        target: '#page-dashboard .stats-row', page: 'page-dashboard',
        icon: 'fa-circle-half-stroke', title: 'Your results at a glance',
        text: 'Equity curve, wins/losses, averages and total P&L - all live. Click any card for a plain-language explanation of what it measures.'
    },
    {
        target: '#page-dashboard .table-container', page: 'page-dashboard',
        icon: 'fa-table-list', title: 'The trade log',
        text: 'Every trade and note, sortable by any column. Click a row for full details with a real chart replay, or use its ⋯ menu to edit, mark as breakeven, or delete.'
    },
    {
        target: '#stats-metrics-row-1', page: 'page-stats',
        icon: 'fa-chart-simple', title: 'Know your numbers',
        text: 'Win rate, expectancy, profit factor, streaks, a 6-axis Pro Score, day & hour heatmaps and per-setup breakdowns - this page tells you exactly where your edge is (and isn\'t).'
    },
    {
        target: '.calendar-grid-wrap', page: 'page-calendar',
        icon: 'fa-calendar-days', title: 'Your month, day by day',
        text: 'Daily P&L at a glance with weekly totals. Toggle Holidays to overlay market holidays for 9 countries - handy for spotting low-liquidity days before they trap you.'
    },
    {
        finish: true, page: 'page-dashboard',
        title: 'You\'re all set!',
        text: 'That\'s the essentials - the Help page has full guides for everything else, including importing your MT4/MT5 history in two minutes. The best first step? Log a trade.'
    }
];

const tutorialState = { active: false, index: 0, posTimer: null, openedDrawer: false };

function startTutorial() {
    if (tutorialState.active) return;
    if (!document.getElementById('page-dashboard')) return;
    tutorialState.active = true;
    tutorialState.index = 0;

    let overlay = document.getElementById('tutorial-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'tutorial-overlay';
        overlay.innerHTML = '<div id="tutorial-spotlight"></div><div id="tutorial-card"></div>';
        document.body.appendChild(overlay);
    }
    overlay.style.display = 'block';

    document.addEventListener('keydown', handleTutorialKeys);
    window.addEventListener('resize', repositionTutorial);
    goToTutorialStep(0);
}

function endTutorial(openTradeAfter) {
    if (!tutorialState.active) return;
    tutorialState.active = false;
    clearTimeout(tutorialState.posTimer);
    document.removeEventListener('keydown', handleTutorialKeys);
    window.removeEventListener('resize', repositionTutorial);

    const overlay = document.getElementById('tutorial-overlay');
    if (overlay) overlay.style.display = 'none';
    if (tutorialState.openedDrawer && typeof closeSidebarDrawer === 'function') closeSidebarDrawer();
    tutorialState.openedDrawer = false;

    // Remember completion per account (synced to the login via appSettings)
    // plus a localStorage guard so it never re-fires before Firestore loads.
    try { localStorage.setItem('bb_tutorial_done', '1'); } catch (e) { /* ignore */ }
    if (typeof appSettings !== 'undefined') {
        appSettings.tutorialDone = true;
        if (typeof saveAppSettings === 'function') saveAppSettings();
    }

    if (typeof showPage === 'function') {
        showPage('page-dashboard', document.querySelector('.nav-link[onclick*="page-dashboard"]'));
    }
    if (openTradeAfter && typeof openTradeModal === 'function') openTradeModal();
}

// Auto-start on a first-time login - called by applyLoadedSettings
// (settings.js) once the account's saved settings have actually arrived, so
// returning users on a new device are recognized via their synced flag.
function maybeStartAutoTutorial() {
    let localDone = false;
    try { localDone = localStorage.getItem('bb_tutorial_done') === '1'; } catch (e) { /* ignore */ }
    const settingsDone = typeof appSettings !== 'undefined' && appSettings.tutorialDone;
    if (localDone || settingsDone || tutorialState.active) return;
    setTimeout(() => { if (!tutorialState.active) startTutorial(); }, 700);
}

function handleTutorialKeys(e) {
    if (e.key === 'Escape') endTutorial(false);
    if (e.key === 'ArrowRight') tutorialNext();
    if (e.key === 'ArrowLeft') tutorialBack();
}

function tutorialNext() {
    if (tutorialState.index >= TUTORIAL_STEPS.length - 1) { endTutorial(false); return; }
    goToTutorialStep(tutorialState.index + 1);
}

function tutorialBack() {
    if (tutorialState.index > 0) goToTutorialStep(tutorialState.index - 1);
}

function goToTutorialStep(index) {
    tutorialState.index = index;
    const step = TUTORIAL_STEPS[index];

    if (step.page && typeof showPage === 'function') {
        showPage(step.page, document.querySelector(`.nav-link[onclick*="${step.page}"]`));
    }

    // Drawer-mode phones/desktops: sidebar steps need the drawer open,
    // page-content steps need it closed so it doesn't cover the target.
    if (document.documentElement.classList.contains('sidebar-drawer-mode')) {
        const sidebar = document.querySelector('.sidebar');
        const isOpen = sidebar && sidebar.classList.contains('open');
        if (step.sidebar && !isOpen && typeof toggleSidebarDrawer === 'function') {
            toggleSidebarDrawer();
            tutorialState.openedDrawer = true;
        }
        if (!step.sidebar && isOpen && typeof closeSidebarDrawer === 'function') closeSidebarDrawer();
    }

    renderTutorialCard(step);

    // Pages render inside showPage's own ~50ms setTimeout - wait it out
    // before measuring, longer when we actually switched page.
    clearTimeout(tutorialState.posTimer);
    tutorialState.posTimer = setTimeout(() => {
        const target = step.target ? document.querySelector(step.target) : null;
        if (target) target.scrollIntoView({ block: 'center', behavior: 'auto' });
        positionTutorialUI(step);
    }, step.page ? 240 : 90);
}

function repositionTutorial() {
    if (tutorialState.active) positionTutorialUI(TUTORIAL_STEPS[tutorialState.index]);
}

function renderTutorialCard(step) {
    const card = document.getElementById('tutorial-card');
    if (!card) return;

    const stepCount = TUTORIAL_STEPS.length;
    const dots = TUTORIAL_STEPS.map((s, i) =>
        `<span class="tutorial-dot${i === tutorialState.index ? ' active' : ''}"></span>`).join('');

    if (step.welcome || step.finish) {
        card.className = 'tutorial-card tutorial-card-hero';
        card.innerHTML = `
            <img src="images/golden-bull.png" alt="Bullion Book golden bull" class="tutorial-hero-img">
            <h3>${step.title}</h3>
            <p>${step.text}</p>
            <div class="tutorial-dots">${dots}</div>
            <div class="tutorial-hero-actions">
                ${step.welcome ? `
                    <button class="tutorial-btn ghost" onclick="endTutorial(false)">Skip tutorial</button>
                    <button class="tutorial-btn primary" onclick="tutorialNext()">Take the tour <i class="fa-solid fa-arrow-right"></i></button>
                ` : `
                    <button class="tutorial-btn ghost" onclick="endTutorial(false)">Finish</button>
                    <button class="tutorial-btn primary" onclick="endTutorial(true)"><i class="fa-solid fa-square-plus"></i> Log my first trade</button>
                `}
            </div>`;
        return;
    }

    card.className = 'tutorial-card';
    card.innerHTML = `
        <div class="tutorial-card-head">
            <span class="tutorial-step-icon"><i class="fa-solid ${step.icon}"></i></span>
            <h3>${step.title}</h3>
            <button class="tutorial-close" onclick="endTutorial(false)" title="Skip tutorial"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <p>${step.text}</p>
        <div class="tutorial-card-foot">
            <span class="tutorial-progress">${tutorialState.index + 1} / ${stepCount}</span>
            <div class="tutorial-dots">${dots}</div>
            <div class="tutorial-nav-btns">
                <button class="tutorial-btn ghost" onclick="tutorialBack()"><i class="fa-solid fa-arrow-left"></i></button>
                <button class="tutorial-btn primary" onclick="tutorialNext()">${tutorialState.index === stepCount - 2 ? 'Finish up' : 'Next'} <i class="fa-solid fa-arrow-right"></i></button>
            </div>
        </div>`;
}

function positionTutorialUI(step) {
    const spotlight = document.getElementById('tutorial-spotlight');
    const card = document.getElementById('tutorial-card');
    if (!spotlight || !card) return;

    const vw = window.innerWidth, vh = window.innerHeight;
    const target = step.target ? document.querySelector(step.target) : null;

    if (!target || step.welcome || step.finish) {
        // Centered card; a zero-size spotlight still dims the whole screen
        // through its huge box-shadow spread, keeping transitions smooth.
        spotlight.style.left = `${vw / 2}px`;
        spotlight.style.top = `${vh / 2}px`;
        spotlight.style.width = '0px';
        spotlight.style.height = '0px';
        spotlight.classList.add('no-target');
        card.style.left = `${Math.max(12, (vw - card.offsetWidth) / 2)}px`;
        card.style.top = `${Math.max(12, (vh - card.offsetHeight) / 2)}px`;
        return;
    }

    spotlight.classList.remove('no-target');
    const pad = 7;
    const r = target.getBoundingClientRect();
    spotlight.style.left = `${r.left - pad}px`;
    spotlight.style.top = `${r.top - pad}px`;
    spotlight.style.width = `${r.width + pad * 2}px`;
    spotlight.style.height = `${r.height + pad * 2}px`;

    const margin = 14;
    const cw = card.offsetWidth, ch = card.offsetHeight;
    let x = Math.min(Math.max(r.left, 12), vw - cw - 12);
    let y = r.bottom + margin;
    if (y + ch > vh - 12) y = r.top - ch - margin;
    if (y < 12) {
        // No room above or below - sit beside the target instead.
        y = Math.min(Math.max(r.top, 12), Math.max(12, vh - ch - 12));
        x = r.right + margin;
        if (x + cw > vw - 12) x = r.left - cw - margin;
        if (x < 12) x = Math.max(12, (vw - cw) / 2);
    }
    card.style.left = `${x}px`;
    card.style.top = `${y}px`;
}
