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

function makeDefaultLeg(quantity, fee, datetime) {
    return { id: genTradeId(), action: 'buy', datetime: datetime || nowDatetimeLocal(), quantity: quantity || '', price: '', fee: fee || 0 };
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
            confidence: 5,
            screenshots: [],
            tagIds: defaults.defaultTagId ? [defaults.defaultTagId] : [],
            legs: [makeDefaultLeg(defaults.defaultQty, defaults.defaultFee)]
        };

    // Older trades stored a single tagId - migrate to the tagIds array in place.
    if (!draftTrade.tagIds) {
        draftTrade.tagIds = draftTrade.tagId ? [draftTrade.tagId] : [];
    }
    if (typeof draftTrade.confidence !== 'number') draftTrade.confidence = 5;
    if (!draftTrade.screenshots) draftTrade.screenshots = [];

    document.getElementById('trade-modal-title').textContent = editingTradeId ? 'Edit Trade' : 'New Trade';
    document.getElementById('trade-modal-symbol').value = draftTrade.symbol || '';
    document.getElementById('trade-modal-target').value = draftTrade.target || '';
    document.getElementById('trade-modal-stoploss').value = draftTrade.stopLoss || '';
    document.getElementById('trade-modal-journal').value = draftTrade.journal || '';
    document.getElementById('trade-tag-input').value = '';
    document.getElementById('trade-modal-confidence').value = draftTrade.confidence;
    updateTradeConfidenceLabel(draftTrade.confidence);
    renderTradeTagChips();
    renderTradeScreenshotThumbs();
    switchTradeModalTab('general');
    renderTradeLegs();
    clearTradeModalValidation();

    document.getElementById('trade-modal-overlay').style.display = 'flex';
}

// ---- Inline validation (replaces alert() popups with a banner + a red ring
// around whichever fields are actually missing) ----
function clearFieldInvalid(el) {
    if (el) el.classList.remove('field-invalid');
}

function clearTradeModalValidation() {
    const errorBox = document.getElementById('trade-modal-error');
    if (errorBox) {
        errorBox.style.display = 'none';
        errorBox.textContent = '';
    }
    document.querySelectorAll('#trade-modal-overlay .field-invalid').forEach(el => el.classList.remove('field-invalid'));
}

function showTradeModalError(message) {
    const errorBox = document.getElementById('trade-modal-error');
    if (!errorBox) {
        alert(message);
        return;
    }
    errorBox.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${message}`;
    errorBox.style.display = 'flex';
}

// ---- Multi-tag chip input (Journal tab) ----
function renderTradeTagChips() {
    const container = document.getElementById('trade-tag-chips');
    if (!container) return;

    const tagDefs = (getActiveAccount().tagDefs) || [];
    const tagsById = new Map(tagDefs.map(t => [t.id, t]));

    container.innerHTML = (draftTrade.tagIds || []).map(tagId => {
        const tag = tagsById.get(tagId);
        if (!tag) return '';
        return `<span class="tag-chip">${escapeHtml(tag.name)}<button type="button" onclick="event.stopPropagation(); removeDraftTradeTag('${tagId}')">&times;</button></span>`;
    }).join('');
}

function removeDraftTradeTag(tagId) {
    draftTrade.tagIds = (draftTrade.tagIds || []).filter(id => id !== tagId);
    renderTradeTagChips();
}

// Enter or comma commits the typed text as a tag - reusing an existing tag
// (case-insensitive match) or creating a new one in account.tagDefs on the fly,
// the same tag store Settings > Tag Management and the Stats page read from.
function handleTagInputKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ',') return;
    event.preventDefault();
    commitPendingTagInput(event.target);
}

function commitPendingTagInput(inputEl) {
    const name = (inputEl.value || '').trim();
    if (!name) return;

    const account = getActiveAccount();
    if (!account.tagDefs) account.tagDefs = [];

    let tag = account.tagDefs.find(t => t.name.toLowerCase() === name.toLowerCase());
    if (!tag) {
        tag = { id: genId(), name, category: '', description: '' };
        account.tagDefs.push(tag);
        saveAccountsState();
    }

    if (!draftTrade.tagIds) draftTrade.tagIds = [];
    if (!draftTrade.tagIds.includes(tag.id)) draftTrade.tagIds.push(tag.id);

    inputEl.value = '';
    renderTradeTagChips();
}

// ---- Confidence slider (Journal tab) ----
// Red at 0 fading smoothly to green at 10, matching the Win/Loss color scheme
// used everywhere else in the app.
function getConfidenceColor(value) {
    const t = Math.max(0, Math.min(10, value)) / 10;
    const from = [246, 70, 93];   // #f6465d
    const to = [46, 189, 133];    // #2ebd85
    const [r, g, b] = from.map((c, i) => Math.round(c + (to[i] - c) * t));
    return `rgb(${r}, ${g}, ${b})`;
}

function updateTradeConfidenceLabel(value) {
    const confidence = parseInt(value, 10);
    draftTrade.confidence = confidence;

    const label = document.getElementById('trade-confidence-value');
    if (label) {
        label.textContent = confidence;
        label.style.color = getConfidenceColor(confidence);
    }
}

// ---- Screenshot upload (Journal tab) ----
// Resizes/compresses to a JPEG data URL before storing (same technique as the
// profile avatar in settings.js) so a handful of screenshots per trade don't
// blow past Firestore's per-document size limit.
function resizeImageFileToDataUrl(file, maxWidth, quality) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const image = new Image();
            image.onload = () => {
                const scale = Math.min(1, maxWidth / image.width);
                const w = Math.round(image.width * scale);
                const h = Math.round(image.height * scale);
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                canvas.getContext('2d').drawImage(image, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            image.onerror = reject;
            image.src = reader.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function handleTradeScreenshotFileChange(event) {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    Promise.all(files.map(file => resizeImageFileToDataUrl(file, 1000, 0.72)))
        .then(dataUrls => {
            if (!draftTrade.screenshots) draftTrade.screenshots = [];
            dataUrls.forEach(dataUrl => draftTrade.screenshots.push({ id: genTradeId(), dataUrl }));
            renderTradeScreenshotThumbs();
        });

    event.target.value = ''; // allow re-selecting the same filename later
}

function renderTradeScreenshotThumbs() {
    const container = document.getElementById('trade-screenshot-thumbs');
    if (!container) return;
    const shots = draftTrade.screenshots || [];

    container.innerHTML = shots.map(s => `
        <div class="trade-screenshot-thumb">
            <img src="${s.dataUrl}" onclick="window.open(this.src, '_blank')" alt="Trade screenshot">
            <button type="button" class="trade-screenshot-remove-btn" onclick="removeTradeScreenshot('${s.id}')" title="Remove"><i class="fa-solid fa-circle-xmark"></i></button>
        </div>`).join('');
}

function removeTradeScreenshot(id) {
    draftTrade.screenshots = (draftTrade.screenshots || []).filter(s => s.id !== id);
    renderTradeScreenshotThumbs();
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
            <td><input type="datetime-local" id="leg-datetime-${leg.id}" class="modal-input" value="${leg.datetime}" onchange="updateTradeLeg('${leg.id}','datetime',this.value); clearFieldInvalid(this);"></td>
            <td><input type="number" step="0.0001" id="leg-quantity-${leg.id}" class="modal-input" value="${leg.quantity}" onchange="updateTradeLeg('${leg.id}','quantity',this.value); clearFieldInvalid(this);"></td>
            <td><input type="number" step="0.0001" id="leg-price-${leg.id}" class="modal-input" value="${leg.price}" onchange="updateTradeLeg('${leg.id}','price',this.value); clearFieldInvalid(this);"></td>
            <td><input type="number" step="0.01" class="modal-input" value="${leg.fee}" onchange="updateTradeLeg('${leg.id}','fee',this.value)"></td>
        </tr>
    `).join('');
}

function addTradeLeg() {
    // "Default Order Date" setting (Settings > Account Settings): a new leg's
    // date/time is either copied from the previous leg (handy when entering
    // several fills back-to-back) or defaults to right now.
    const usesPreviousEntry = typeof appSettings !== 'undefined' && appSettings.defaultOrderDate === 'previous';
    const lastLeg = draftTrade.legs[draftTrade.legs.length - 1];
    const datetime = usesPreviousEntry && lastLeg ? lastLeg.datetime : null;

    draftTrade.legs.push(makeDefaultLeg(undefined, undefined, datetime));
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
    clearTradeModalValidation();

    draftTrade.symbol = (document.getElementById('trade-modal-symbol').value || '').trim().toUpperCase();
    draftTrade.target = document.getElementById('trade-modal-target').value;
    draftTrade.stopLoss = document.getElementById('trade-modal-stoploss').value;
    draftTrade.journal = document.getElementById('trade-modal-journal').value;
    commitPendingTagInput(document.getElementById('trade-tag-input')); // catches a typed tag that wasn't Enter-committed
    delete draftTrade.tagId; // fully migrated to tagIds now

    const validLegs = draftTrade.legs.filter(leg => parseFloat(leg.quantity) > 0 && leg.price !== '' && leg.datetime);
    const symbolMissing = !draftTrade.symbol;
    const legsMissing = validLegs.length === 0;

    if (symbolMissing || legsMissing) {
        if (symbolMissing) {
            document.getElementById('trade-modal-symbol').classList.add('field-invalid');
        }
        if (legsMissing) {
            draftTrade.legs.forEach(leg => {
                if (!(parseFloat(leg.quantity) > 0)) document.getElementById(`leg-quantity-${leg.id}`)?.classList.add('field-invalid');
                if (leg.price === '' || isNaN(parseFloat(leg.price))) document.getElementById(`leg-price-${leg.id}`)?.classList.add('field-invalid');
                if (!leg.datetime) document.getElementById(`leg-datetime-${leg.id}`)?.classList.add('field-invalid');
            });
            switchTradeModalTab('general');
        }

        showTradeModalError(
            symbolMissing && legsMissing
                ? 'Enter a symbol, and fill in quantity, price and date/time for at least one action below.'
                : symbolMissing
                    ? 'Symbol is required.'
                    : 'Fill in quantity, price and date/time for at least one action below.'
        );
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
    updateSidebarBalanceDisplay();
    renderTradeLog();
    closeTradeModal();
}

// ---- Calculations: turns a trade's buy/sell legs into one summarized row ----
// Just the dollar P&L for one trade - no percentage, no account-balance lookup.
// Kept separate from computeTradeSummary so computeAccountBalance (accounts.js)
// can sum trade P&L into the balance without an infinite loop: computeTradeSummary's
// "Return on Account Balance" mode calls computeAccountBalance, which would call
// back into computeTradeSummary for every trade if it used that function instead.
function computeTradeReturnAmount(trade) {
    if (trade.forceWash) return 0; // marked as wash = breakeven, no P&L impact

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
    const directionSign = direction === 'long' ? 1 : -1;

    if (closedQty <= 0) return 0;

    // CSV-imported trades (csv-import.js) store the broker's own reported P&L
    // here, since price-diff * lots can't be turned into real dollars without
    // knowing each instrument's contract size/pip value (e.g. gold is 100oz per
    // lot) - trusting the broker's own number is more accurate than guessing.
    if (typeof trade.overrideReturnAmount === 'number') return trade.overrideReturnAmount;

    const contractSize = getContractSizeForSymbol(trade.symbol);
    return (exitPrice * closedQty - entryPrice * closedQty) * directionSign * contractSize - totalFees;
}

function computeTradeSummary(trade) {
    const legs = trade.legs.slice().sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
    const direction = legs[0].action === 'sell' ? 'short' : 'long';
    const entryAction = direction === 'long' ? 'buy' : 'sell';
    const exitAction = direction === 'long' ? 'sell' : 'buy';

    const entryLegs = legs.filter(l => l.action === entryAction);
    const exitLegs = legs.filter(l => l.action === exitAction);

    const entryQty = entryLegs.reduce((sum, l) => sum + parseFloat(l.quantity), 0);
    const exitQty = exitLegs.reduce((sum, l) => sum + parseFloat(l.quantity), 0);
    // Weighted-average PRICES (unscaled by contract size - a price is a price
    // regardless of lot size, needed as-is for Entry/Exit display and the Trade
    // Levels chart overlay).
    const entryPriceTotal = entryLegs.reduce((sum, l) => sum + parseFloat(l.quantity) * parseFloat(l.price), 0);
    const exitPriceTotal = exitLegs.reduce((sum, l) => sum + parseFloat(l.quantity) * parseFloat(l.price), 0);
    const totalFees = legs.reduce((sum, l) => sum + (parseFloat(l.fee) || 0), 0);

    const entryPrice = entryQty > 0 ? entryPriceTotal / entryQty : 0;
    const exitPrice = exitQty > 0 ? exitPriceTotal / exitQty : 0;
    const closedQty = Math.min(entryQty, exitQty);
    const remainingQty = entryQty - exitQty;

    // Dollar notional totals (EntTot/ExtTot columns, PnL) DO need the contract
    // size - a price move only equals real dollars once scaled by how much of
    // the instrument one lot actually represents (e.g. gold = 100oz/lot).
    const contractSize = getContractSizeForSymbol(trade.symbol);
    const entTot = entryPriceTotal * contractSize;
    const extTot = exitPriceTotal * contractSize;

    const directionSign = direction === 'long' ? 1 : -1;
    const closedEntryValue = entryPrice * closedQty * contractSize;
    const closedExitValue = exitPrice * closedQty * contractSize;
    let returnAmount = closedQty > 0
        ? (closedExitValue - closedEntryValue) * directionSign - totalFees
        : null;

    // CSV-imported trades (csv-import.js) store the broker's own reported P&L
    // here, since price-diff * lots can't be turned into real dollars without
    // knowing each instrument's contract size/pip value (e.g. gold is 100oz per
    // lot) - trusting the broker's own number is more accurate than guessing.
    if (typeof trade.overrideReturnAmount === 'number' && closedQty > 0) {
        returnAmount = trade.overrideReturnAmount;
    }

    // Marked as wash = treated as breakeven, not a real win/loss - zero out its
    // P&L impact everywhere (PnL totals, Balance, equity curve), not just the
    // status label.
    if (trade.forceWash && closedQty > 0) returnAmount = 0;

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

    // "Default Grid Date" setting: which date represents this trade on the
    // Dashboard/Calendar/Stats charts - its most recent action (exit) or when
    // it was originally opened. Everything downstream (sorting, calendar day
    // grouping, equity curve, hour/day-of-week stats) reads this single field.
    const usesLastAction = typeof appSettings !== 'undefined' && appSettings.defaultGridDate === 'last-action';
    const gridDate = usesLastAction ? legs[legs.length - 1].datetime : legs[0].datetime;

    return {
        id: trade.id,
        symbol: trade.symbol,
        date: gridDate,
        direction,
        status,
        tagIds: trade.tagIds || (trade.tagId ? [trade.tagId] : []),
        qty: entryQty,
        entryPrice,
        exitPrice,
        entTot,
        extTot,
        pos: remainingQty,
        holdSeconds: Math.max(0, (lastTime - firstTime) / 1000),
        returnAmount,
        returnPct,
        confidence: typeof trade.confidence === 'number' ? trade.confidence : null,
        forceWash: !!trade.forceWash
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
    const timePart = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
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
    'entTot', 'extTot', 'pos', 'holdSeconds', 'returnAmount', 'returnPct', 'confidence'
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

// ---- Per-row "..." menu: Mark/Unmark Wash, Delete Trade ----
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

    const account = getActiveAccount();
    const trade = (account.trades || []).find(t => t.id === tradeId);
    document.getElementById('trade-row-menu-wash-label').textContent = (trade && trade.forceWash) ? 'Unmark Wash' : 'Mark as Wash';

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

function handleWashToggleClick(event) {
    event.stopPropagation();
    const tradeId = document.getElementById('trade-row-menu').dataset.tradeId;
    const isCurrentlyWashed = document.getElementById('trade-row-menu-wash-label').textContent === 'Unmark Wash';
    closeTradeRowMenu();
    if (isCurrentlyWashed) unmarkTradeAsWash(tradeId);
    else markTradeAsWash(tradeId);
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
    updateSidebarBalanceDisplay();
    renderTradeLog();
}

function unmarkTradeAsWash(tradeId) {
    const account = getActiveAccount();
    const trade = (account.trades || []).find(t => t.id === tradeId);
    if (!trade) return;
    delete trade.forceWash;
    saveAccountsState();
    updateSidebarBalanceDisplay();
    renderTradeLog();
}

// ---- Delete Trade confirmation modal ----
let pendingDeleteTradeId = null;

function deleteTrade(tradeId) {
    const account = getActiveAccount();
    const trade = (account.trades || []).find(t => t.id === tradeId);
    if (!trade) return;

    pendingDeleteTradeId = tradeId;
    document.getElementById('delete-trade-modal-symbol').textContent = trade.symbol;
    document.getElementById('delete-trade-modal-overlay').style.display = 'flex';
}

function closeDeleteTradeModal() {
    document.getElementById('delete-trade-modal-overlay').style.display = 'none';
    pendingDeleteTradeId = null;
}

function confirmDeleteTrade() {
    if (!pendingDeleteTradeId) return;
    const account = getActiveAccount();
    account.trades = (account.trades || []).filter(t => t.id !== pendingDeleteTradeId);
    saveAccountsState();
    updateSidebarBalanceDisplay();
    renderTradeLog();
    closeDeleteTradeModal();
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

    const confidenceBadge = document.getElementById('trade-view-confidence');
    if (typeof trade.confidence === 'number') {
        confidenceBadge.textContent = `CONFIDENCE: ${trade.confidence}`;
        confidenceBadge.style.display = 'inline-flex';
    } else {
        confidenceBadge.style.display = 'none';
    }

    const screenshotsPanel = document.getElementById('trade-view-screenshots-panel');
    const screenshotsList = document.getElementById('trade-view-screenshots-list');
    const screenshots = trade.screenshots || [];
    if (screenshots.length > 0) {
        screenshotsList.innerHTML = screenshots.map(s => `
            <img src="${s.dataUrl}" class="trade-view-screenshot-thumb" onclick="openScreenshotLightbox(this.src)" alt="Trade screenshot">
        `).join('');
        screenshotsPanel.style.display = 'block';
    } else {
        screenshotsList.innerHTML = '';
        screenshotsPanel.style.display = 'none';
    }

    document.getElementById('trade-view-modal-overlay').style.display = 'flex';
}

function closeTradeViewModal() {
    document.getElementById('trade-view-modal-overlay').style.display = 'none';
    viewingTradeId = null;
}

// ---- Full-size screenshot viewer (Trade View's screenshots panel) ----
function openScreenshotLightbox(dataUrl) {
    document.getElementById('screenshot-lightbox-img').src = dataUrl;
    document.getElementById('screenshot-lightbox-overlay').style.display = 'flex';
}

function closeScreenshotLightbox() {
    document.getElementById('screenshot-lightbox-overlay').style.display = 'none';
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

    const tagDefs = (getActiveAccount().tagDefs) || [];
    const tagsById = new Map(tagDefs.map(t => [t.id, t.name]));
    const tagNames = (row.tagIds || []).map(id => tagsById.get(id)).filter(Boolean);
    const tagIndicator = tagNames.length > 0 ? `
        <div class="trade-tag-indicator">
            <i class="fa-solid fa-tag trade-tag-icon"></i>
            <div class="trade-tag-tooltip">
                ${tagNames.map(name => `<span class="tag-chip-static">${escapeHtml(name)}</span>`).join('')}
            </div>
        </div>` : '';

    return `
    <div class="table-row" onclick="openTradeViewModal(event,'${row.id}')">
        <div class="table-cell">${formatTradeDate(row.date)}</div>
        <div class="table-cell">${escapeHtml(row.symbol)}</div>
        <div class="table-cell"><span class="status-pill ${statusClass}">${row.status}</span></div>
        <div class="table-cell">${sideIcon}</div>
        <div class="table-cell">${row.qty}</div>
        <div class="table-cell sensitive-value">${formatPrice(row.entryPrice)}</div>
        <div class="table-cell sensitive-value">${row.exitPrice ? formatPrice(row.exitPrice) : '-'}</div>
        <div class="table-cell sensitive-value">${formatTotal(row.entTot)}</div>
        <div class="table-cell sensitive-value">${row.extTot ? formatTotal(row.extTot) : '-'}</div>
        <div class="table-cell">${row.pos > 0 ? row.pos : '-'}</div>
        <div class="table-cell">${formatHoldDuration(row.holdSeconds)}</div>
        <div class="table-cell ${returnClass}">${row.returnAmount === null ? '-' : formatTotal(row.returnAmount)}</div>
        <div class="table-cell ${returnClass}">${row.returnPct === null ? '-' : row.returnPct.toFixed(2) + '%'}</div>
        <div class="table-cell confidence-col" style="${row.confidence === null ? '' : `color:${getConfidenceColor(row.confidence)};`}">${row.confidence === null ? '-' : row.confidence}</div>
        <div class="trade-row-menu-wrap">
            ${row.forceWash ? '<i class="fa-solid fa-scale-balanced trade-wash-badge" title="Marked as Wash"></i>' : ''}
            ${tagIndicator}
            <button class="trade-row-menu-btn" onclick="toggleTradeRowMenu(event,'${row.id}')"><i class="fa-solid fa-ellipsis"></i></button>
        </div>
    </div>`;
}

function renderTradeLog() {
    const body = document.getElementById('trade-log-body');
    if (!body) return;

    const account = getActiveAccount();
    const trades = (account && account.trades) || [];

    let rows = trades
        .map(computeTradeSummary)
        .sort((a, b) => compareTradeRows(a, b, tradeSortKey, tradeSortDir));

    // Tags/Symbol/Direction/Status filter panel (filters.js) - applied here so
    // it narrows the whole dashboard view (stats cards + equity chart + table),
    // not just the table rows.
    if (typeof tradeLogFilters !== 'undefined' && typeof tradeRowMatchesFilters === 'function') {
        rows = rows.filter(row => tradeRowMatchesFilters(row, tradeLogFilters));
    }

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
let equityLabelControls = null;

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
        timeScale: { visible: true, borderColor: '#2a2e39', fixLeftEdge: true, fixRightEdge: true, rightOffset: 0 },
        // Native crosshair labels are plain canvas rectangles with no rounded-corner
        // option - hidden here in favor of custom DOM "pill" badges below.
        crosshair: {
            vertLine: { color: 'rgba(41, 121, 255, 0.5)', labelVisible: false },
            horzLine: { color: 'rgba(41, 121, 255, 0.5)', labelVisible: false }
        },
        handleScroll: false,
        handleScale: false
    });

    // Baseline series instead of a flat area fill: equity above $0 shades green,
    // below shades red, with a smooth curved line - reads like an actual
    // profit/drawdown view instead of one plain blue blob.
    equitySeriesInstance = equityChartInstance.addSeries(LightweightCharts.BaselineSeries, {
        baseValue: { type: 'price', price: 0 },
        topLineColor: '#2ebd85',
        topFillColor1: 'rgba(46, 189, 133, 0.45)',
        topFillColor2: 'rgba(46, 189, 133, 0.02)',
        bottomLineColor: '#f6465d',
        bottomFillColor1: 'rgba(246, 70, 93, 0.02)',
        bottomFillColor2: 'rgba(246, 70, 93, 0.45)',
        lineWidth: 2,
        lineType: LightweightCharts.LineType.Curved,
        // A persistent dashed line at the latest equity value - the floating
        // "$X.XX" badge that sits on top of it is custom (built below), since
        // Lightweight Charts' own last-value label can't be positioned mid-chart.
        priceLineVisible: true,
        priceLineColor: 'rgba(255, 255, 255, 0.5)',
        priceLineWidth: 1,
        priceLineStyle: LightweightCharts.LineStyle.Dashed,
        lastValueVisible: false,
        // Highlights the exact point on the curve under the cursor (color left
        // unset so it auto-matches green/red depending on which side of the
        // baseline that point falls on).
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 5,
        crosshairMarkerBorderColor: '#ffffff',
        crosshairMarkerBorderWidth: 2
    });

    equityLabelControls = attachCrosshairPillLabels(equityChartInstance, equitySeriesInstance, container, '$');

    window.addEventListener('resize', () => {
        if (equityChartInstance) equityChartInstance.resize(container.clientWidth, container.clientHeight);
    });
}

// Modern rounded "pill" crosshair labels: a price badge pinned near the top and
// a date badge pinned near the bottom, both centered on the same X position -
// positioned via the same coordinate-conversion technique as the measure tool
// and Trade Levels overlay elsewhere in this file/app.js.
//
// Two states: while hovering, both badges track the cursor's X position (the
// actual point on the curve is shown by the series' crosshairMarker dot). When
// not hovering, the price badge falls back to the latest value (set via the
// returned object's setDefaultValue), centered above that point instead.
function attachCrosshairPillLabels(chart, series, container, currencySymbol, options) {
    options = options || {};
    container.style.position = 'relative';

    // Reuse existing labels if this container already has them (e.g. the Stats
    // page equity chart fully recreates itself on every render) instead of
    // stacking duplicate elements in each time.
    let priceLabel = container.querySelector(':scope > .equity-crosshair-label.price');
    let dateLabel = container.querySelector(':scope > .equity-crosshair-label.date');
    if (!priceLabel) {
        priceLabel = document.createElement('div');
        priceLabel.className = 'equity-crosshair-label price';
        container.appendChild(priceLabel);
    }
    if (!dateLabel) {
        dateLabel = document.createElement('div');
        dateLabel.className = 'equity-crosshair-label date';
        container.appendChild(dateLabel);
    }

    // Optional: a badge pinned to the right price axis that tracks the
    // crosshair's actual price height (like the axis's own native last-value
    // badge, but following the hovered bar instead of only the latest one) -
    // opt-in since the equity chart's single top pill is enough on its own.
    let axisPriceLabel = null;
    if (options.showAxisPriceLabel) {
        axisPriceLabel = container.querySelector(':scope > .chart-axis-price-label');
        if (!axisPriceLabel) {
            axisPriceLabel = document.createElement('div');
            axisPriceLabel.className = 'chart-axis-price-label';
            container.appendChild(axisPriceLabel);
        }
    }

    let defaultPoint = null; // { time, value }

    function showDefault() {
        dateLabel.style.display = 'none';
        if (axisPriceLabel) axisPriceLabel.style.display = 'none';

        if (!defaultPoint) {
            priceLabel.style.display = 'none';
            return;
        }
        const x = chart.timeScale().timeToCoordinate(defaultPoint.time);
        if (x === null) {
            priceLabel.style.display = 'none';
            return;
        }
        priceLabel.textContent = `${currencySymbol}${defaultPoint.value.toFixed(2)}`;
        priceLabel.classList.add('current');
        // Explicitly reset right/top/bottom - an earlier version of this code set
        // them inline, and since the Stats chart reuses this same element across
        // re-renders (without a full page reload) instead of recreating it, a
        // stale inline value could otherwise keep fighting the CSS-driven position.
        priceLabel.style.left = `${x}px`;
        priceLabel.style.right = 'auto';
        priceLabel.style.top = '';
        priceLabel.style.bottom = 'auto';
        priceLabel.style.display = 'block';
    }

    chart.subscribeCrosshairMove(param => {
        if (!param.point || param.time === undefined) {
            showDefault();
            return;
        }

        // Read the actual data point's value at this bar (param.seriesData), not
        // whatever continuous price happens to sit under the mouse's exact pixel
        // (coordinateToPrice) - the label should show the real value for the day,
        // not drift as the cursor moves up/down between bars.
        const seriesPoint = param.seriesData && param.seriesData.get(series);
        const price = seriesPoint ? (seriesPoint.value !== undefined ? seriesPoint.value : seriesPoint.close) : null;
        // Snap to the bar's exact x position instead of the raw mouse pixel, so the
        // badges and vertical line line up exactly with the bar, not the cursor.
        const x = chart.timeScale().timeToCoordinate(param.time);

        if (price !== undefined && price !== null && x !== null) {
            priceLabel.textContent = `${currencySymbol}${price.toFixed(2)}`;
            priceLabel.classList.remove('current');
            priceLabel.style.left = `${x}px`;
            priceLabel.style.right = 'auto';
            priceLabel.style.top = '';
            priceLabel.style.bottom = 'auto';
            priceLabel.style.display = 'block';
        }

        if (axisPriceLabel) {
            // Uses the raw cursor pixel (not the snapped bar price above) so this
            // lines up exactly with the chart's own native horizontal crosshair
            // line, which also follows the mouse's actual Y position.
            const rawPrice = series.coordinateToPrice(param.point.y);
            if (rawPrice !== null) {
                axisPriceLabel.textContent = `${currencySymbol}${rawPrice.toFixed(2)}`;
                axisPriceLabel.style.top = `${param.point.y}px`;
                axisPriceLabel.style.display = 'block';
            } else {
                axisPriceLabel.style.display = 'none';
            }
        }

        // timeZone: 'UTC' matters here - candle/equity epochs in this app encode
        // literal wall-clock digits as if they were UTC (avoiding a double timezone
        // conversion, see loadChartInterval), and Lightweight Charts' own time axis
        // reads them the same way. Formatting in the browser's local zone instead
        // would make this label disagree with the chart's native axis labels.
        const date = new Date(param.time * 1000);
        const datePart = date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'UTC' });
        dateLabel.textContent = options.showTime
            ? `${datePart} ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}`
            : datePart;
        dateLabel.style.left = x !== null ? `${x}px` : `${param.point.x}px`;
        dateLabel.style.display = 'block';
    });

    showDefault();

    return {
        setDefaultValue(time, value) {
            defaultPoint = { time, value };
            showDefault();
        }
    };
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

    const finalData = data.length > 0 ? data : [{ time: 0, value: 0 }];
    equitySeriesInstance.setData(finalData);
    // Force the exact pixels-per-point spacing needed to span the full width,
    // rather than relying on fitContent()'s default margin/logical-range math.
    const equityContainer = document.getElementById('equity-curve-chart');
    const chartWidth = (equityContainer && equityContainer.clientWidth) || 300;
    const barSpacing = finalData.length > 1 ? chartWidth / (finalData.length - 1) : chartWidth;
    equityChartInstance.timeScale().applyOptions({ barSpacing });
    equityChartInstance.timeScale().setVisibleLogicalRange({ from: 0.5, to: finalData.length - 0.5 });
    const lastPoint = finalData[finalData.length - 1];
    if (equityLabelControls) equityLabelControls.setDefaultValue(lastPoint.time, lastPoint.value);

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
    setRingProgress('stat-wins-ring', winsPct);
    setRingProgress('stat-losses-ring', lossesPct);
    setRingProgress('stat-open-ring', openPct);
    setRingProgress('stat-wash-ring', washPct);
    setRingColorState('stat-open-ring', open.length > 0);
    setRingColorState('stat-wash-ring', wash.length > 0);

    const avgWin = wins.length > 0 ? wins.reduce((sum, r) => sum + r.returnAmount, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((sum, r) => sum + r.returnAmount, 0) / losses.length : 0;
    setText('stat-avg-win', formatTotal(avgWin));
    setText('stat-avg-loss', formatTotal(avgLoss));

    // Ring % = each one's share of (avg win magnitude + avg loss magnitude), e.g.
    // avg win $27.49 vs avg loss $19.33 -> 27.49/(27.49+19.33) = 58.71% win side.
    const avgWinAbs = Math.abs(avgWin);
    const avgLossAbs = Math.abs(avgLoss);
    const avgCombined = avgWinAbs + avgLossAbs;
    const avgWinRingPct = avgCombined > 0 ? Math.round((avgWinAbs / avgCombined) * 100) : 0;
    const avgLossRingPct = avgCombined > 0 ? Math.round((avgLossAbs / avgCombined) * 100) : 0;
    setRingProgress('stat-avg-win-ring', avgWinRingPct);
    setRingProgress('stat-avg-loss-ring', -avgLossRingPct);

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

// OPEN/WASH rings are green when there are entries, plain grey when there are none
function setRingColorState(id, hasEntries) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('ring-green', 'ring-red', 'ring-grey');
    el.classList.add(hasEntries ? 'ring-green' : 'ring-grey');
}

// Drives the real SVG radial progress ring: pct can be negative (e.g. AVG L's
// ring), the arc fill always reflects the magnitude while the label keeps the sign.
const PROGRESS_RING_CIRCUMFERENCE = 2 * Math.PI * 15.5;

function setRingProgress(id, pct) {
    const el = document.getElementById(id);
    if (!el) return;
    const circle = el.querySelector('.progress-ring-fg');
    const label = el.querySelector('.progress-ring-label');

    const clamped = Math.max(0, Math.min(100, Math.abs(pct)));
    if (circle) {
        circle.style.strokeDashoffset = String(PROGRESS_RING_CIRCUMFERENCE - (clamped / 100) * PROGRESS_RING_CIRCUMFERENCE);
    }
    if (label) {
        label.textContent = `${pct < 0 ? '-' : ''}${Math.round(clamped)}%`;
    }
}
