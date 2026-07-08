// Calendar page: month grid of daily PnL + a weekly summary rail, both built from
// the active account's real closed trades (entry date is what each day buckets on).
const CALENDAR_MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

let calendarMonth = null;
let calendarYear = null;
let calendarSelectorsBuilt = false;

function renderCalendarPage() {
    if (!document.getElementById('calendar-grid')) return;

    if (calendarMonth === null) {
        const today = new Date();
        calendarMonth = today.getMonth();
        calendarYear = today.getFullYear();
    }

    populateCalendarSelectors();
    renderCalendarGrid();
}

function populateCalendarSelectors() {
    const monthSelect = document.getElementById('calendar-month-select');
    const yearSelect = document.getElementById('calendar-year-select');
    if (!monthSelect || !yearSelect) return;

    if (!calendarSelectorsBuilt) {
        monthSelect.innerHTML = CALENDAR_MONTH_NAMES
            .map((name, i) => `<option value="${i}">${name}</option>`)
            .join('');

        const currentYear = new Date().getFullYear();
        const years = [];
        for (let y = currentYear - 5; y <= currentYear + 5; y++) years.push(y);
        yearSelect.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');

        calendarSelectorsBuilt = true;
    }

    monthSelect.value = String(calendarMonth);
    yearSelect.value = String(calendarYear);
}

function onCalendarMonthYearChange() {
    calendarMonth = parseInt(document.getElementById('calendar-month-select').value, 10);
    calendarYear = parseInt(document.getElementById('calendar-year-select').value, 10);
    renderCalendarGrid();
}

function shiftCalendarMonth(delta) {
    calendarMonth += delta;
    if (calendarMonth < 0) { calendarMonth = 11; calendarYear -= 1; }
    if (calendarMonth > 11) { calendarMonth = 0; calendarYear += 1; }
    populateCalendarSelectors();
    renderCalendarGrid();
}

function dateKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function renderCalendarGrid() {
    const grid = document.getElementById('calendar-grid');
    const summaryBody = document.getElementById('calendar-weekly-summary-body');
    if (!grid || !summaryBody) return;

    const closed = getAllTradeRows().filter(r => r.returnAmount !== null);
    const byDate = new Map();
    closed.forEach(r => {
        const key = dateKey(new Date(r.date));
        if (!byDate.has(key)) byDate.set(key, []);
        byDate.get(key).push(r);
    });

    const firstOfMonth = new Date(calendarYear, calendarMonth, 1);
    const gridStart = new Date(calendarYear, calendarMonth, 1 - firstOfMonth.getDay());

    const cells = [];
    for (let i = 0; i < 42; i++) {
        const cellDate = new Date(gridStart);
        cellDate.setDate(gridStart.getDate() + i);
        cells.push(cellDate);
    }

    grid.innerHTML = cells.map(cellDate => {
        const inMonth = cellDate.getMonth() === calendarMonth;
        const dayTrades = byDate.get(dateKey(cellDate)) || [];

        let body = '';
        if (dayTrades.length > 0) {
            const pnl = dayTrades.reduce((sum, r) => sum + r.returnAmount, 0);
            const pnlClass = pnl < 0 ? 'value-negative' : 'value-positive';
            body = `
                <div class="calendar-day-pnl ${pnlClass}">${formatTotal(pnl)}</div>
                <div class="calendar-day-count" onclick="event.stopPropagation(); openDayTradesModal('${dateKey(cellDate)}')">${dayTrades.length} Trade${dayTrades.length === 1 ? '' : 's'}</div>`;
        }

        return `
            <div class="calendar-day${inMonth ? '' : ' outside-month'}">
                <div class="calendar-day-number">${cellDate.getDate()}</div>
                ${body}
            </div>`;
    }).join('');

    summaryBody.innerHTML = '';
    for (let week = 0; week < 6; week++) {
        const weekTrades = [];
        for (let day = 0; day < 7; day++) {
            const cellDate = cells[week * 7 + day];
            const dayTrades = byDate.get(dateKey(cellDate)) || [];
            weekTrades.push(...dayTrades);
        }

        if (weekTrades.length === 0) {
            summaryBody.innerHTML += '<div class="calendar-week-card"></div>';
            continue;
        }

        const pnl = weekTrades.reduce((sum, r) => sum + r.returnAmount, 0);
        const entTot = weekTrades.reduce((sum, r) => sum + r.entTot, 0);
        const pct = entTot !== 0 ? (pnl / entTot) * 100 : 0;
        const wins = weekTrades.filter(r => r.status === 'WIN').length;
        const losses = weekTrades.filter(r => r.status === 'LOSS').length;
        const pnlClass = pnl < 0 ? 'value-negative' : 'value-positive';

        // "11 - 17 May" style label so cards stay identifiable when the
        // summary stacks below the grid on narrow screens
        const weekStart = cells[week * 7];
        const weekEnd = cells[week * 7 + 6];
        const startMonth = CALENDAR_MONTH_NAMES[weekStart.getMonth()].slice(0, 3);
        const endMonth = CALENDAR_MONTH_NAMES[weekEnd.getMonth()].slice(0, 3);
        const weekLabel = startMonth === endMonth
            ? `${weekStart.getDate()} - ${weekEnd.getDate()} ${endMonth}`
            : `${weekStart.getDate()} ${startMonth} - ${weekEnd.getDate()} ${endMonth}`;

        summaryBody.innerHTML += `
            <div class="calendar-week-card">
                <div class="calendar-week-label">${weekLabel}</div>
                <div class="calendar-week-pnl ${pnlClass}">${formatTotal(pnl)}</div>
                <div class="calendar-week-pct ${pnlClass}">${pct.toFixed(2)}%</div>
                <div class="calendar-week-badges">
                    <span class="calendar-week-badge win">${wins}</span>
                    <span class="calendar-week-badge loss">${losses}</span>
                </div>
            </div>`;
    }
}

// ---- Day Trades modal: lists every trade entered on a given date, click one to view it ----
function openDayTradesModal(key) {
    const [y, m, d] = key.split('-').map(Number);
    const date = new Date(y, m - 1, d);

    const dayTrades = getAllTradeRows()
        .filter(r => r.returnAmount !== null && dateKey(new Date(r.date)) === key);

    const title = date.toLocaleDateString(undefined, {
        weekday: 'short', month: 'long', day: 'numeric', year: 'numeric'
    });
    document.getElementById('day-trades-modal-title').textContent = `Trades - ${title}`;

    document.getElementById('day-trades-list').innerHTML = dayTrades.map(row => {
        const sideIcon = row.direction === 'long'
            ? '<i class="fa-solid fa-arrow-trend-up" style="color:#2ebd85;"></i>'
            : '<i class="fa-solid fa-arrow-trend-down" style="color:#f6465d;"></i>';
        const returnClass = row.returnAmount < 0 ? 'value-negative' : 'value-positive';

        return `
            <div class="day-trade-row" onclick="openDayTradeFromList('${row.id}')">
                <span class="day-trade-symbol">${escapeHtml(row.symbol)}</span>
                <span class="day-trade-side">${sideIcon}</span>
                <span class="day-trade-qty">${row.qty}</span>
                <span class="day-trade-return ${returnClass}">${formatTotal(row.returnAmount)} (${row.returnPct.toFixed(2)}%)</span>
            </div>`;
    }).join('');

    document.getElementById('day-trades-modal-overlay').style.display = 'flex';
}

function closeDayTradesModal() {
    document.getElementById('day-trades-modal-overlay').style.display = 'none';
}

function openDayTradeFromList(tradeId) {
    closeDayTradesModal();
    openTradeViewModal(null, tradeId);
}
