// Broker CSV import (Settings > Import Trades). Parses a closed-trades export
// (e.g. Exness/MT4/MT5 trading history report) and turns each row into a trade
// with two legs (open + close), using the same trade model as the New Trade
// modal (trades.js) so it flows through the exact same P&L/stats calculations.
//
// Re-uploading replaces only the trades from the previous import (tagged with
// source: 'csv-import') - trades added manually through the New Trade modal are
// never touched.

// Recognized header name variants per broker/report format - both header and
// candidate strings are run through normalizeHeaderText (lowercased, spaces/
// underscores stripped) before comparing, so "Open Time", "open_time_utc" and
// "opening_time_utc" all resolve the same way. Exact matches are tried first,
// then "contains" as a fallback, since exports differ between the MT4/MT5
// terminal report and broker web/personal-area exports (Exness's own export
// uses ticket/opening_time_utc/closing_time_utc/type/lots/symbol/opening_price/
// closing_price/stop_loss/take_profit/commission/swap/profit).
const CSV_COLUMN_CANDIDATES = {
    symbol: ['symbol', 'item', 'instrument', 'pair'],
    type: ['type', 'direction', 'side'],
    volume: ['lots', 'volume', 'size', 'quantity'],
    openTime: ['opening time utc', 'open time', 'opentime', 'time open', 'open date'],
    closeTime: ['closing time utc', 'close time', 'closetime', 'time close', 'close date'],
    openPrice: ['opening price', 'open price', 'price open', 'entry price'],
    closePrice: ['closing price', 'close price', 'price close', 'exit price'],
    commission: ['commission', 'comm'],
    swap: ['swap'],
    profit: ['profit', 'pnl', 'p/l', 'p l'],
    stopLoss: ['stop loss', 'sl'],
    takeProfit: ['take profit', 'tp'],
    ticket: ['ticket', 'order', 'deal', 'position id']
};

// These are nice-to-have, not required for a row to import as a trade.
const CSV_OPTIONAL_COLUMNS = ['commission', 'swap', 'profit', 'stopLoss', 'takeProfit', 'ticket'];

// The "CSV Timezone" setting is a direct hour offset: the chosen number of hours
// is ADDED to the raw CSV time as-is (e.g. a GMT+0/UTC export needs "+2" selected
// to match the chart data, which is always Africa/Johannesburg/GMT+2 - see
// scripts/fetch_daily_gold_data.py - so a raw 13:00 becomes 15:00).

function normalizeHeaderText(s) {
    return s.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findCsvHeaderKey(fields, candidates) {
    const normalizedFields = fields.map(f => ({ original: f, norm: normalizeHeaderText(f) }));
    const normalizedCandidates = candidates.map(normalizeHeaderText);

    for (const candidate of normalizedCandidates) {
        const exact = normalizedFields.find(f => f.norm === candidate);
        if (exact) return exact.original;
    }
    for (const candidate of normalizedCandidates) {
        const partial = normalizedFields.find(f => f.norm.includes(candidate));
        if (partial) return partial.original;
    }
    return null;
}

// Handles the common broker datetime formats: "2026.06.30 14:23:11",
// "2026-06-30 14:23", "30.06.2026 14:23" (day-first), with '.', '-', '/'
// separators and an optional seconds component - normalizes to the
// "YYYY-MM-DDTHH:MM" format the rest of the app's leg.datetime fields use.
function parseBrokerDatetime(raw) {
    if (!raw) return null;
    const match = String(raw).trim().match(/^(\d{1,4})[.\-\/](\d{1,2})[.\-\/](\d{1,4})[ T](\d{1,2}):(\d{2})/);
    if (!match) return null;

    const [, a, b, c, hh, mm] = match;
    let year, month, day;
    if (a.length === 4) { year = a; month = b; day = c; }
    else if (c.length === 4) { year = c; month = b; day = a; }
    else return null;

    const pad = n => String(n).padStart(2, '0');
    return `${year}-${pad(month)}-${pad(day)}T${pad(hh)}:${pad(mm)}`;
}

// Shifts a "YYYY-MM-DDTHH:MM" wall-clock string by a whole number of hours,
// without ever touching the browser's own local timezone/DST - Date.UTC()/
// getUTC*() just do pure calendar arithmetic on the numbers we hand it.
function shiftDatetimeByHours(datetimeStr, hours) {
    if (!datetimeStr || !hours) return datetimeStr;

    const [datePart, timePart] = datetimeStr.split('T');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hh, mm] = timePart.split(':').map(Number);

    const shifted = new Date(Date.UTC(year, month - 1, day, hh, mm) + hours * 3600000);
    const pad = n => String(n).padStart(2, '0');
    return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

function parseBrokerNumber(raw) {
    if (raw === undefined || raw === null) return 0;
    const cleaned = String(raw).replace(/[^0-9.\-]/g, '');
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
}

// ---- CSV source timezone setting (per-account, since different brokers use
// different server times) - the app always converts imported times to GMT+2 to
// match the chart data (see CHART_DISPLAY_GMT_OFFSET above). Uses a custom
// dropdown rather than a native <select> - a native dropdown's popup list is
// rendered by the OS, not the page, so its scrollbar can't be styled/hidden.
function populateCsvTimezoneOptions() {
    const list = document.getElementById('csv-timezone-dropdown-list');
    if (!list || list.dataset.populated) return;
    list.dataset.populated = 'true';

    let html = '';
    for (let offset = 14; offset >= -12; offset--) {
        html += `<div class="custom-select-option" data-offset="${offset}" onclick="selectCsvTimezoneOffset(${offset})">${offset >= 0 ? '+' : ''}${offset} hour${Math.abs(offset) === 1 ? '' : 's'}</div>`;
    }
    list.innerHTML = html;
}

function toggleCsvTimezoneDropdown() {
    populateCsvTimezoneOptions();
    const list = document.getElementById('csv-timezone-dropdown-list');
    if (!list) return;
    list.style.display = list.style.display === 'none' ? 'block' : 'none';
}

// Changing the dropdown doesn't just affect future imports - it retroactively
// re-shifts every already-imported trade's times too, so the whole site (Trade
// View, charts, stats) updates immediately without needing to re-upload the CSV.
// account.csvTimezoneOffset always reflects the offset hours already added to
// the CURRENTLY stored times, so: storedTime = rawCsvTime + oldOffset, and the
// desired newStoredTime = rawCsvTime + newOffset, meaning the correction to
// apply to what's already stored is just newOffset - oldOffset.
function retimezoneCsvImportedTrades(newOffset) {
    const account = getActiveAccount();
    const oldOffset = typeof account.csvTimezoneOffset === 'number' ? account.csvTimezoneOffset : 0;
    const delta = newOffset - oldOffset;

    account.csvTimezoneOffset = newOffset;

    if (delta !== 0) {
        (account.trades || []).forEach(trade => {
            if (trade.source !== 'csv-import') return;
            trade.legs.forEach(leg => { leg.datetime = shiftDatetimeByHours(leg.datetime, delta); });
        });
    }

    saveAccountsState();
    updateSidebarBalanceDisplay();
    if (typeof renderTradeLog === 'function') renderTradeLog();
    if (typeof renderStatsPage === 'function') renderStatsPage();
}

function selectCsvTimezoneOffset(offset) {
    retimezoneCsvImportedTrades(offset);
    syncCsvTimezoneSelect();

    const list = document.getElementById('csv-timezone-dropdown-list');
    if (list) list.style.display = 'none';

    showCsvImportStatus(`Shifted all imported trade times by ${offset >= 0 ? '+' : ''}${offset} hours.`, false);
}

function syncCsvTimezoneSelect() {
    populateCsvTimezoneOptions();
    const account = getActiveAccount();
    const offset = typeof account.csvTimezoneOffset === 'number' ? account.csvTimezoneOffset : 0;

    const label = document.getElementById('csv-timezone-dropdown-label');
    if (label) label.textContent = `${offset >= 0 ? '+' : ''}${offset} hour${Math.abs(offset) === 1 ? '' : 's'}`;

    document.querySelectorAll('#csv-timezone-dropdown-list .custom-select-option').forEach(opt => {
        opt.classList.toggle('active', parseInt(opt.dataset.offset, 10) === offset);
    });
}

document.addEventListener('click', event => {
    const dropdown = document.getElementById('csv-timezone-dropdown');
    const list = document.getElementById('csv-timezone-dropdown-list');
    if (!dropdown || !list || list.style.display === 'none') return;
    if (!dropdown.contains(event.target)) list.style.display = 'none';
});

function handleTradeCsvFileChange(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => importTradesFromCsvText(reader.result, file.name);
    reader.readAsText(file);

    event.target.value = ''; // allow re-selecting the same filename later
}

function importTradesFromCsvText(csvText, filename) {
    const parsed = Papa.parse(csvText.trim(), { header: true, skipEmptyLines: true });

    if (!parsed.meta.fields || parsed.meta.fields.length === 0) {
        showCsvImportStatus('Could not read any columns from that file.', true);
        return;
    }

    const fields = parsed.meta.fields;
    const columns = {};
    const missing = [];
    Object.entries(CSV_COLUMN_CANDIDATES).forEach(([key, candidates]) => {
        const found = findCsvHeaderKey(fields, candidates);
        if (found) columns[key] = found;
        else if (!CSV_OPTIONAL_COLUMNS.includes(key)) missing.push(key);
    });

    if (missing.length > 0) {
        showCsvImportStatus(
            `Couldn't find these required columns: ${missing.join(', ')}. Columns found in file: ${fields.join(', ')}`,
            true
        );
        return;
    }

    const account = getActiveAccount();
    // Directly the number of hours added to each raw CSV time (see the
    // CSV_OPTIONAL_COLUMNS comment above) - e.g. a GMT+0/UTC export needs +2
    // selected here to land on GMT+2 to match the chart data.
    const shiftHours = typeof account.csvTimezoneOffset === 'number' ? account.csvTimezoneOffset : 0;

    // A previous import's tags/journal/wash-flag are carried over onto the same
    // trade next time, matched by the broker's own ticket number (falling back to
    // a symbol+time+volume key if the file has no ticket column) - only the
    // factual broker data (prices, times, P&L) gets refreshed on re-upload.
    const previousByKey = new Map();
    (account.trades || []).forEach(t => {
        if (t.source === 'csv-import' && t.csvRowKey) {
            previousByKey.set(t.csvRowKey, { tagIds: t.tagIds || [], journal: t.journal || '', forceWash: !!t.forceWash });
        }
    });

    const importedTrades = [];
    parsed.data.forEach(row => {
        const typeRaw = (row[columns.type] || '').trim().toLowerCase();
        if (typeRaw !== 'buy' && typeRaw !== 'sell') return; // skip pending orders/balance rows/etc.

        const symbol = (row[columns.symbol] || '').trim().toUpperCase();
        let openTime = parseBrokerDatetime(row[columns.openTime]);
        let closeTime = parseBrokerDatetime(row[columns.closeTime]);
        const volume = parseBrokerNumber(row[columns.volume]);
        const openPrice = parseBrokerNumber(row[columns.openPrice]);
        const closePrice = parseBrokerNumber(row[columns.closePrice]);
        // Raw signed values (not abs) - commission is usually already negative in
        // broker reports, swap can go either way, and summing them with profit
        // gives the true net result of the trade.
        const commission = columns.commission ? parseBrokerNumber(row[columns.commission]) : 0;
        const swap = columns.swap ? parseBrokerNumber(row[columns.swap]) : 0;
        const profit = columns.profit ? parseBrokerNumber(row[columns.profit]) : null;
        const stopLossRaw = columns.stopLoss ? (row[columns.stopLoss] || '').trim() : '';
        const takeProfitRaw = columns.takeProfit ? (row[columns.takeProfit] || '').trim() : '';
        const stopLoss = stopLossRaw ? String(parseBrokerNumber(stopLossRaw)) : '';
        const target = takeProfitRaw ? String(parseBrokerNumber(takeProfitRaw)) : '';
        const ticket = columns.ticket ? (row[columns.ticket] || '').trim() : '';

        if (!symbol || !openTime || !closeTime || volume <= 0 || openPrice <= 0 || closePrice <= 0) return;

        const dedupKey = ticket || `${symbol}|${openTime}|${closeTime}|${volume}`;

        openTime = shiftDatetimeByHours(openTime, shiftHours);
        closeTime = shiftDatetimeByHours(closeTime, shiftHours);

        const exitAction = typeRaw === 'buy' ? 'sell' : 'buy';

        const trade = {
            id: genTradeId(),
            symbol,
            target,
            stopLoss,
            journal: '',
            tagIds: [],
            source: 'csv-import',
            csvRowKey: dedupKey,
            legs: [
                { id: genTradeId(), action: typeRaw, datetime: openTime, quantity: volume, price: openPrice, fee: 0 },
                { id: genTradeId(), action: exitAction, datetime: closeTime, quantity: volume, price: closePrice, fee: 0 }
            ]
        };

        // Trust the broker's own reported P&L rather than recomputing it from
        // price movement * lots, since that math needs each instrument's contract
        // size/pip value (e.g. gold = 100oz/lot) which this app doesn't model -
        // see computeTradeReturnAmount/computeTradeSummary in trades.js.
        if (profit !== null) {
            trade.overrideReturnAmount = profit + commission + swap;
        }

        const previous = previousByKey.get(dedupKey);
        if (previous) {
            trade.tagIds = previous.tagIds;
            trade.journal = previous.journal;
            trade.forceWash = previous.forceWash;
        }

        importedTrades.push(trade);
    });

    if (importedTrades.length === 0) {
        showCsvImportStatus('No closed buy/sell trades were found in that file.', true);
        return;
    }

    if (!account.trades) account.trades = [];

    // Replace whatever was imported last time - trades added manually (no
    // source: 'csv-import' marker) are left untouched.
    account.trades = account.trades.filter(t => t.source !== 'csv-import');
    account.trades.push(...importedTrades);
    account.csvImportMeta = { filename, importedAt: new Date().toISOString(), tradeCount: importedTrades.length };

    saveAccountsState();
    updateSidebarBalanceDisplay();
    if (typeof renderTradeLog === 'function') renderTradeLog();
    if (typeof renderStatsPage === 'function') renderStatsPage();

    showCsvImportStatus(`Imported ${importedTrades.length} trades from "${filename}".`, false);
    renderCsvImportMeta();
}

function removeCsvImportedTrades() {
    const account = getActiveAccount();
    const before = (account.trades || []).length;
    account.trades = (account.trades || []).filter(t => t.source !== 'csv-import');
    const removed = before - account.trades.length;
    delete account.csvImportMeta;

    saveAccountsState();
    updateSidebarBalanceDisplay();
    if (typeof renderTradeLog === 'function') renderTradeLog();
    if (typeof renderStatsPage === 'function') renderStatsPage();

    renderCsvImportMeta();
    showCsvImportStatus(`Removed ${removed} imported trade${removed === 1 ? '' : 's'}.`, false);
}

function showCsvImportStatus(message, isError) {
    const el = document.getElementById('csv-import-status');
    if (!el) return;
    el.textContent = message;
    el.className = `settings-status ${isError ? 'error' : 'success'}`;
}

function renderCsvImportMeta() {
    syncCsvTimezoneSelect();

    const el = document.getElementById('csv-import-last-info');
    if (!el) return;

    const meta = getActiveAccount().csvImportMeta;
    if (!meta) {
        el.textContent = 'No CSV has been imported yet.';
        return;
    }

    const when = new Date(meta.importedAt).toLocaleString();
    el.textContent = `"${meta.filename}" - ${meta.tradeCount} trades - ${when}`;
}
