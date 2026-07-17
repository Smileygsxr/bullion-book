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
    syncHolidayToggleButton();
    renderCalendarGrid();
}

// ---- National holidays overlay ----
// Two calendars a gold/forex trader here cares about: South African public
// holidays (ZA - the user's own non-trading days) and US market holidays
// (US - NYSE/COMEX closures that thin out gold and forex liquidity).
// Computed algorithmically for any year - no API, works offline like the
// rest of the app.
const CALENDAR_HOLIDAYS_STORAGE_KEY = 'bb_show_holidays';
let showHolidayCalendar = false;
try { showHolidayCalendar = localStorage.getItem(CALENDAR_HOLIDAYS_STORAGE_KEY) === '1'; } catch (e) { /* ignore */ }

function toggleHolidayCalendar() {
    showHolidayCalendar = !showHolidayCalendar;
    try { localStorage.setItem(CALENDAR_HOLIDAYS_STORAGE_KEY, showHolidayCalendar ? '1' : '0'); } catch (e) { /* ignore */ }
    syncHolidayToggleButton();
    renderCalendarGrid();
}

function syncHolidayToggleButton() {
    const btn = document.getElementById('holiday-calendar-toggle');
    if (btn) btn.classList.toggle('active', showHolidayCalendar);
}

// Easter Sunday for a given year (anonymous Gregorian algorithm) - anchors
// Good Friday and Family Day/Easter Monday for both countries.
function easterSunday(year) {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
}

// e.g. (2026, 0, 1, 3) = 3rd Monday of January 2026 (month/weekday 0-based, Sun=0)
function nthWeekdayOfMonth(year, month, weekday, n) {
    const first = new Date(year, month, 1);
    const offset = (weekday - first.getDay() + 7) % 7;
    return new Date(year, month, 1 + offset + (n - 1) * 7);
}

function lastWeekdayOfMonth(year, month, weekday) {
    const last = new Date(year, month + 1, 0);
    const offset = (last.getDay() - weekday + 7) % 7;
    return new Date(year, month, last.getDate() - offset);
}

const holidaysByYearCache = new Map(); // year -> Map(dateKey -> [{country, name}])

function buildHolidaysForYear(year) {
    const map = new Map();
    const add = (date, country, name) => {
        const key = dateKey(date);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push({ country, name });
    };

    const easter = easterSunday(year);
    const goodFriday = new Date(year, easter.getMonth(), easter.getDate() - 2);
    const easterMonday = new Date(year, easter.getMonth(), easter.getDate() + 1);

    // South African public holidays (Public Holidays Act): one falling on a
    // Sunday makes the following Monday a public holiday too.
    [
        [new Date(year, 0, 1), 'New Year\'s Day'],
        [new Date(year, 2, 21), 'Human Rights Day'],
        [goodFriday, 'Good Friday'],
        [easterMonday, 'Family Day'],
        [new Date(year, 3, 27), 'Freedom Day'],
        [new Date(year, 4, 1), 'Workers\' Day'],
        [new Date(year, 5, 16), 'Youth Day'],
        [new Date(year, 7, 9), 'National Women\'s Day'],
        [new Date(year, 8, 24), 'Heritage Day'],
        [new Date(year, 11, 16), 'Day of Reconciliation'],
        [new Date(year, 11, 25), 'Christmas Day'],
        [new Date(year, 11, 26), 'Day of Goodwill']
    ].forEach(([date, name]) => {
        add(date, 'ZA', name);
        if (date.getDay() === 0) add(new Date(year, date.getMonth(), date.getDate() + 1), 'ZA', `${name} (observed)`);
    });

    // US market holidays (NYSE/COMEX closure days). Fixed-date ones move to
    // the nearest weekday when they land on a weekend: Sat -> Friday before,
    // Sun -> Monday after - except New Year's, which NYSE never observes on
    // Dec 31 of the prior year (Sunday -> Monday only).
    const shiftUs = (date, name) => {
        if (date.getDay() === 6) return [new Date(year, date.getMonth(), date.getDate() - 1), `${name} (observed)`];
        if (date.getDay() === 0) return [new Date(year, date.getMonth(), date.getDate() + 1), `${name} (observed)`];
        return [date, name];
    };
    const newYear = new Date(year, 0, 1);
    [
        newYear.getDay() === 0 ? [new Date(year, 0, 2), 'New Year\'s Day (observed)'] : [newYear, 'New Year\'s Day'],
        [nthWeekdayOfMonth(year, 0, 1, 3), 'Martin Luther King Jr. Day'],
        [nthWeekdayOfMonth(year, 1, 1, 3), 'Presidents\' Day'],
        [goodFriday, 'Good Friday'],
        [lastWeekdayOfMonth(year, 4, 1), 'Memorial Day'],
        shiftUs(new Date(year, 5, 19), 'Juneteenth'),
        shiftUs(new Date(year, 6, 4), 'Independence Day'),
        [nthWeekdayOfMonth(year, 8, 1, 1), 'Labor Day'],
        [nthWeekdayOfMonth(year, 10, 4, 4), 'Thanksgiving Day'],
        shiftUs(new Date(year, 11, 25), 'Christmas Day')
    ].forEach(([date, name]) => add(date, 'US', name));

    return map;
}

function getHolidaysForDate(date) {
    const year = date.getFullYear();
    if (!holidaysByYearCache.has(year)) holidaysByYearCache.set(year, buildHolidaysForYear(year));
    return holidaysByYearCache.get(year).get(dateKey(date)) || [];
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

        const holidays = showHolidayCalendar ? getHolidaysForDate(cellDate) : [];
        const holidayHtml = holidays.map(h => `
            <div class="calendar-holiday" title="${escapeHtml(`${h.country === 'ZA' ? 'South African public holiday' : 'US market holiday'}: ${h.name}`)}">
                <span class="calendar-holiday-tag ${h.country.toLowerCase()}">${h.country}</span>
                <span class="calendar-holiday-name">${escapeHtml(h.name)}</span>
            </div>`).join('');

        return `
            <div class="calendar-day${inMonth ? '' : ' outside-month'}">
                <div class="calendar-day-number">${cellDate.getDate()}</div>
                ${body}
                ${holidayHtml}
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
