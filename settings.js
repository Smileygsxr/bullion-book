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
    breakevenRange: 0
};

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
    renderSidebarAccount();
    if (typeof renderTradeLog === 'function') renderTradeLog();
}

function saveAppSettings() {
    const uid = auth.currentUser && auth.currentUser.uid;
    if (uid) {
        db.collection('users').doc(uid).set({ appSettings }, { merge: true })
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
    ['personal', 'account', 'tags', 'contracts', 'playbooks', 'import', 'security', 'danger'].forEach(t => {
        const panel = document.getElementById(`settings-panel-${t}`);
        const navItem = document.getElementById(`settings-tab-${t}`);
        if (panel) panel.style.display = t === tab ? 'block' : 'none';
        if (navItem) navItem.classList.toggle('active', t === tab);
    });

    if (tab === 'personal') populatePersonalInfoPanel();
    if (tab === 'account') populateAccountSettingsPanel();
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

function buildCategoryOptionsHtml(selectedId) {
    const categories = getTagCategoriesArray(getActiveAccount());
    const options = categories.map(c =>
        `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
    );
    return `<option value="">None</option>${options.join('')}`;
}

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
            <td><select onchange="updateTagField('${t.id}','category',this.value)">${buildCategoryOptionsHtml(t.category || '')}</select></td>
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
    saveAccountsState();
    renderTagTable();
}

// ---- Playbooks (Settings > Playbooks) - define a strategy's rules, then
// assign trades to it from the New/Edit Trade modal (see trade-modal-playbook
// in index.html). Stats breaks down performance per playbook. ----
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

// ---- Contract Sizes (fixes P&L math for lot-based instruments - see
// getContractSizeForSymbol in accounts.js for why this isn't "leverage") ----
function renderContractSizeTable() {
    const tbody = document.getElementById('settings-contract-size-table-body');
    if (!tbody) return;
    const rows = (getActiveAccount().contractSizes) || [];

    tbody.innerHTML = rows.map(r => `
        <tr>
            <td><input type="text" value="${escapeHtml(r.symbol)}" onchange="updateContractSizeField('${r.id}','symbol',this.value.trim().toUpperCase())"></td>
            <td><input type="number" step="1" min="1" value="${r.size}" onchange="updateContractSizeField('${r.id}','size',parseFloat(this.value) || 1)"></td>
            <td><button class="txn-remove-btn" onclick="deleteContractSizeRow('${r.id}')" title="Delete"><i class="fa-solid fa-circle-xmark"></i></button></td>
        </tr>`).join('');
}

function addContractSizeRow() {
    const account = getActiveAccount();
    if (!account.contractSizes) account.contractSizes = [];
    account.contractSizes.push({ id: genId(), symbol: 'NEWSYMBOL', size: 1 });
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
