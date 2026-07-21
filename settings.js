// Settings page: Personal Info, Account Settings, Tag Management, Password &
// Security, Danger. App-wide preferences (appSettings) and the custom avatar are
// stored on the Firestore users/{uid} doc for logged-in users, or localStorage for
// guests - same split pattern as accounts.js.
const CURRENCY_SYMBOLS = { USD: '$', EUR: '€', GBP: '£', ZAR: 'R' };

let appSettings = {
    currencyCode: 'USD',
    // Matches the app's actual pre-existing behavior (always "now" for new legs,
    // always the trade's open date on the grid) - so shipping the real
    // implementation of these two settings doesn't silently change anything for
    // existing users unless they explicitly pick the other option.
    defaultOrderDate: 'today',
    defaultGridDate: 'trade-open',
    defaultSymbol: '',
    defaultQty: '',
    defaultFee: 0,
    defaultTagId: '',
    pnlCalcType: 'capital',
    breakevenRange: 0,
    theme: 'slate',
    // 'hamburger' (drawer behind the ☰ button, mobile-friendly default) or
    // 'fixed' (classic pinned sidebar). Small screens force the drawer.
    sidebarMode: 'hamburger',
    // Risk guardrails (Dashboard warning banner) - 0 = disabled
    maxDailyLoss: 0,
    maxDailyTrades: 0,
    // First-run guided tour (tutorial.js) - true once finished or skipped,
    // synced to the login so it doesn't replay on every new device.
    tutorialDone: false
};

// ---- Sidebar mode: hamburger drawer vs fixed ----
function applySidebarMode() {
    const mode = appSettings.sidebarMode === 'fixed' ? 'fixed' : 'hamburger';
    try { localStorage.setItem('bb_sidebar_mode', mode); } catch (e) { /* ignore */ }
    const useDrawer = mode === 'hamburger' || window.innerWidth <= 900;
    document.documentElement.classList.toggle('sidebar-drawer-mode', useDrawer);
    if (!useDrawer) closeSidebarDrawer();
}

function selectSidebarMode(mode) {
    appSettings.sidebarMode = mode;
    saveAppSettings();
    applySidebarMode();
    renderSidebarModeButtons();
}

// Quick-access version of the same Settings > Appearance > Sidebar Style
// choice, as an icon button that lives in the sidebar itself (top toolbar,
// next to Privacy/Import/Filter) - flips straight to the opposite mode
// without a trip into Settings.
function toggleSidebarModeQuick() {
    selectSidebarMode(appSettings.sidebarMode === 'fixed' ? 'hamburger' : 'fixed');
}

function renderSidebarModeButtons() {
    const current = appSettings.sidebarMode === 'fixed' ? 'fixed' : 'hamburger';
    document.querySelectorAll('.sidebar-mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === current);
    });

    const quickBtn = document.getElementById('sidebar-mode-toggle-btn');
    if (quickBtn) {
        const isFixed = current === 'fixed';
        // Icon shows the mode a click will switch TO (matches the privacy-eye
        // toggle's convention elsewhere in this same toolbar row).
        quickBtn.innerHTML = isFixed ? '<i class="fa-solid fa-bars"></i>' : '<i class="fa-solid fa-table-columns"></i>';
        quickBtn.title = isFixed ? 'Switch to hamburger menu' : 'Switch to fixed sidebar';
    }
}

function toggleSidebarDrawer() {
    const sidebar = document.querySelector('.sidebar');
    const scrim = document.getElementById('sidebar-scrim');
    if (!sidebar) return;
    const open = !sidebar.classList.contains('open');
    sidebar.classList.toggle('open', open);
    if (scrim) scrim.classList.toggle('show', open);
}

function closeSidebarDrawer() {
    const sidebar = document.querySelector('.sidebar');
    const scrim = document.getElementById('sidebar-scrim');
    if (sidebar) sidebar.classList.remove('open');
    if (scrim) scrim.classList.remove('show');
}

// Crossing the 900px line (e.g. rotating a tablet) re-evaluates whether the
// fixed sidebar is allowed; Esc always closes an open drawer.
window.addEventListener('resize', () => applySidebarMode());
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeSidebarDrawer();
});

// ---- Color themes (Settings > Appearance) ----
// Each theme's real palette lives in styles.css as an html[data-theme="..."]
// variable override block - this list only drives the picker UI. The preview
// swatch colors here should visually match that CSS block, but nothing breaks
// if they drift; they're just the thumbnail.
const THEMES = [
    { id: 'slate', label: 'Slate', preview: { bg: '#171b26', card: '#1c2030', accent: '#2979ff', gold: '#dfb15b' } },
    { id: 'light', label: 'Light', preview: { bg: '#eef1f6', card: '#ffffff', accent: '#2563eb', gold: '#a87f24' } },
    { id: 'midnight', label: 'Midnight', preview: { bg: '#0d1117', card: '#151b26', accent: '#4d9fff', gold: '#dfb15b' } },
    { id: 'ocean', label: 'Ocean', preview: { bg: '#0e1a20', card: '#132630', accent: '#26b8cf', gold: '#e8c06a' } },
    { id: 'forest', label: 'Forest', preview: { bg: '#111a14', card: '#17251c', accent: '#43b97a', gold: '#d8c06c' } },
    { id: 'amethyst', label: 'Amethyst', preview: { bg: '#151223', card: '#1e1a32', accent: '#9d6bff', gold: '#e5b566' } },
    { id: 'ember', label: 'Ember', preview: { bg: '#1a1412', card: '#251c18', accent: '#ff8a3d', gold: '#f0b45c' } },
    { id: 'bullion', label: 'Bullion', preview: { bg: '#14120d', card: '#1e1a12', accent: '#dfb15b', gold: '#dfb15b' } },
    { id: 'neon', label: 'Neon', preview: { bg: '#0f0c13', card: '#181321', accent: '#f43f8e', gold: '#c77dff' } },
    { id: 'blossom', label: 'Blossom', preview: { bg: '#fdf1f5', card: '#ffffff', accent: '#e0447c', gold: '#b3688c' } }
];

// Light-family themes share the "dark-first CSS fixups" layer (white text ->
// dark text, white-alpha washes -> dark-alpha) via the html.light-base class.
const LIGHT_BASE_THEMES = ['light', 'blossom'];

// Sets the palette on <html> and mirrors it into localStorage so the inline
// pre-paint script in app.html's <head> can re-apply it instantly on the
// next load, before any JS or Firestore fetch runs (no color flash).
function applyTheme(themeId) {
    const valid = THEMES.some(t => t.id === themeId) ? themeId : 'slate';
    if (valid === 'slate') {
        document.documentElement.removeAttribute('data-theme');
    } else {
        document.documentElement.setAttribute('data-theme', valid);
    }
    document.documentElement.classList.toggle('light-base', LIGHT_BASE_THEMES.includes(valid));
    try { localStorage.setItem('bb_theme', valid); } catch (e) { /* ignore */ }
}

function selectTheme(themeId) {
    applyTheme(themeId);
    appSettings.theme = themeId;
    saveAppSettings();
    renderThemeSwatchGrid();
}

function renderThemeSwatchGrid() {
    const grid = document.getElementById('theme-swatch-grid');
    if (!grid) return;
    const current = appSettings.theme || 'slate';
    grid.innerHTML = THEMES.map(t => `
        <button type="button" class="theme-swatch${t.id === current ? ' active' : ''}" onclick="selectTheme('${t.id}')">
            <span class="theme-swatch-preview" style="background: ${t.preview.bg};">
                <span class="theme-swatch-dot" style="background: ${t.preview.card};"></span>
                <span class="theme-swatch-dot" style="background: ${t.preview.accent};"></span>
                <span class="theme-swatch-dot" style="background: ${t.preview.gold};"></span>
            </span>
            <span class="theme-swatch-label">${t.label} <i class="fa-solid fa-circle-check"></i></span>
        </button>
    `).join('');
}

let customAvatarDataUrl = null;
let currentSettingsTab = 'personal';

function getCurrencySymbol() {
    return CURRENCY_SYMBOLS[appSettings.currencyCode] || '$';
}

// ---- "?" info tooltips next to setting labels - shown on hover, and pinned
// open on click (so it also works on touch devices with no hover state) ----
let pinnedSettingsInfoBtn = null;

function getSettingsInfoTooltip() {
    let el = document.getElementById('settings-info-tooltip');
    if (!el) {
        el = document.createElement('div');
        el.id = 'settings-info-tooltip';
        el.className = 'settings-info-tooltip';
        document.body.appendChild(el);
    }
    return el;
}

function showSettingsInfoTooltip(btn) {
    const tooltip = getSettingsInfoTooltip();
    tooltip.textContent = btn.dataset.tooltip;
    tooltip.style.display = 'block';

    const rect = btn.getBoundingClientRect();
    tooltip.style.left = `${rect.left}px`;
    tooltip.style.top = `${rect.bottom + 6}px`;
}

function hideSettingsInfoTooltip() {
    if (pinnedSettingsInfoBtn) return; // stays open until clicked again/elsewhere
    const tooltip = document.getElementById('settings-info-tooltip');
    if (tooltip) tooltip.style.display = 'none';
}

function toggleSettingsInfoTooltip(event, btn) {
    event.stopPropagation();
    if (pinnedSettingsInfoBtn === btn) {
        pinnedSettingsInfoBtn = null;
        hideSettingsInfoTooltip();
        return;
    }
    pinnedSettingsInfoBtn = btn;
    showSettingsInfoTooltip(btn);
}

document.addEventListener('click', () => {
    if (!pinnedSettingsInfoBtn) return;
    pinnedSettingsInfoBtn = null;
    const tooltip = document.getElementById('settings-info-tooltip');
    if (tooltip) tooltip.style.display = 'none';
});

function loadAppSettings() {
    auth.onAuthStateChanged(user => {
        if (user) {
            db.collection('users').doc(user.uid).get()
                .then(doc => applyLoadedSettings(doc.exists ? doc.data().appSettings : null))
                .catch(() => applyLoadedSettings(null));
        } else {
            let saved = null;
            try { saved = JSON.parse(localStorage.getItem('bb_settings_guest')); } catch (e) { /* ignore */ }
            applyLoadedSettings(saved);
        }
    });
}

function applyLoadedSettings(saved) {
    if (saved) appSettings = Object.assign({}, appSettings, saved);
    // Re-sync the theme + sidebar mode from the account's saved settings -
    // the pre-paint localStorage copies usually already match, but this
    // covers logging in on a different device/browser for the first time.
    applyTheme(appSettings.theme);
    applySidebarMode();
    renderSidebarModeButtons();
    renderSidebarAccount();
    if (typeof renderTradeLog === 'function') renderTradeLog();
    // First login on this account? Offer the guided tour (tutorial.js) -
    // checked only now, after the account's synced settings have arrived.
    if (typeof maybeStartAutoTutorial === 'function') maybeStartAutoTutorial();
}

function saveAppSettings() {
    const uid = auth.currentUser && auth.currentUser.uid;
    if (uid) {
        // mergeFields replaces appSettings wholesale (a deep merge would keep
        // removed keys alive in Firestore) while preserving the doc's other fields.
        db.collection('users').doc(uid).set({ appSettings }, { mergeFields: ['appSettings'] })
            .catch(err => console.error('Failed to save settings to Firestore:', err.message));
    } else {
        localStorage.setItem('bb_settings_guest', JSON.stringify(appSettings));
    }
}

// ---- Custom avatar (overrides Google photoURL once set) ----
function loadCustomAvatar() {
    auth.onAuthStateChanged(user => {
        if (!user) return;
        db.collection('users').doc(user.uid).get()
            .then(doc => {
                const dataUrl = doc.exists ? doc.data().profilePhotoDataUrl : null;
                if (dataUrl) {
                    customAvatarDataUrl = dataUrl;
                    applyAvatarToSidebar(dataUrl);
                }
            })
            .catch(err => console.error('Failed to load avatar:', err.message));
    });
}

function applyAvatarToSidebar(dataUrl) {
    const img = document.getElementById('sidebar-avatar');
    const fallback = document.getElementById('sidebar-avatar-fallback');
    if (!img || !fallback) return;
    img.src = dataUrl;
    img.style.display = 'block';
    fallback.style.display = 'none';
}

function handleAvatarFileChange(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
        const image = new Image();
        image.onload = () => {
            const size = 128;
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            const scale = Math.max(size / image.width, size / image.height);
            const w = image.width * scale;
            const h = image.height * scale;
            ctx.drawImage(image, (size - w) / 2, (size - h) / 2, w, h);

            customAvatarDataUrl = canvas.toDataURL('image/jpeg', 0.8);
            applyAvatarToSidebar(customAvatarDataUrl);

            const previewImg = document.getElementById('settings-avatar-img');
            const previewFallback = document.getElementById('settings-avatar-fallback');
            if (previewImg && previewFallback) {
                previewImg.src = customAvatarDataUrl;
                previewImg.style.display = 'block';
                previewFallback.style.display = 'none';
            }
        };
        image.src = reader.result;
    };
    reader.readAsDataURL(file);
}

function saveCustomAvatar() {
    const uid = auth.currentUser && auth.currentUser.uid;
    if (!customAvatarDataUrl) return;
    if (uid) {
        db.collection('users').doc(uid).set({ profilePhotoDataUrl: customAvatarDataUrl }, { merge: true })
            .catch(err => console.error('Failed to save avatar:', err.message));
    } else {
        localStorage.setItem('bb_avatar_guest', customAvatarDataUrl);
    }
}

// ---- Page shell: sub-nav tabs ----
function renderSettingsPage() {
    if (!document.getElementById('settings-panel-personal')) return;
    switchSettingsPanel(currentSettingsTab);
}

function switchSettingsPanel(tab) {
    currentSettingsTab = tab;
    ['personal', 'account', 'appearance', 'tags', 'contracts', 'playbooks', 'import', 'security', 'danger'].forEach(t => {
        const panel = document.getElementById(`settings-panel-${t}`);
        const navItem = document.getElementById(`settings-tab-${t}`);
        if (panel) panel.style.display = t === tab ? 'block' : 'none';
        if (navItem) navItem.classList.toggle('active', t === tab);
    });

    if (tab === 'personal') populatePersonalInfoPanel();
    if (tab === 'account') populateAccountSettingsPanel();
    if (tab === 'appearance') { renderThemeSwatchGrid(); renderSidebarModeButtons(); }
    if (tab === 'tags') renderTagTable();
    if (tab === 'contracts') renderContractSizeTable();
    if (tab === 'playbooks') renderPlaybookList();
    if (tab === 'import') renderCsvImportMeta();
    if (tab === 'danger') {
        const nameEl = document.getElementById('settings-danger-account-name');
        if (nameEl) nameEl.textContent = getActiveAccount().name;
    }
}

function showSettingsStatus(id, message, kind) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = message;
    el.className = `settings-status ${kind || ''}`.trim();
}

// ---- Personal Info ----
function populatePersonalInfoPanel() {
    const user = auth.currentUser;
    document.getElementById('settings-name-input').value = (user && user.displayName) || '';
    document.getElementById('settings-email-input').value = (user && user.email) || 'Guest (not logged in)';
    showSettingsStatus('settings-personal-status', '');

    const img = document.getElementById('settings-avatar-img');
    const fallback = document.getElementById('settings-avatar-fallback');
    const photo = customAvatarDataUrl || (user && user.photoURL);
    if (photo) {
        img.src = photo;
        img.style.display = 'block';
        fallback.style.display = 'none';
    } else {
        img.style.display = 'none';
        fallback.style.display = 'block';
    }
}

function savePersonalInfo() {
    const user = auth.currentUser;
    if (!user) {
        showSettingsStatus('settings-personal-status', 'Log in to save profile changes.', 'error');
        return;
    }

    const name = document.getElementById('settings-name-input').value.trim();
    user.updateProfile({ displayName: name })
        .then(() => {
            const nameLabel = document.getElementById('sidebar-username');
            if (nameLabel) nameLabel.textContent = name || user.email || 'Account';
            saveCustomAvatar();
            showSettingsStatus('settings-personal-status', 'Saved.', 'success');
        })
        .catch(err => showSettingsStatus('settings-personal-status', err.message, 'error'));
}

// ---- Account Settings ----
function populateAccountSettingsPanel() {
    document.getElementById('settings-currency-format').value = appSettings.currencyCode;
    document.getElementById('settings-default-order-date').value = appSettings.defaultOrderDate;
    document.getElementById('settings-default-grid-date').value = appSettings.defaultGridDate;
    document.getElementById('settings-default-symbol').value = appSettings.defaultSymbol;
    document.getElementById('settings-default-qty').value = appSettings.defaultQty;
    document.getElementById('settings-default-fee').value = appSettings.defaultFee;
    document.getElementById('settings-pnl-calc-type').value = appSettings.pnlCalcType;
    document.getElementById('settings-breakeven-range').value = appSettings.breakevenRange || 0;
    document.getElementById('settings-max-daily-loss').value = appSettings.maxDailyLoss || 0;
    document.getElementById('settings-max-daily-trades').value = appSettings.maxDailyTrades || 0;
    populateDefaultTagSelect();
    showSettingsStatus('settings-account-status', '');
    document.getElementById('settings-public-link-result').innerHTML = '';
}

function populateDefaultTagSelect() {
    const select = document.getElementById('settings-default-tag');
    if (!select) return;
    const tagDefs = (getActiveAccount().tagDefs) || [];
    select.innerHTML = '<option value="">None</option>' +
        tagDefs.map(t => `<option value="${t.id}" ${t.id === appSettings.defaultTagId ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('');
}

function saveAccountSettings() {
    appSettings.currencyCode = document.getElementById('settings-currency-format').value;
    appSettings.defaultOrderDate = document.getElementById('settings-default-order-date').value;
    appSettings.defaultGridDate = document.getElementById('settings-default-grid-date').value;
    appSettings.defaultSymbol = document.getElementById('settings-default-symbol').value.trim().toUpperCase();
    appSettings.defaultQty = document.getElementById('settings-default-qty').value;
    appSettings.defaultFee = document.getElementById('settings-default-fee').value;
    appSettings.defaultTagId = document.getElementById('settings-default-tag').value;
    appSettings.pnlCalcType = document.getElementById('settings-pnl-calc-type').value;
    appSettings.breakevenRange = parseFloat(document.getElementById('settings-breakeven-range').value) || 0;
    appSettings.maxDailyLoss = Math.abs(parseFloat(document.getElementById('settings-max-daily-loss').value)) || 0;
    appSettings.maxDailyTrades = Math.max(0, parseInt(document.getElementById('settings-max-daily-trades').value, 10)) || 0;

    saveAppSettings();
    renderSidebarAccount();
    if (typeof renderTradeLog === 'function') renderTradeLog();
    if (typeof renderStatsPage === 'function') renderStatsPage();
    showSettingsStatus('settings-account-status', 'Saved.', 'success');
}

function round2(n) {
    return Math.round((n || 0) * 100) / 100;
}

// Embeds a snapshot of the last 100 closed trades directly in the URL (base64 in
// the hash) so the link works with zero backend/Firestore changes. It's a
// point-in-time snapshot, not a live feed - regenerate it to share an update.
function generatePublicLink() {
    const account = getActiveAccount();
    const rows = (account.trades || [])
        .map(computeTradeSummary)
        .filter(r => r.returnAmount !== null)
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 100);

    const payload = {
        accountName: account.name,
        generatedAt: new Date().toISOString(),
        currencySymbol: getCurrencySymbol(),
        trades: rows.map(r => ({
            date: r.date,
            symbol: r.symbol,
            direction: r.direction,
            qty: r.qty,
            entry: round2(r.entryPrice),
            exit: round2(r.exitPrice),
            ret: round2(r.returnAmount),
            retPct: round2(r.returnPct)
        }))
    };

    const json = JSON.stringify(payload);
    const encoded = btoa(unescape(encodeURIComponent(json)));
    const basePath = location.pathname.replace(/index\.html$/, '');
    const url = `${location.origin}${basePath}journal.html#data=${encoded}`;

    document.getElementById('settings-public-link-result').innerHTML = `
        <input type="text" class="settings-public-link-input" readonly value="${escapeHtml(url)}" onclick="this.select()">
        <button class="btn-action btn-blue" style="width: auto; margin-top: 8px;" onclick="copyPublicLink('${url.replace(/'/g, "\\'")}')">Copy Link</button>`;
}

function copyPublicLink(url) {
    navigator.clipboard.writeText(url)
        .then(() => showSettingsStatus('settings-account-status', 'Link copied to clipboard.', 'success'))
        .catch(() => showSettingsStatus('settings-account-status', 'Could not copy automatically - select and copy the link manually.', 'error'));
}

// Downloads the full trade history as a CSV - reuses the same filter state as
// the Dashboard (tradeLogFilters, filters.js) so the export matches whatever
// view the user currently has narrowed down (tags/symbol/direction/status/date).
function exportTradesToCsv() {
    const account = getActiveAccount();
    let rows = (account.trades || []).map(computeTradeSummary);

    if (typeof tradeLogFilters !== 'undefined' && typeof tradeRowMatchesFilters === 'function') {
        rows = rows.filter(row => tradeRowMatchesFilters(row, tradeLogFilters));
    }

    rows.sort((a, b) => new Date(a.date) - new Date(b.date));

    if (rows.length === 0) {
        showSettingsStatus('settings-account-status', 'No trades to export.', 'error');
        return;
    }

    const tagDefs = (account.tagDefs) || [];
    const tagNameById = new Map(tagDefs.map(t => [t.id, t.name]));

    const csvRows = rows.map(r => ({
        Date: formatTradeDate(r.date),
        Symbol: r.symbol,
        Direction: r.direction,
        Status: r.status,
        Qty: r.qty,
        'Entry Price': round2(r.entryPrice),
        'Exit Price': r.exitPrice ? round2(r.exitPrice) : '',
        'Entry Total': round2(r.entTot),
        'Exit Total': r.extTot ? round2(r.extTot) : '',
        PnL: r.returnAmount !== null ? round2(r.returnAmount) : '',
        'PnL %': r.returnPct !== null ? round2(r.returnPct) : '',
        Tags: (r.tagIds || []).map(id => tagNameById.get(id)).filter(Boolean).join('; ')
    }));

    const csv = Papa.unparse(csvRows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `${account.name.replace(/[^a-z0-9]/gi, '_')}_trades_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showSettingsStatus('settings-account-status', `Exported ${csvRows.length} trades.`, 'success');
}

// ---- Tag Management ----
// Custom Tag Categories: a managed list (account.tagCategories) instead of a
// free-text field, so every tag picks from the same consistent set instead of
// "Setup"/"setup"/"Setups" all meaning the same thing to you but not to a filter.
function getTagCategoriesArray(account) {
    if (Array.isArray(account.tagCategories)) return account.tagCategories;

    // One-time migration: turn any pre-existing free-text tag.category values
    // into real category records instead of silently discarding them.
    const tagDefs = account.tagDefs || [];
    const uniqueNames = Array.from(new Set(tagDefs.map(t => (t.category || '').trim()).filter(Boolean)));
    const categories = uniqueNames.map(name => ({ id: genId(), name }));
    const nameToId = new Map(categories.map(c => [c.name, c.id]));
    tagDefs.forEach(t => { t.category = nameToId.get((t.category || '').trim()) || ''; });

    account.tagCategories = categories;
    if (categories.length > 0) saveAccountsState();
    return categories;
}

// Same custom dropdown as the CSV Timezone / Account Switcher selects (a
// native <select>'s open list is rendered by the OS/browser, not the page,
// so it can't be themed) - one per tag row, so this uses event delegation
// keyed by data-tag-id instead of a fixed id, since any number of rows can
// exist. Only one row's list is open at a time.
function buildCategoryCustomSelectHtml(tagId, selectedId) {
    const categories = getTagCategoriesArray(getActiveAccount());
    const items = [{ id: '', name: 'None' }, ...categories];
    const current = items.find(c => c.id === selectedId) || items[0];

    const optionsHtml = items.map(c => `
        <div class="custom-select-option${c.id === selectedId ? ' active' : ''}" data-category-id="${c.id}">${escapeHtml(c.name)}</div>`
    ).join('');

    return `
        <div class="custom-select tag-category-select" data-tag-id="${tagId}">
            <button type="button" class="custom-select-trigger" onclick="toggleTagCategoryDropdown(event, this)">
                <span>${escapeHtml(current.name)}</span>
                <i class="fa-solid fa-chevron-down"></i>
            </button>
            <div class="custom-select-list" style="display: none;">${optionsHtml}</div>
        </div>`;
}

function toggleTagCategoryDropdown(event, triggerBtn) {
    event.stopPropagation();
    const thisList = triggerBtn.nextElementSibling;
    const wasOpen = thisList.style.display === 'block';
    // Only one row's dropdown open at a time.
    document.querySelectorAll('.tag-category-select .custom-select-list').forEach(list => { list.style.display = 'none'; });
    thisList.style.display = wasOpen ? 'none' : 'block';
}

// Delegated so it works for every row without binding a listener per option -
// the table is fully rebuilt (addTagRow/deleteTagRow/renderTagTable) often
// enough that per-element listeners would otherwise leak or go stale.
document.addEventListener('click', event => {
    const option = event.target.closest('.tag-category-select .custom-select-option');
    if (!option) return;
    const wrap = option.closest('.tag-category-select');
    updateTagField(wrap.dataset.tagId, 'category', option.dataset.categoryId);
    renderTagTable();
});

document.addEventListener('click', event => {
    if (event.target.closest('.tag-category-select')) return;
    document.querySelectorAll('.tag-category-select .custom-select-list').forEach(list => { list.style.display = 'none'; });
});

function renderTagCategoryChips() {
    const container = document.getElementById('tag-category-chips');
    if (!container) return;
    const categories = getTagCategoriesArray(getActiveAccount());
    container.innerHTML = categories.length > 0
        ? categories.map(c => `
            <span class="tag-chip">${escapeHtml(c.name)}<button type="button" onclick="deleteTagCategory('${c.id}')">&times;</button></span>`).join('')
        : '<span class="settings-share-desc" style="margin:0;">No categories yet - add one below.</span>';
}

function addTagCategory() {
    const input = document.getElementById('tag-category-input');
    const name = (input.value || '').trim();
    if (!name) return;

    const account = getActiveAccount();
    const categories = getTagCategoriesArray(account);
    categories.push({ id: genId(), name });
    account.tagCategories = categories;

    saveAccountsState();
    input.value = '';
    renderTagCategoryChips();
    renderTagTable();
}

function deleteTagCategory(categoryId) {
    const account = getActiveAccount();
    account.tagCategories = getTagCategoriesArray(account).filter(c => c.id !== categoryId);
    // Tags that used this category fall back to "None" rather than pointing at
    // a category that no longer exists.
    (account.tagDefs || []).forEach(t => { if (t.category === categoryId) t.category = ''; });

    saveAccountsState();
    renderTagCategoryChips();
    renderTagTable();
}

function renderTagTable() {
    const tbody = document.getElementById('settings-tag-table-body');
    if (!tbody) return;
    renderTagCategoryChips();
    const tagDefs = (getActiveAccount().tagDefs) || [];

    tbody.innerHTML = tagDefs.map(t => `
        <tr>
            <td><input type="text" value="${escapeHtml(t.name)}" onchange="updateTagField('${t.id}','name',this.value)"></td>
            <td>${buildCategoryCustomSelectHtml(t.id, t.category || '')}</td>
            <td><input type="text" value="${escapeHtml(t.description || '')}" onchange="updateTagField('${t.id}','description',this.value)"></td>
            <td><button class="txn-remove-btn" onclick="deleteTagRow('${t.id}')" title="Delete"><i class="fa-solid fa-circle-xmark"></i></button></td>
        </tr>`).join('');
}

function addTagRow() {
    const account = getActiveAccount();
    if (!account.tagDefs) account.tagDefs = [];
    account.tagDefs.push({ id: genId(), name: 'New Tag', category: '', description: '' });
    saveAccountsState();
    renderTagTable();
}

function updateTagField(tagId, field, value) {
    const account = getActiveAccount();
    const tag = (account.tagDefs || []).find(t => t.id === tagId);
    if (!tag) return;
    tag[field] = value;
    saveAccountsState();
}

function deleteTagRow(tagId) {
    const account = getActiveAccount();
    account.tagDefs = (account.tagDefs || []).filter(t => t.id !== tagId);
    // Strip the deleted tag from every trade so it doesn't linger as an
    // orphaned "Unknown Tag" reference.
    (account.trades || []).forEach(t => {
        if (t.tagIds && t.tagIds.includes(tagId)) t.tagIds = t.tagIds.filter(id => id !== tagId);
        if (t.tagId === tagId) t.tagId = '';
    });
    saveAccountsState();
    renderTagTable();
    if (typeof renderTradeLog === 'function') renderTradeLog();
    if (typeof renderStatsPage === 'function') renderStatsPage();
}

// ---- Playbooks (Settings > Playbooks) - define a strategy's rules, then
// assign trades to it from the New/Edit Trade modal (see trade-modal-playbook
// in app.html). Stats breaks down performance per playbook. ----
function renderPlaybookList() {
    const container = document.getElementById('settings-playbook-list');
    if (!container) return;
    const playbooks = (getActiveAccount().playbooks) || [];

    container.innerHTML = playbooks.length > 0 ? playbooks.map(p => `
        <div class="playbook-card">
            <div class="playbook-card-header">
                <input type="text" class="modal-input playbook-name-input" value="${escapeHtml(p.name)}" onchange="updatePlaybookField('${p.id}','name',this.value)">
                <button class="txn-remove-btn" onclick="deletePlaybookRow('${p.id}')" title="Delete"><i class="fa-solid fa-circle-xmark"></i></button>
            </div>
            <textarea class="modal-input playbook-rules-textarea" rows="4" placeholder="Entry criteria, stop-loss/target rules, what setups qualify..." onchange="updatePlaybookField('${p.id}','rules',this.value)">${escapeHtml(p.rules || '')}</textarea>
        </div>`).join('') : '<p class="settings-share-desc">No playbooks yet - add one above to start defining your strategies.</p>';
}

function addPlaybookRow() {
    const account = getActiveAccount();
    if (!account.playbooks) account.playbooks = [];
    account.playbooks.push({ id: genId(), name: 'New Playbook', rules: '' });
    saveAccountsState();
    renderPlaybookList();
}

function updatePlaybookField(playbookId, field, value) {
    const account = getActiveAccount();
    const playbook = (account.playbooks || []).find(p => p.id === playbookId);
    if (!playbook) return;
    playbook[field] = value;
    saveAccountsState();
}

function deletePlaybookRow(playbookId) {
    const account = getActiveAccount();
    account.playbooks = (account.playbooks || []).filter(p => p.id !== playbookId);
    // Trades that used this playbook fall back to "None" rather than pointing
    // at a playbook that no longer exists.
    (account.trades || []).forEach(t => { if (t.playbookId === playbookId) t.playbookId = null; });
    saveAccountsState();
    renderPlaybookList();
    if (typeof renderTradeLog === 'function') renderTradeLog();
}

function populatePlaybookSelect(selectedId) {
    const select = document.getElementById('trade-modal-playbook');
    if (!select) return;
    const playbooks = (getActiveAccount().playbooks) || [];
    select.innerHTML = '<option value="">None</option>' +
        playbooks.map(p => `<option value="${p.id}" ${p.id === selectedId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('');
}

// The "+" button next to the trade modal's Playbook select - skips the trip
// to Settings > Playbooks for the common case of just wanting to name a new
// strategy on the spot. Entry criteria/rules can still be filled in later
// from Settings; this only needs a name to be immediately selectable. Uses
// the app's own themed modal (quick-playbook-modal-overlay) rather than the
// browser's native prompt(), which looks jarring against the rest of the UI.
function quickAddPlaybookFromTradeModal() {
    const input = document.getElementById('quick-playbook-name-input');
    if (input) input.value = '';
    document.getElementById('quick-playbook-modal-overlay').style.display = 'flex';
    if (input) setTimeout(() => input.focus(), 50);
}

function closeQuickPlaybookModal() {
    document.getElementById('quick-playbook-modal-overlay').style.display = 'none';
}

function confirmQuickAddPlaybook() {
    const input = document.getElementById('quick-playbook-name-input');
    const name = ((input && input.value) || '').trim();
    if (!name) {
        if (input) input.focus();
        return;
    }

    const account = getActiveAccount();
    if (!account.playbooks) account.playbooks = [];
    const playbook = { id: genId(), name, rules: '' };
    account.playbooks.push(playbook);
    saveAccountsState();

    populatePlaybookSelect(playbook.id);
    // Settings > Playbooks might be open behind the modal (or opened later
    // this session) - keep its list in sync too.
    if (typeof renderPlaybookList === 'function') renderPlaybookList();
    closeQuickPlaybookModal();
}

// ---- Instrument Settings (contract size fixes P&L math for lot-based
// instruments - see getContractSizeForSymbol in accounts.js for why this
// isn't "leverage" - plus typical fee/swap/leverage reference fields) ----
function renderContractSizeTable() {
    const tbody = document.getElementById('settings-contract-size-table-body');
    if (!tbody) return;
    const rows = (getActiveAccount().contractSizes) || [];

    tbody.innerHTML = rows.map(r => `
        <tr>
            <td><input type="text" value="${escapeHtml(r.symbol)}" onchange="updateContractSizeField('${r.id}','symbol',this.value.trim().toUpperCase())"></td>
            <td><input type="number" step="1" min="1" value="${r.size}" onchange="updateContractSizeField('${r.id}','size',parseFloat(this.value) || 1)"></td>
            <td><input type="number" step="0.01" min="0" value="${r.typicalFee || 0}" onchange="updateContractSizeField('${r.id}','typicalFee',parseFloat(this.value) || 0)"></td>
            <td><input type="number" step="0.01" value="${r.swapLong || 0}" onchange="updateContractSizeField('${r.id}','swapLong',parseFloat(this.value) || 0)"></td>
            <td><input type="number" step="0.01" value="${r.swapShort || 0}" onchange="updateContractSizeField('${r.id}','swapShort',parseFloat(this.value) || 0)"></td>
            <td><input type="text" placeholder="1:500" value="${escapeHtml(r.leverage || '')}" onchange="updateContractSizeField('${r.id}','leverage',this.value.trim())"></td>
            <td><button class="txn-remove-btn" onclick="deleteContractSizeRow('${r.id}')" title="Delete"><i class="fa-solid fa-circle-xmark"></i></button></td>
        </tr>`).join('');
}

function addContractSizeRow() {
    const account = getActiveAccount();
    if (!account.contractSizes) account.contractSizes = [];
    account.contractSizes.push({ id: genId(), symbol: 'NEWSYMBOL', size: 1, typicalFee: 0, swapLong: 0, swapShort: 0, leverage: '' });
    saveAccountsState();
    renderContractSizeTable();
}

function updateContractSizeField(rowId, field, value) {
    const account = getActiveAccount();
    const row = (account.contractSizes || []).find(r => r.id === rowId);
    if (!row) return;
    row[field] = value;
    saveAccountsState();
    if (typeof renderTradeLog === 'function') renderTradeLog();
    if (typeof renderStatsPage === 'function') renderStatsPage();
    updateSidebarBalanceDisplay();
}

function deleteContractSizeRow(rowId) {
    const account = getActiveAccount();
    account.contractSizes = (account.contractSizes || []).filter(r => r.id !== rowId);
    saveAccountsState();
    renderContractSizeTable();
    if (typeof renderTradeLog === 'function') renderTradeLog();
    if (typeof renderStatsPage === 'function') renderStatsPage();
    updateSidebarBalanceDisplay();
}

// ---- Password & Security ----
function savePassword() {
    const password = document.getElementById('settings-new-password').value;
    const confirmPassword = document.getElementById('settings-confirm-password').value;

    if (password.length < 6) {
        showSettingsStatus('settings-password-status', 'Password must be at least 6 characters.', 'error');
        return;
    }
    if (password !== confirmPassword) {
        showSettingsStatus('settings-password-status', 'Passwords do not match.', 'error');
        return;
    }

    const user = auth.currentUser;
    if (!user) {
        showSettingsStatus('settings-password-status', 'Log in to change your password.', 'error');
        return;
    }

    user.updatePassword(password)
        .then(() => {
            document.getElementById('settings-new-password').value = '';
            document.getElementById('settings-confirm-password').value = '';
            showSettingsStatus('settings-password-status', 'Password updated.', 'success');
        })
        .catch(err => {
            const message = err.code === 'auth/requires-recent-login'
                ? 'For security, please log out and back in, then try again.'
                : err.message;
            showSettingsStatus('settings-password-status', message, 'error');
        });
}

// ---- Danger ----
// Our accounts have always stored trades inside an account object, so the
// "orphaned trades" scenario this is meant to fix shouldn't occur here - this is a
// defensive sweep for any stray trade data sitting outside accountsState.accounts.
function fixMissingTrades() {
    const active = getActiveAccount();
    let recovered = 0;

    if (Array.isArray(accountsState.trades)) {
        active.trades = (active.trades || []).concat(accountsState.trades);
        recovered += accountsState.trades.length;
        delete accountsState.trades;
    }

    Object.values(accountsState.accounts).forEach(acc => {
        if (acc.id !== active.id && Array.isArray(acc.orphanedTrades)) {
            active.trades = (active.trades || []).concat(acc.orphanedTrades);
            recovered += acc.orphanedTrades.length;
            delete acc.orphanedTrades;
        }
    });

    if (recovered > 0) {
        saveAccountsState();
        renderSidebarAccount();
        showSettingsStatus('settings-fix-trades-status', `Recovered ${recovered} trade(s).`, 'success');
    } else {
        showSettingsStatus('settings-fix-trades-status', 'No missing trades found.', '');
    }
}

function deleteJournalData() {
    const active = getActiveAccount();
    showConfirmDialog({
        title: 'Delete Journal Data?',
        body: `Delete ALL journal data (trades, tags, notes) in "${active.name}"? This can't be undone.`,
        confirmText: 'Yes, delete it',
        onConfirm: () => {
            active.trades = [];
            active.tagDefs = [];
            active.dayNotes = [];
            saveAccountsState();
            renderSidebarAccount();
            if (currentSettingsTab === 'tags') renderTagTable();
            showSettingsStatus('settings-danger-journal-status', 'Journal data deleted.', 'success');
        }
    });
}

function deleteUserAccount() {
    const user = auth.currentUser;
    if (!user) {
        showSettingsStatus('settings-danger-account-status', 'You are not logged in.', 'error');
        return;
    }

    showConfirmDialog({
        title: 'Delete Your Account?',
        body: 'This will PERMANENTLY delete your account and all its data. This cannot be undone. Continue?',
        confirmText: 'Yes, delete my account',
        onConfirm: () => {
            db.collection('users').doc(user.uid).delete()
                .then(() => user.delete())
                .then(() => { window.location.href = 'login.html'; })
                .catch(err => {
                    if (err.code === 'auth/requires-recent-login') {
                        showSettingsStatus('settings-danger-account-status', 'For security, please log out and log back in, then try deleting your account again.', 'error');
                    } else {
                        showSettingsStatus('settings-danger-account-status', 'Could not delete account: ' + err.message, 'error');
                    }
                });
        }
    });
}
