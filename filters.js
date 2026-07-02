// Sidebar toolbar: a privacy blur toggle, and a Dashboard trade filter flyout
// (Tags/Symbol/Direction/Status - no Market filter, this app doesn't model one).

// ---- Privacy mode: blurs $ figures app-wide via body.privacy-mode in CSS ----
function togglePrivacyMode() {
    const isOn = document.body.classList.toggle('privacy-mode');
    const btn = document.getElementById('privacy-toggle-btn');
    if (!btn) return;
    btn.classList.toggle('active', isOn);
    btn.innerHTML = isOn ? '<i class="fa-solid fa-eye-slash"></i>' : '<i class="fa-solid fa-eye"></i>';
    btn.title = isOn ? 'Show sensitive values' : 'Hide sensitive values';
}

// ---- Trade filter state ----
// tradeLogFilters is what's actually applied (read by trades.js's renderTradeLog
// and stats.js's getAllTradeRows). pendingFilter* holds in-progress edits to the
// Tags/Symbol/Direction/Status panel until Apply is clicked; dateFrom/dateTo are
// driven separately by the quick date-range buttons and take effect immediately.
let tradeLogFilters = { tagIds: [], symbols: [], direction: '', status: '', dateFrom: null, dateTo: null };
let pendingFilterTagIds = [];
let pendingFilterSymbols = [];

function tradeRowMatchesFilters(row, filters) {
    if (filters.tagIds.length > 0) {
        const rowTagIds = row.tagIds || [];
        if (!filters.tagIds.some(id => rowTagIds.includes(id))) return false;
    }
    if (filters.symbols.length > 0 && !filters.symbols.includes(row.symbol)) return false;
    if (filters.direction && row.direction !== filters.direction) return false;
    if (filters.status && row.status !== filters.status) return false;
    if (filters.dateFrom && new Date(row.date) < filters.dateFrom) return false;
    if (filters.dateTo && new Date(row.date) > filters.dateTo) return false;
    return true;
}

// ---- Quick date-range presets (Dashboard + Stats, applied immediately) ----
function startOfDay(d) { const r = new Date(d); r.setHours(0, 0, 0, 0); return r; }
function endOfDay(d) { const r = new Date(d); r.setHours(23, 59, 59, 999); return r; }
function startOfWeek(d) { const r = startOfDay(d); const day = (r.getDay() + 6) % 7; r.setDate(r.getDate() - day); return r; }
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d) { return endOfDay(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }

function computeDateRange(presetKey) {
    const now = new Date();

    switch (presetKey) {
        case 'today':
            return { from: startOfDay(now), to: endOfDay(now) };
        case 'yesterday': {
            const y = new Date(now); y.setDate(y.getDate() - 1);
            return { from: startOfDay(y), to: endOfDay(y) };
        }
        case 'thisWeek':
            return { from: startOfWeek(now), to: endOfDay(now) };
        case 'lastWeek': {
            const thisWeekStart = startOfWeek(now);
            const lastWeekStart = new Date(thisWeekStart); lastWeekStart.setDate(lastWeekStart.getDate() - 7);
            const lastWeekEnd = new Date(thisWeekStart); lastWeekEnd.setDate(lastWeekEnd.getDate() - 1);
            return { from: lastWeekStart, to: endOfDay(lastWeekEnd) };
        }
        case 'thisMonth':
            return { from: startOfMonth(now), to: endOfDay(now) };
        case 'lastMonth': {
            const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            return { from: startOfMonth(lastMonth), to: endOfMonth(lastMonth) };
        }
        case 'last3Months': {
            const from = new Date(now); from.setMonth(from.getMonth() - 3);
            return { from: startOfDay(from), to: endOfDay(now) };
        }
        case 'thisYear':
            return { from: new Date(now.getFullYear(), 0, 1), to: endOfDay(now) };
        case 'lastYear':
            return { from: new Date(now.getFullYear() - 1, 0, 1), to: endOfDay(new Date(now.getFullYear() - 1, 11, 31)) };
        default:
            return { from: null, to: null };
    }
}

let activeDateRangeKey = '';

function applyDateRangePreset(presetKey) {
    // Clicking the already-active preset again clears it, same as Reset.
    if (activeDateRangeKey === presetKey) {
        resetDateRangeFilter();
        return;
    }

    const range = computeDateRange(presetKey);
    tradeLogFilters.dateFrom = range.from;
    tradeLogFilters.dateTo = range.to;
    activeDateRangeKey = presetKey;
    updateDateRangeButtonState(presetKey);
    updateFilterToggleButtonState();
    refreshFilteredViews();
}

function resetDateRangeFilter() {
    tradeLogFilters.dateFrom = null;
    tradeLogFilters.dateTo = null;
    activeDateRangeKey = '';
    updateDateRangeButtonState('');
    updateFilterToggleButtonState();
    refreshFilteredViews();
}

function updateDateRangeButtonState(activeKey) {
    document.querySelectorAll('.date-range-btn').forEach(btn => {
        btn.classList.toggle('active', !!activeKey && btn.dataset.rangeKey === activeKey);
    });
}

// ---- Custom date range (shared popover, opened from either page's "Custom" button) ----
function toDateInputValue(date) {
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toggleCustomDateRangePopover(event) {
    const popover = document.getElementById('custom-date-range-popover');
    if (!popover) return;

    if (popover.style.display === 'block') {
        popover.style.display = 'none';
        return;
    }

    const fromInput = document.getElementById('custom-date-from');
    const toInput = document.getElementById('custom-date-to');
    if (activeDateRangeKey === 'custom' && tradeLogFilters.dateFrom && tradeLogFilters.dateTo) {
        fromInput.value = toDateInputValue(tradeLogFilters.dateFrom);
        toInput.value = toDateInputValue(tradeLogFilters.dateTo);
    } else {
        fromInput.value = '';
        toInput.value = '';
    }

    const rect = event.currentTarget.getBoundingClientRect();
    popover.style.left = `${rect.left}px`;
    popover.style.top = `${rect.bottom + 6}px`;
    popover.style.display = 'block';
}

function applyCustomDateRange() {
    const fromVal = document.getElementById('custom-date-from').value;
    const toVal = document.getElementById('custom-date-to').value;
    if (!fromVal || !toVal) return;

    tradeLogFilters.dateFrom = startOfDay(new Date(`${fromVal}T00:00:00`));
    tradeLogFilters.dateTo = endOfDay(new Date(`${toVal}T00:00:00`));
    activeDateRangeKey = 'custom';

    updateDateRangeButtonState('custom');
    updateFilterToggleButtonState();
    refreshFilteredViews();
    document.getElementById('custom-date-range-popover').style.display = 'none';
}

document.addEventListener('click', event => {
    const popover = document.getElementById('custom-date-range-popover');
    if (!popover || popover.style.display === 'none') return;
    const customBtn = event.target.closest('[data-range-key="custom"]');
    if (popover.contains(event.target) || customBtn) return;
    popover.style.display = 'none';
});

// ---- Panel open/close ----
function toggleTradeFilterPanel() {
    const panel = document.getElementById('trade-filter-panel');
    if (!panel) return;

    if (panel.style.display === 'none') {
        pendingFilterTagIds = [...tradeLogFilters.tagIds];
        pendingFilterSymbols = [...tradeLogFilters.symbols];
        document.getElementById('filter-direction-select').value = tradeLogFilters.direction;
        document.getElementById('filter-status-select').value = tradeLogFilters.status;
        renderFilterTagChips();
        renderFilterSymbolChips();
        hideFilterSuggestLists();
        updateTradeFilterCounter();
        panel.style.display = 'block';
    } else {
        panel.style.display = 'none';
    }
}

document.addEventListener('click', event => {
    const panel = document.getElementById('trade-filter-panel');
    const toggleBtn = document.getElementById('filter-toggle-btn');
    if (!panel || panel.style.display === 'none') return;
    if (panel.contains(event.target) || (toggleBtn && toggleBtn.contains(event.target))) return;
    panel.style.display = 'none';
});

function hideFilterSuggestLists() {
    const tagList = document.getElementById('filter-tag-suggestions');
    const symbolList = document.getElementById('filter-symbol-suggestions');
    if (tagList) tagList.style.display = 'none';
    if (symbolList) symbolList.style.display = 'none';
}

// ---- Tags filter (search & multi-select chips, from account.tagDefs) ----
function renderFilterTagChips() {
    const container = document.getElementById('filter-tag-chips');
    if (!container) return;
    const tagDefs = (getActiveAccount().tagDefs) || [];
    const tagsById = new Map(tagDefs.map(t => [t.id, t]));

    container.innerHTML = pendingFilterTagIds.map(id => {
        const tag = tagsById.get(id);
        if (!tag) return '';
        return `<span class="tag-chip">${escapeHtml(tag.name)}<button type="button" onclick="event.stopPropagation(); removeFilterTag('${id}')">&times;</button></span>`;
    }).join('');
}

function removeFilterTag(tagId) {
    pendingFilterTagIds = pendingFilterTagIds.filter(id => id !== tagId);
    renderFilterTagChips();
    updateTradeFilterCounter();
}

function renderFilterTagSuggestions(query) {
    const list = document.getElementById('filter-tag-suggestions');
    if (!list) return;
    const q = query.trim().toLowerCase();
    const tagDefs = (getActiveAccount().tagDefs) || [];
    const matches = tagDefs.filter(t => !pendingFilterTagIds.includes(t.id) && (!q || t.name.toLowerCase().includes(q)));

    list.innerHTML = matches.map(t =>
        `<div class="filter-suggest-item" onmousedown="event.preventDefault(); addFilterTag('${t.id}')">${escapeHtml(t.name)}</div>`
    ).join('');
    list.style.display = matches.length > 0 ? 'block' : 'none';
}

function addFilterTag(tagId) {
    if (!pendingFilterTagIds.includes(tagId)) pendingFilterTagIds.push(tagId);
    const input = document.getElementById('filter-tag-input');
    if (input) input.value = '';
    document.getElementById('filter-tag-suggestions').style.display = 'none';
    renderFilterTagChips();
    updateTradeFilterCounter();
}

// ---- Symbol filter (search & multi-select chips, from symbols actually traded) ----
function getKnownTradeSymbols() {
    const trades = (getActiveAccount().trades) || [];
    return Array.from(new Set(trades.map(t => t.symbol).filter(Boolean))).sort();
}

function renderFilterSymbolChips() {
    const container = document.getElementById('filter-symbol-chips');
    if (!container) return;
    container.innerHTML = pendingFilterSymbols.map(symbol =>
        `<span class="tag-chip">${escapeHtml(symbol)}<button type="button" onclick="event.stopPropagation(); removeFilterSymbol('${symbol}')">&times;</button></span>`
    ).join('');
}

function removeFilterSymbol(symbol) {
    pendingFilterSymbols = pendingFilterSymbols.filter(s => s !== symbol);
    renderFilterSymbolChips();
    updateTradeFilterCounter();
}

function renderFilterSymbolSuggestions(query) {
    const list = document.getElementById('filter-symbol-suggestions');
    if (!list) return;
    const q = query.trim().toLowerCase();
    const matches = getKnownTradeSymbols().filter(symbol => !pendingFilterSymbols.includes(symbol) && (!q || symbol.toLowerCase().includes(q)));

    list.innerHTML = matches.map(symbol =>
        `<div class="filter-suggest-item" onmousedown="event.preventDefault(); addFilterSymbol('${symbol}')">${escapeHtml(symbol)}</div>`
    ).join('');
    list.style.display = matches.length > 0 ? 'block' : 'none';
}

function addFilterSymbol(symbol) {
    if (!pendingFilterSymbols.includes(symbol)) pendingFilterSymbols.push(symbol);
    const input = document.getElementById('filter-symbol-input');
    if (input) input.value = '';
    document.getElementById('filter-symbol-suggestions').style.display = 'none';
    renderFilterSymbolChips();
    updateTradeFilterCounter();
}

// ---- Counter / Reset / Apply ----
function buildPendingFilters() {
    return {
        tagIds: pendingFilterTagIds,
        symbols: pendingFilterSymbols,
        direction: document.getElementById('filter-direction-select').value,
        status: document.getElementById('filter-status-select').value,
        dateFrom: tradeLogFilters.dateFrom,
        dateTo: tradeLogFilters.dateTo
    };
}

function updateTradeFilterCounter() {
    const counterEl = document.getElementById('trade-filter-counter');
    if (!counterEl) return;

    const trades = (getActiveAccount().trades) || [];
    const total = trades.length;
    const displaying = trades.map(computeTradeSummary).filter(row => tradeRowMatchesFilters(row, buildPendingFilters())).length;
    counterEl.textContent = `Total: ${total} | Displaying: ${displaying}`;
}

function resetTradeFilters() {
    pendingFilterTagIds = [];
    pendingFilterSymbols = [];
    document.getElementById('filter-direction-select').value = '';
    document.getElementById('filter-status-select').value = '';
    renderFilterTagChips();
    renderFilterSymbolChips();
    updateTradeFilterCounter();

    tradeLogFilters.tagIds = [];
    tradeLogFilters.symbols = [];
    tradeLogFilters.direction = '';
    tradeLogFilters.status = '';
    updateFilterToggleButtonState();
    refreshFilteredViews();
}

function applyTradeFilters() {
    tradeLogFilters = buildPendingFilters();
    updateFilterToggleButtonState();
    refreshFilteredViews();
    document.getElementById('trade-filter-panel').style.display = 'none';
}

// Re-renders whichever filter-aware page is currently visible (Dashboard and/or
// Stats), so Apply/Reset take effect immediately without switching pages.
function refreshFilteredViews() {
    if (typeof renderTradeLog === 'function') renderTradeLog();
    if (typeof renderStatsPage === 'function') renderStatsPage();
}

function updateFilterToggleButtonState() {
    const btn = document.getElementById('filter-toggle-btn');
    if (!btn) return;
    const isActive = tradeLogFilters.tagIds.length > 0 || tradeLogFilters.symbols.length > 0
        || !!tradeLogFilters.direction || !!tradeLogFilters.status
        || !!tradeLogFilters.dateFrom || !!tradeLogFilters.dateTo;
    btn.classList.toggle('active', isActive);
}
