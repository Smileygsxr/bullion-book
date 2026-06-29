// New Trade modal + dashboard trade log. Trades are stored on the active account
// (accountsState.accounts[id].trades, see accounts.js), so switching/deleting an
// account swaps/clears its trade log along with its balance.
let draftTrade = null;

function genTradeId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function nowDatetimeLocal() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function makeDefaultLeg() {
    return { id: genTradeId(), action: 'buy', datetime: nowDatetimeLocal(), quantity: '', price: '', fee: 0 };
}

// ---- Modal open/close/tabs ----
function openTradeModal() {
    draftTrade = {
        id: genTradeId(),
        symbol: '',
        target: '',
        stopLoss: '',
        journal: '',
        legs: [makeDefaultLeg()]
    };

    document.getElementById('trade-modal-symbol').value = '';
    document.getElementById('trade-modal-target').value = '';
    document.getElementById('trade-modal-stoploss').value = '';
    document.getElementById('trade-modal-journal').value = '';
    switchTradeModalTab('general');
    renderTradeLegs();

    document.getElementById('trade-modal-overlay').style.display = 'flex';
}

function closeTradeModal() {
    document.getElementById('trade-modal-overlay').style.display = 'none';
    draftTrade = null;
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

    const validLegs = draftTrade.legs.filter(leg => parseFloat(leg.quantity) > 0 && leg.price !== '' && leg.datetime);
    if (!draftTrade.symbol || validLegs.length === 0) {
        alert('Enter a symbol and at least one action with a quantity, price and date/time.');
        return;
    }
    draftTrade.legs = validLegs;

    const account = getActiveAccount();
    if (!account.trades) account.trades = [];
    account.trades.push(draftTrade);

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
    const returnPct = closedQty > 0 && closedEntryValue !== 0 ? (returnAmount / closedEntryValue) * 100 : null;

    let status = 'OPEN';
    if (closedQty > 0) {
        if (returnAmount > 0) status = 'WIN';
        else if (returnAmount < 0) status = 'LOSS';
        else status = 'WASH';
    }

    const firstTime = new Date(legs[0].datetime).getTime();
    const lastTime = new Date(legs[legs.length - 1].datetime).getTime();

    return {
        id: trade.id,
        symbol: trade.symbol,
        date: legs[0].datetime,
        direction,
        status,
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

function formatPrice(value) {
    return `$${value.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`;
}

function formatTotal(value) {
    const sign = value < 0 ? '-' : '';
    return `${sign}$${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ---- Dashboard trade log table ----
function renderTradeLog() {
    const body = document.getElementById('trade-log-body');
    if (!body) return;

    const account = getActiveAccount();
    const trades = (account && account.trades) || [];

    const rows = trades
        .map(computeTradeSummary)
        .sort((a, b) => new Date(b.date) - new Date(a.date));

    renderDashboardStats(rows);

    body.innerHTML = rows.map(row => {
        const statusClass = `status-${row.status.toLowerCase()}`;
        const sideIcon = row.direction === 'long'
            ? '<i class="fa-solid fa-arrow-trend-up" style="color:#2ebd85;"></i>'
            : '<i class="fa-solid fa-arrow-trend-down" style="color:#f6465d;"></i>';
        const returnClass = row.returnAmount > 0 ? 'value-positive' : row.returnAmount < 0 ? 'value-negative' : '';

        return `
        <div class="table-row">
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
        </div>`;
    }).join('');
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
