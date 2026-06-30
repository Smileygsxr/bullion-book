// New Trade modal + dashboard trade log. Trades are stored on the active account
// (accountsState.accounts[id].trades, see accounts.js), so switching/deleting an
// account swaps/clears its trade log along with its balance.
let draftTrade = null;
let editingTradeId = null;
let viewingTradeId = null;

function genTradeId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function nowDatetimeLocal() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function makeDefaultLeg(quantity, fee) {
    return { id: genTradeId(), action: 'buy', datetime: nowDatetimeLocal(), quantity: quantity || '', price: '', fee: fee || 0 };
}

// ---- Modal open/close/tabs ----
// With no tradeId: blank "New Trade" (prefilled from Settings > Account Settings
// defaults). With a tradeId: "Edit Trade", prefilled from that trade (used by the
// Trade View modal's Edit button).
function openTradeModal(tradeId) {
    const existing = tradeId
        ? (getActiveAccount().trades || []).find(t => t.id === tradeId)
        : null;
    const defaults = (typeof appSettings !== 'undefined') ? appSettings : {};

    editingTradeId = existing ? existing.id : null;
    draftTrade = existing
        ? JSON.parse(JSON.stringify(existing))
        : {
            id: genTradeId(),
            symbol: defaults.defaultSymbol || '',
            target: '',
            stopLoss: '',
            journal: '',
            tagId: defaults.defaultTagId || '',
            legs: [makeDefaultLeg(defaults.defaultQty, defaults.defaultFee)]
        };

    document.getElementById('trade-modal-title').textContent = editingTradeId ? 'Edit Trade' : 'New Trade';
    document.getElementById('trade-modal-symbol').value = draftTrade.symbol || '';
    document.getElementById('trade-modal-target').value = draftTrade.target || '';
    document.getElementById('trade-modal-stoploss').value = draftTrade.stopLoss || '';
    document.getElementById('trade-modal-journal').value = draftTrade.journal || '';
    populateTradeTagSelect(draftTrade.tagId || '');
    switchTradeModalTab('general');
    renderTradeLegs();

    document.getElementById('trade-modal-overlay').style.display = 'flex';
}

function populateTradeTagSelect(selectedTagId) {
    const select = document.getElementById('trade-modal-tag');
    if (!select) return;
    const tagDefs = (getActiveAccount().tagDefs) || [];
    select.innerHTML = '<option value="">No Tag</option>' +
        tagDefs.map(t => `<option value="${t.id}" ${t.id === selectedTagId ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('');
}

function closeTradeModal() {
    document.getElementById('trade-modal-overlay').style.display = 'none';
    draftTrade = null;
    editingTradeId = null;
}

function switchTradeModalTab(tab) {
    document.getElementById('trade-tab-general').classList.toggle('active', tab === 'general');
    document.getElementById('trade-tab-journal').classList.toggle('active', tab === 'journal');
    document.getElementById('trade-tab-panel-general').style.display = tab === 'general' ? 'block' : 'none';
    document.getElementById('trade-tab-panel-journal').style.display = tab === 'journal' ? 'block' : 'none';
}

// ---- Leg rows ----
function renderTradeLegs() {
    const tbody = document.getElementById('trade-modal-legs');
    if (!tbody) return;

    tbody.innerHTML = draftTrade.legs.map(leg => `
        <tr>
            <td><button class="txn-remove-btn" onclick="removeTradeLeg('${leg.id}')" title="Remove"><i class="fa-solid fa-circle-xmark"></i></button></td>
            <td><button class="leg-action-toggle ${leg.action}" onclick="toggleLegAction('${leg.id}')">${leg.action.toUpperCase()}</button></td>
            <td><input type="datetime-local" class="modal-input" value="${leg.datetime}" onchange="updateTradeLeg('${leg.id}','datetime',this.value)"></td>
            <td><input type="number" step="0.0001" class="modal-input" value="${leg.quantity}" onchange="updateTradeLeg('${leg.id}','quantity',this.value)"></td>
            <td><input type="number" step="0.0001" class="modal-input" value="${leg.price}" onchange="updateTradeLeg('${leg.id}','price',this.value)"></td>
            <td><input type="number" step="0.01" class="modal-input" value="${leg.fee}" onchange="updateTradeLeg('${leg.id}','fee',this.value)"></td>
        </tr>
    `).join('');
}

function addTradeLeg() {
    draftTrade.legs.push(makeDefaultLeg());
    renderTradeLegs();
}

function removeTradeLeg(id) {
    draftTrade.legs = draftTrade.legs.filter(leg => leg.id !== id);
    renderTradeLegs();
}

function toggleLegAction(id) {
    const leg = draftTrade.legs.find(l => l.id === id);
    if (!leg) return;
    leg.action = leg.action === 'buy' ? 'sell' : 'buy';
    renderTradeLegs();
}

function updateTradeLeg(id, field, value) {
    const leg = draftTrade.legs.find(l => l.id === id);
    if (leg) leg[field] = value;
}

// ---- Save ----
function saveTradeModal() {
    draftTrade.symbol = (document.getElementById('trade-modal-symbol').value || '').trim().toUpperCase();
    draftTrade.target = document.getElementById('trade-modal-target').value;
    draftTrade.stopLoss = document.getElementById('trade-modal-stoploss').value;
    draftTrade.journal = document.getElementById('trade-modal-journal').value;
    draftTrade.tagId = document.getElementById('trade-modal-tag').value;

    const validLegs = draftTrade.legs.filter(leg => parseFloat(leg.quantity) > 0 && leg.price !== '' && leg.datetime);
    if (!draftTrade.symbol || validLegs.length === 0) {
        alert('Enter a symbol and at least one action with a quantity, price and date/time.');
        return;
    }
    draftTrade.legs = validLegs;

    const account = getActiveAccount();
    if (!account.trades) account.trades = [];

    if (editingTradeId) {
        const index = account.trades.findIndex(t => t.id === editingTradeId);
        if (index >= 0) account.trades[index] = draftTrade;
        else account.trades.push(draftTrade);
    } else {
        account.trades.push(draftTrade);
    }

    saveAccountsState();
    renderTradeLog();
    closeTradeModal();
}

// ---- Calculations: turns a trade's buy/sell legs into one summarized row ----
function computeTradeSummary(trade) {
    const legs = trade.legs.slice().sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
    const direction = legs[0].action === 'sell' ? 'short' : 'long';
    const entryAction = direction === 'long' ? 'buy' : 'sell';
    const exitAction = direction === 'long' ? 'sell' : 'buy';

    const entryLegs = legs.filter(l => l.action === entryAction);
    const exitLegs = legs.filter(l => l.action === exitAction);

    const entryQty = entryLegs.reduce((sum, l) => sum + parseFloat(l.quantity), 0);
    const exitQty = exitLegs.reduce((sum, l) => sum + parseFloat(l.quantity), 0);
    const entTot = entryLegs.reduce((sum, l) => sum + parseFloat(l.quantity) * parseFloat(l.price), 0);
    const extTot = exitLegs.reduce((sum, l) => sum + parseFloat(l.quantity) * parseFloat(l.price), 0);
    const totalFees = legs.reduce((sum, l) => sum + (parseFloat(l.fee) || 0), 0);

    const entryPrice = entryQty > 0 ? entTot / entryQty : 0;
    const exitPrice = exitQty > 0 ? extTot / exitQty : 0;
    const closedQty = Math.min(entryQty, exitQty);
    const remainingQty = entryQty - exitQty;

    const directionSign = direction === 'long' ? 1 : -1;
    const closedEntryValue = entryPrice * closedQty;
    const closedExitValue = exitPrice * closedQty;
    const returnAmount = closedQty > 0
        ? (closedExitValue - closedEntryValue) * directionSign - totalFees
        : null;

    // PnL % is normally "return on invested capital" (this trade's own entry value).
    // The Settings > Account Settings page can switch it to "return on account balance" instead.
    const usesBalanceDenominator = typeof appSettings !== 'undefined' && appSettings.pnlCalcType === 'balance';
    const pnlDenominator = usesBalanceDenominator
        ? Math.abs(computeAccountBalance(getActiveAccount())) || closedEntryValue
        : closedEntryValue;
    const returnPct = closedQty > 0 && pnlDenominator !== 0 ? (returnAmount / pnlDenominator) * 100 : null;

    let status = 'OPEN';
    if (closedQty > 0) {
        if (returnAmount > 0) status = 'WIN';
        else if (returnAmount < 0) status = 'LOSS';
        else status = 'WASH';
    }
    if (trade.forceWash) status = 'WASH';

    const firstTime = new Date(legs[0].datetime).getTime();
    const lastTime = new Date(legs[legs.length - 1].datetime).getTime();

    return {
        id: trade.id,
        symbol: trade.symbol,
        date: legs[0].datetime,
        direction,
        status,
        tagId: trade.tagId || '',
        qty: entryQty,
        entryPrice,
        exitPrice,
        entTot,
        extTot,
        pos: remainingQty,
        holdSeconds: Math.max(0, (lastTime - firstTime) / 1000),
        returnAmount,
        returnPct
    };
}

function formatHoldDuration(seconds) {
    if (seconds < 60) return `${Math.round(seconds)} SEC`;
    const minutes = seconds / 60;
    if (minutes < 60) return `${Math.round(minutes)} MIN`;
    const hours = minutes / 60;
    if (hours < 24) return `${Math.round(hours)} HR`;
    return `${Math.round(hours / 24)} D`;
}

function formatTradeDate(isoLike) {
    const d = new Date(isoLike);
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function formatTradeDateTime(isoLike) {
    const d = new Date(isoLike);
    const datePart = d.toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: '2-digit' });
    const timePart = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return `${datePart}, ${timePart}`;
}

function formatPrice(value) {
    return `${getCurrencySymbol()}${value.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`;
}

function formatTotal(value) {
    const sign = value < 0 ? '-' : '';
    return `${sign}${getCurrencySymbol()}${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ---- Column sorting ----
const TRADE_SORT_KEYS = [
    'date', 'symbol', 'status', 'direction', 'qty', 'entryPrice', 'exitPrice',
    'entTot', 'extTot', 'pos', 'holdSeconds', 'returnAmount', 'returnPct'
];
let tradeSortKey = 'date';
let tradeSortDir = 'desc';

function sortTradeLog(key) {
    if (tradeSortKey === key) {
        tradeSortDir = tradeSortDir === 'asc' ? 'desc' : 'asc';
    } else {
        tradeSortKey = key;
        tradeSortDir = 'desc';
    }
    renderTradeLog();
}

function compareTradeRows(a, b, key, dir) {
    let av = a[key];
    let bv = b[key];

    if (key === 'date') {
        av = new Date(av).getTime();
        bv = new Date(bv).getTime();
    } else {
        if (av === null) av = -Infinity;
        if (bv === null) bv = -Infinity;
        if (typeof av === 'string') av = av.toLowerCase();
        if (typeof bv === 'string') bv = bv.toLowerCase();
    }

    if (av < bv) return dir === 'asc' ? -1 : 1;
    if (av > bv) return dir === 'asc' ? 1 : -1;
    return 0;
}

function updateSortHeaderIcons() {
    TRADE_SORT_KEYS.forEach(key => {
        const icon = document.getElementById(`sort-icon-${key}`);
        if (!icon) return;
        icon.className = key === tradeSortKey
            ? (tradeSortDir === 'asc' ? 'fa-solid fa-sort-up' : 'fa-solid fa-sort-down')
            : 'fa-solid fa-sort';
    });
}

// ---- Per-row "..." menu: Mark as Wash / Delete Trade ----
// A single shared menu, fixed-positioned via JS next to whichever row's "..." was
// clicked. Avoids nesting a dropdown inside each row, which got clipped/blocked by
// neighboring rows' stacking context and couldn't reliably receive clicks.
function toggleTradeRowMenu(event, tradeId) {
    event.stopPropagation();
    const menu = document.getElementById('trade-row-menu');
    if (menu.style.display === 'block' && menu.dataset.tradeId === tradeId) {
        closeTradeRowMenu();
        return;
    }

    menu.dataset.tradeId = tradeId;
    menu.style.display = 'block';

    const btnRect = event.currentTarget.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const left = Math.max(8, btnRect.right - menuRect.width);
    menu.style.top = `${btnRect.bottom + 4}px`;
    menu.style.left = `${left}px`;
}

function closeTradeRowMenu() {
    const menu = document.getElementById('trade-row-menu');
    if (menu) menu.style.display = 'none';
}

document.addEventListener('click', closeTradeRowMenu);

function handleMarkAsWashClick(event) {
    event.stopPropagation();
    const tradeId = document.getElementById('trade-row-menu').dataset.tradeId;
    closeTradeRowMenu();
    markTradeAsWash(tradeId);
}

function handleDeleteTradeClick(event) {
    event.stopPropagation();
    const tradeId = document.getElementById('trade-row-menu').dataset.tradeId;
    closeTradeRowMenu();
    deleteTrade(tradeId);
}

function markTradeAsWash(tradeId) {
    const account = getActiveAccount();
    const trade = (account.trades || []).find(t => t.id === tradeId);
    if (!trade) return;
    trade.forceWash = true;
    saveAccountsState();
    renderTradeLog();
}

function deleteTrade(tradeId) {
    if (!confirm("Delete this trade? This can't be undone.")) return;
    const account = getActiveAccount();
    account.trades = (account.trades || []).filter(t => t.id !== tradeId);
    saveAccountsState();
    renderTradeLog();
}

// ---- Trade View modal (click a row): read-only summary + an Edit button ----
function openTradeViewModal(event, tradeId) {
    if (event && event.target.closest('.trade-row-menu-wrap')) return;

    const account = getActiveAccount();
    const trade = (account.trades || []).find(t => t.id === tradeId);
    if (!trade) return;

    const row = computeTradeSummary(trade);
    viewingTradeId = tradeId;

    const legs = trade.legs.slice().sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
    const entryAction = row.direction === 'long' ? 'buy' : 'sell';
    const exitAction = row.direction === 'long' ? 'sell' : 'buy';
    const firstEntryLeg = legs.find(l => l.action === entryAction);
    const lastExitLeg = legs.slice().reverse().find(l => l.action === exitAction);

    document.getElementById('trade-view-symbol').textContent = row.symbol;

    const returnClass = row.returnAmount > 0 ? 'value-positive' : row.returnAmount < 0 ? 'value-negative' : '';
    const returnEl = document.getElementById('trade-view-return');
    returnEl.textContent = row.returnAmount === null
        ? 'Open'
        : `${formatTotal(row.returnAmount)} ${row.returnPct.toFixed(2)}%`;
    returnEl.className = `trade-view-return ${returnClass}`;

    document.getElementById('trade-view-hold').textContent = formatHoldDuration(row.holdSeconds);

    const directionEl = document.getElementById('trade-view-direction');
    directionEl.textContent = row.direction.toUpperCase();
    directionEl.className = `trade-view-badge ${row.direction === 'long' ? 'long' : 'short'}`;

    document.getElementById('trade-view-entry-time').textContent = firstEntryLeg ? formatTradeDateTime(firstEntryLeg.datetime) : '-';
    document.getElementById('trade-view-entry-detail').textContent = firstEntryLeg
        ? `${firstEntryLeg.quantity} @ ${formatPrice(parseFloat(firstEntryLeg.price))}` : '-';

    document.getElementById('trade-view-exit-time').textContent = lastExitLeg ? formatTradeDateTime(lastExitLeg.datetime) : 'Still open';
    document.getElementById('trade-view-exit-detail').textContent = lastExitLeg
        ? `${lastExitLeg.quantity} @ ${formatPrice(parseFloat(lastExitLeg.price))}` : '-';

    document.getElementById('trade-view-journal').value = trade.journal || '';

    document.getElementById('trade-view-modal-overlay').style.display = 'flex';
}

function closeTradeViewModal() {
    document.getElementById('trade-view-modal-overlay').style.display = 'none';
    viewingTradeId = null;
}

function editTradeFromView() {
    const tradeId = viewingTradeId;
    closeTradeViewModal();
    openTradeModal(tradeId);
}

// ---- Dashboard trade log table ----
function buildTradeRowHtml(row) {
    const statusClass = `status-${row.status.toLowerCase()}`;
    const sideIcon = row.direction === 'long'
        ? '<i class="fa-solid fa-arrow-trend-up" style="color:#2ebd85;"></i>'
        : '<i class="fa-solid fa-arrow-trend-down" style="color:#f6465d;"></i>';
    const returnClass = row.returnAmount > 0 ? 'value-positive' : row.returnAmount < 0 ? 'value-negative' : '';

    return `
    <div class="table-row" onclick="openTradeViewModal(event,'${row.id}')">
        <div class="table-cell">${formatTradeDate(row.date)}</div>
        <div class="table-cell">${escapeHtml(row.symbol)}</div>
        <div class="table-cell"><span class="status-pill ${statusClass}">${row.status}</span></div>
        <div class="table-cell">${sideIcon}</div>
        <div class="table-cell">${row.qty}</div>
        <div class="table-cell">${formatPrice(row.entryPrice)}</div>
        <div class="table-cell">${row.exitPrice ? formatPrice(row.exitPrice) : '-'}</div>
        <div class="table-cell">${formatTotal(row.entTot)}</div>
        <div class="table-cell">${row.extTot ? formatTotal(row.extTot) : '-'}</div>
        <div class="table-cell">${row.pos > 0 ? row.pos : '-'}</div>
        <div class="table-cell">${formatHoldDuration(row.holdSeconds)}</div>
        <div class="table-cell ${returnClass}">${row.returnAmount === null ? '-' : formatTotal(row.returnAmount)}</div>
        <div class="table-cell ${returnClass}">${row.returnPct === null ? '-' : row.returnPct.toFixed(2) + '%'}</div>
        <div class="trade-row-menu-wrap">
            <button class="trade-row-menu-btn" onclick="toggleTradeRowMenu(event,'${row.id}')"><i class="fa-solid fa-ellipsis"></i></button>
        </div>
    </div>`;
}

function renderTradeLog() {
    const body = document.getElementById('trade-log-body');
    if (!body) return;

    const account = getActiveAccount();
    const trades = (account && account.trades) || [];

    const rows = trades
        .map(computeTradeSummary)
        .sort((a, b) => compareTradeRows(a, b, tradeSortKey, tradeSortDir));

    renderDashboardStats(rows);
    renderEquityChart(rows);
    updateSortHeaderIcons();

    // Notes only interleave with trades by date when the log itself is date-sorted;
    // otherwise they're just listed first (newest note on top either way).
    const noteEntries = getDayNotesArray(account).map(note => ({ type: 'note', note, date: note.date }));

    let entries;
    if (tradeSortKey === 'date') {
        const tradeEntries = rows.map(row => ({ type: 'trade', row, date: row.date }));
        entries = mergeNoteAndTradeEntries(tradeEntries, noteEntries, tradeSortDir);
    } else {
        const sortedNotes = noteEntries.slice().sort((a, b) => (b.note.createdAt || 0) - (a.note.createdAt || 0));
        entries = [...sortedNotes, ...rows.map(row => ({ type: 'trade', row, date: row.date }))];
    }

    body.innerHTML = entries
        .map(entry => entry.type === 'note' ? buildNoteRowHtml(entry.note) : buildTradeRowHtml(entry.row))
        .join('');

    // Updates the News tab's Trade Levels overlay if a chart for an affected date is open
    if (typeof refreshAllTradeOverlays === 'function') refreshAllTradeOverlays();
}

// Same calendar day: notes always rank above trades, and among notes the most
// recently created/edited one ranks first - so a freshly saved note jumps to the
// top of its day's group instead of sitting wherever its date alone would sort it.
function mergeNoteAndTradeEntries(tradeEntries, noteEntries, dir) {
    return [...tradeEntries, ...noteEntries].sort((a, b) => {
        const aDay = a.date.slice(0, 10);
        const bDay = b.date.slice(0, 10);
        if (aDay !== bDay) {
            const cmp = aDay < bDay ? -1 : 1;
            return dir === 'asc' ? cmp : -cmp;
        }
        if (a.type !== b.type) return a.type === 'note' ? -1 : 1;
        if (a.type === 'note') return (b.note.createdAt || 0) - (a.note.createdAt || 0);
        return 0;
    });
}

// ---- Top-left dashboard card: cumulative PnL across closed trades, in the order they closed ----
let equityChartInstance = null;
let equitySeriesInstance = null;

function ensureEquityChart() {
    const container = document.getElementById('equity-curve-chart');
    if (!container || equityChartInstance) return;

    equityChartInstance = LightweightCharts.createChart(container, {
        width: container.clientWidth || 300,
        height: container.clientHeight || 110,
        layout: { background: { color: 'transparent' }, textColor: '#647080', attributionLogo: false },
        grid: { vertLines: { visible: false }, horzLines: { visible: false } },
        rightPriceScale: {
            visible: true,
            scaleMargins: { top: 0.15, bottom: 0 },
            localization: { priceFormatter: price => `$${price.toFixed(2)}` }
        },
        timeScale: { visible: true, borderColor: '#2a2e39' },
        handleScroll: false,
        handleScale: false
    });

    equitySeriesInstance = equityChartInstance.addSeries(LightweightCharts.AreaSeries, {
        lineColor: '#2979ff',
        topColor: 'rgba(41, 121, 255, 0.55)',
        bottomColor: 'rgba(41, 121, 255, 0.08)',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false
    });

    window.addEventListener('resize', () => {
        if (equityChartInstance) equityChartInstance.resize(container.clientWidth, container.clientHeight);
    });
}

function renderEquityChart(rows) {
    ensureEquityChart();
    if (!equitySeriesInstance) return;

    const closed = rows
        .filter(r => r.returnAmount !== null)
        .slice()
        .sort((a, b) => new Date(a.date) - new Date(b.date));

    // One point per day so hovering shows the real close date, with same-day
    // trades collapsed into that day's running total (matches the Stats page chart).
    const byDay = new Map();
    let cumulative = 0;
    closed.forEach(r => {
        cumulative += r.returnAmount;
        byDay.set(r.date.slice(0, 10), cumulative);
    });

    const data = Array.from(byDay.entries()).map(([day, value]) => {
        const [y, m, d] = day.split('-').map(Number);
        return { time: Date.UTC(y, m - 1, d) / 1000, value };
    });

    equitySeriesInstance.setData(data.length > 0 ? data : [{ time: 0, value: 0 }]);
    equityChartInstance.timeScale().fitContent();

    setText('equity-trade-count', rows.length);
}

// ---- Dashboard summary cards: WINS/LOSSES/OPEN/WASH, AVG W/L, total PnL ----
function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function renderDashboardStats(rows) {
    const wins = rows.filter(r => r.status === 'WIN');
    const losses = rows.filter(r => r.status === 'LOSS');
    const open = rows.filter(r => r.status === 'OPEN');
    const wash = rows.filter(r => r.status === 'WASH');
    const closedCount = wins.length + losses.length + wash.length;

    setText('stat-wins', wins.length);
    setText('stat-losses', losses.length);
    setText('stat-open', open.length);
    setText('stat-wash', wash.length);

    const winsPct = closedCount > 0 ? Math.round((wins.length / closedCount) * 100) : 0;
    const lossesPct = closedCount > 0 ? Math.round((losses.length / closedCount) * 100) : 0;
    const openPct = rows.length > 0 ? Math.round((open.length / rows.length) * 100) : 0;
    const washPct = rows.length > 0 ? Math.round((wash.length / rows.length) * 100) : 0;
    setAttr('stat-wins-ring', 'data-pct', `${winsPct}%`);
    setAttr('stat-losses-ring', 'data-pct', `${lossesPct}%`);
    setAttr('stat-open-ring', 'data-pct', `${openPct}%`);
    setAttr('stat-wash-ring', 'data-pct', `${washPct}%`);

    const avgWin = wins.length > 0 ? wins.reduce((sum, r) => sum + r.returnAmount, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((sum, r) => sum + r.returnAmount, 0) / losses.length : 0;
    setText('stat-avg-win', formatTotal(avgWin));
    setText('stat-avg-loss', formatTotal(avgLoss));

    const closedRows = rows.filter(r => r.returnAmount !== null);
    const totalPnl = closedRows.reduce((sum, r) => sum + r.returnAmount, 0);
    const totalEntryValue = closedRows.reduce((sum, r) => sum + r.entTot, 0);
    const totalPnlPct = totalEntryValue !== 0 ? (totalPnl / totalEntryValue) * 100 : 0;

    const pnlValueEl = document.getElementById('stat-pnl-value');
    const pnlPctEl = document.getElementById('stat-pnl-pct');
    if (pnlValueEl) {
        pnlValueEl.textContent = formatTotal(totalPnl);
        pnlValueEl.style.color = totalPnl < 0 ? '#f6465d' : '#2ebd85';
    }
    if (pnlPctEl) {
        pnlPctEl.textContent = `${totalPnlPct >= 0 ? '' : '-'}${Math.abs(totalPnlPct).toFixed(1)}%`;
        pnlPctEl.style.color = totalPnl < 0 ? '#f6465d' : '#2ebd85';
        pnlPctEl.style.backgroundColor = totalPnl < 0 ? 'rgba(246, 70, 93, 0.1)' : 'rgba(46, 189, 133, 0.1)';
    }
}

function setAttr(id, attr, value) {
    const el = document.getElementById(id);
    if (el) el.setAttribute(attr, value);
}
