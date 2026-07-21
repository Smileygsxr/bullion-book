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
// Nine calendars a gold/forex trader here cares about: South Africa (the
// user's own non-trading days) plus the US and every major FX-pair country
// (EUR/GBP/JPY/CHF/AUD/CAD/NZD side) - each one's public holidays tend to
// thin liquidity and widen spreads in that currency. Computed algorithmically
// for any year - no API, works offline like the rest of the app.
const CALENDAR_HOLIDAYS_STORAGE_KEY = 'bb_show_holidays';
let showHolidayCalendar = false;
try { showHolidayCalendar = localStorage.getItem(CALENDAR_HOLIDAYS_STORAGE_KEY) === '1'; } catch (e) { /* ignore */ }

// Order mirrors CHART_SYMBOLS' major-pair ordering (app.js) minus USD, with
// ZA/US first since those are the original two / the user's home market.
const HOLIDAY_COUNTRIES = [
    { code: 'ZA', flag: '🇿🇦', label: 'South Africa', tooltipLabel: 'South African public holiday' },
    { code: 'US', flag: '🇺🇸', label: 'United States', tooltipLabel: 'US market holiday' },
    { code: 'EU', flag: '🇪🇺', label: 'Eurozone', tooltipLabel: 'Eurozone (ECB/TARGET2) holiday' },
    { code: 'GB', flag: '🇬🇧', label: 'United Kingdom', tooltipLabel: 'UK bank holiday' },
    { code: 'JP', flag: '🇯🇵', label: 'Japan', tooltipLabel: 'Japanese public holiday' },
    { code: 'CH', flag: '🇨🇭', label: 'Switzerland', tooltipLabel: 'Swiss public holiday' },
    { code: 'AU', flag: '🇦🇺', label: 'Australia', tooltipLabel: 'Australian public holiday' },
    { code: 'CA', flag: '🇨🇦', label: 'Canada', tooltipLabel: 'Canadian public holiday' },
    { code: 'NZ', flag: '🇳🇿', label: 'New Zealand', tooltipLabel: 'New Zealand public holiday' }
];

const HOLIDAY_COUNTRIES_STORAGE_KEY = 'bb_holiday_countries';
let enabledHolidayCountries = new Set(HOLIDAY_COUNTRIES.map(c => c.code));
try {
    const savedCountries = JSON.parse(localStorage.getItem(HOLIDAY_COUNTRIES_STORAGE_KEY));
    if (Array.isArray(savedCountries)) enabledHolidayCountries = new Set(savedCountries);
} catch (e) { /* ignore corrupt data */ }

function saveEnabledHolidayCountries() {
    try { localStorage.setItem(HOLIDAY_COUNTRIES_STORAGE_KEY, JSON.stringify(Array.from(enabledHolidayCountries))); } catch (e) { /* ignore */ }
}

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

// ---- Country filter popover ----
function toggleHolidayFilterPopover(event) {
    event.stopPropagation();
    const popover = document.getElementById('calendar-holiday-filter-popover');
    if (!popover) return;
    const opening = popover.style.display !== 'block';
    if (opening) renderHolidayFilterList();
    popover.style.display = opening ? 'block' : 'none';
    document.getElementById('calendar-holiday-filter-btn').classList.toggle('active', opening);
}

function closeHolidayFilterPopover() {
    const popover = document.getElementById('calendar-holiday-filter-popover');
    if (popover) popover.style.display = 'none';
    const btn = document.getElementById('calendar-holiday-filter-btn');
    if (btn) btn.classList.remove('active');
}

document.addEventListener('click', event => {
    const popover = document.getElementById('calendar-holiday-filter-popover');
    if (!popover || popover.style.display !== 'block') return;
    if (popover.contains(event.target) || event.target.closest('#calendar-holiday-filter-btn')) return;
    closeHolidayFilterPopover();
});

function renderHolidayFilterList() {
    const list = document.getElementById('calendar-holiday-filter-list');
    if (!list) return;
    list.innerHTML = HOLIDAY_COUNTRIES.map(c => `
        <label class="calendar-holiday-filter-item">
            <input type="checkbox" ${enabledHolidayCountries.has(c.code) ? 'checked' : ''} onchange="setHolidayCountryEnabled('${c.code}', this.checked)">
            <span>${c.flag} ${c.label}</span>
        </label>`).join('');
}

function setHolidayCountryEnabled(code, enabled) {
    if (enabled) enabledHolidayCountries.add(code);
    else enabledHolidayCountries.delete(code);
    saveEnabledHolidayCountries();
    renderCalendarGrid();
}

function setAllHolidayCountries(enabled) {
    enabledHolidayCountries = enabled ? new Set(HOLIDAY_COUNTRIES.map(c => c.code)) : new Set();
    saveEnabledHolidayCountries();
    renderHolidayFilterList();
    renderCalendarGrid();
}

// Easter Sunday for a given year (anonymous Gregorian algorithm) - anchors
// Good Friday/Easter Monday (and, for Switzerland, Ascension/Whit Monday)
// across every country below that observes it.
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

function addDays(date, n) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
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

// UK/AU/NZ-style "Mondayisation": a fixed-date holiday landing on a weekend
// shifts to the following Monday.
function mondayise(date) {
    const day = date.getDay();
    if (day === 6) return addDays(date, 2);
    if (day === 0) return addDays(date, 1);
    return date;
}

// For an adjacent pair (Christmas + Boxing Day, NZ's New Year pair): whichever
// date is ALREADY on a weekday keeps that exact slot first; only the one
// actually landing on a weekend has to walk forward (Monday, or Tuesday if
// Monday's already claimed). Processing order matters - e.g. for NZ 2023
// (New Year's Day = Sun Jan 1, Day-after = Mon Jan 2), Day-after has first
// claim on Monday since it was never going to move, so New Year's Day is the
// one pushed to Tuesday - matching the real published outcome. A naive
// "shift both independently, bump the second on collision" gets this
// backwards, since New Year's Day would grab Monday first purely by being
// listed first.
function mondayisePair(dateA, dateB) {
    const isWeekend = d => d.getDay() === 0 || d.getDay() === 6;
    const occupied = new Set();
    if (!isWeekend(dateA)) occupied.add(dateA.getTime());
    if (!isWeekend(dateB)) occupied.add(dateB.getTime());

    const resolve = date => {
        if (!isWeekend(date)) return date;
        let candidate = mondayise(date);
        while (occupied.has(candidate.getTime())) candidate = addDays(candidate, 1);
        occupied.add(candidate.getTime());
        return candidate;
    };

    return [resolve(dateA), resolve(dateB)];
}

// Japan's astronomically-defined equinox holidays - the standard approximation
// formula (valid 1980-2099) used to predict them years ahead, since the
// government only confirms the exact date officially about a year prior.
function japanEquinoxDay(year, isAutumn) {
    const base = isAutumn ? 23.2488 : 20.8431;
    const day = Math.floor(base + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
    return new Date(year, isAutumn ? 8 : 2, day);
}

// Japan's furikae kyūjitsu (substitute holiday): a fixed-date holiday on a
// SUNDAY (not Saturday - Japan has no Saturday-shift rule) is observed the
// next day that isn't already a holiday itself. Walking forward (rather than
// assuming Monday) correctly handles the early-May stretch, where Monday can
// already be taken by Children's Day.
function japanSubstituteDate(baseDate, occupiedKeys) {
    let d = addDays(baseDate, 1);
    while (occupiedKeys.has(dateKey(d))) d = addDays(d, 1);
    return d;
}

const holidaysByYearCache = new Map(); // year -> Map(dateKey -> [{country, name}])

function buildHolidaysForYear(year) {
    const map = new Map();
    const add = (date, country, name) => {
        const key = dateKey(date);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push({ country, name });
    };
    // For countries whose shift only matters when it changed the date -
    // avoids tagging "(observed)" on a holiday that never actually moved.
    const addMondayised = (date, country, name) => {
        const shifted = mondayise(date);
        add(shifted, country, shifted.getTime() === date.getTime() ? name : `${name} (observed)`);
    };
    const addMondayisedPair = (country, dateA, nameA, dateB, nameB) => {
        const [a, b] = mondayisePair(dateA, dateB);
        add(a, country, a.getTime() === dateA.getTime() ? nameA : `${nameA} (observed)`);
        add(b, country, b.getTime() === dateB.getTime() ? nameB : `${nameB} (observed)`);
    };

    const easter = easterSunday(year);
    const goodFriday = addDays(easter, -2);
    const easterMonday = addDays(easter, 1);

    // ---- South Africa (Public Holidays Act): a holiday on a Sunday makes
    // the following Monday a public holiday too. ----
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
        if (date.getDay() === 0) add(addDays(date, 1), 'ZA', `${name} (observed)`);
    });

    // ---- United States (NYSE/COMEX closure days). Sat -> Friday before,
    // Sun -> Monday after - except New Year's, which never shifts onto
    // Dec 31 of the prior year (Sunday -> Monday only). ----
    const shiftUs = (date, name) => {
        if (date.getDay() === 6) return [addDays(date, -1), `${name} (observed)`];
        if (date.getDay() === 0) return [addDays(date, 1), `${name} (observed)`];
        return [date, name];
    };
    const newYearUs = new Date(year, 0, 1);
    [
        newYearUs.getDay() === 0 ? [new Date(year, 0, 2), 'New Year\'s Day (observed)'] : [newYearUs, 'New Year\'s Day'],
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

    // ---- Eurozone (ECB TARGET2 closure days) - the official list is
    // exactly these 6, with no weekend-shift rule at all. ----
    [
        [new Date(year, 0, 1), 'New Year\'s Day'],
        [goodFriday, 'Good Friday'],
        [easterMonday, 'Easter Monday'],
        [new Date(year, 4, 1), 'Labour Day'],
        [new Date(year, 11, 25), 'Christmas Day'],
        [new Date(year, 11, 26), 'Boxing Day']
    ].forEach(([date, name]) => add(date, 'EU', name));

    // ---- United Kingdom (bank holidays - Banking and Financial Dealings
    // Act substitute-day convention). ----
    addMondayised(new Date(year, 0, 1), 'GB', 'New Year\'s Day');
    add(goodFriday, 'GB', 'Good Friday');
    add(easterMonday, 'GB', 'Easter Monday');
    add(nthWeekdayOfMonth(year, 4, 1, 1), 'GB', 'Early May Bank Holiday');
    add(lastWeekdayOfMonth(year, 4, 1), 'GB', 'Spring Bank Holiday');
    add(lastWeekdayOfMonth(year, 7, 1), 'GB', 'Summer Bank Holiday');
    addMondayisedPair('GB', new Date(year, 11, 25), 'Christmas Day', new Date(year, 11, 26), 'Boxing Day');

    // ---- Japan - two passes: fixed-date + weekday-rule holidays first, then
    // Sunday substitutes computed against that combined set. ----
    const jpFixed = [
        [new Date(year, 0, 1), 'New Year\'s Day'],
        [new Date(year, 1, 11), 'National Foundation Day'],
        [new Date(year, 1, 23), 'Emperor\'s Birthday'],
        [japanEquinoxDay(year, false), 'Vernal Equinox Day'],
        [new Date(year, 3, 29), 'Showa Day'],
        [new Date(year, 4, 3), 'Constitution Memorial Day'],
        [new Date(year, 4, 4), 'Greenery Day'],
        [new Date(year, 4, 5), 'Children\'s Day'],
        [new Date(year, 7, 11), 'Mountain Day'],
        [japanEquinoxDay(year, true), 'Autumnal Equinox Day'],
        [new Date(year, 10, 3), 'Culture Day'],
        [new Date(year, 10, 23), 'Labour Thanksgiving Day']
    ];
    const jpWeekdayRule = [
        [nthWeekdayOfMonth(year, 0, 1, 2), 'Coming of Age Day'],
        [nthWeekdayOfMonth(year, 6, 1, 3), 'Marine Day'],
        [nthWeekdayOfMonth(year, 8, 1, 3), 'Respect for the Aged Day'],
        [nthWeekdayOfMonth(year, 9, 1, 2), 'Sports Day']
    ];
    const jpOccupied = new Set([...jpFixed, ...jpWeekdayRule].map(([d]) => dateKey(d)));
    [...jpFixed, ...jpWeekdayRule].forEach(([date, name]) => add(date, 'JP', name));
    jpFixed.forEach(([date, name]) => {
        if (date.getDay() === 0) {
            const sub = japanSubstituteDate(date, jpOccupied);
            add(sub, 'JP', `${name} (observed)`);
            jpOccupied.add(dateKey(sub));
        }
    });

    // ---- Switzerland - national-level holidays only (most others are
    // cantonal); no weekend-shift rule. ----
    [
        [new Date(year, 0, 1), 'New Year\'s Day'],
        [goodFriday, 'Good Friday'],
        [easterMonday, 'Easter Monday'],
        [addDays(easter, 39), 'Ascension Day'],
        [addDays(easter, 50), 'Whit Monday'],
        [new Date(year, 7, 1), 'Swiss National Day'],
        [new Date(year, 11, 25), 'Christmas Day'],
        [new Date(year, 11, 26), 'St. Stephen\'s Day']
    ].forEach(([date, name]) => add(date, 'CH', name));

    // ---- Australia - national convention. ANZAC Day is deliberately left
    // unshifted (its weekend-substitute rule varies by state). ----
    addMondayised(new Date(year, 0, 1), 'AU', 'New Year\'s Day');
    addMondayised(new Date(year, 0, 26), 'AU', 'Australia Day');
    add(goodFriday, 'AU', 'Good Friday');
    add(easterMonday, 'AU', 'Easter Monday');
    add(new Date(year, 3, 25), 'AU', 'ANZAC Day');
    add(nthWeekdayOfMonth(year, 5, 1, 2), 'AU', 'King\'s Birthday');
    addMondayisedPair('AU', new Date(year, 11, 25), 'Christmas Day', new Date(year, 11, 26), 'Boxing Day');

    // ---- Canada - federal/TSX-style dates, fixed (no weekend-shift rule
    // applied here - practice varies by province, so dates are left as-is
    // rather than guessing). ----
    // Victoria Day: the Monday on or before May 24.
    const may24 = new Date(year, 4, 24);
    const victoriaDay = addDays(may24, -((may24.getDay() + 6) % 7));
    [
        [new Date(year, 0, 1), 'New Year\'s Day'],
        [goodFriday, 'Good Friday'],
        [victoriaDay, 'Victoria Day'],
        [new Date(year, 6, 1), 'Canada Day'],
        [nthWeekdayOfMonth(year, 8, 1, 1), 'Labour Day'],
        [nthWeekdayOfMonth(year, 9, 1, 2), 'Thanksgiving'],
        [new Date(year, 10, 11), 'Remembrance Day'],
        [new Date(year, 11, 25), 'Christmas Day'],
        [new Date(year, 11, 26), 'Boxing Day']
    ].forEach(([date, name]) => add(date, 'CA', name));

    // ---- New Zealand - Mondayisation, with the New Year and Christmas
    // pairs collision-checked. Matariki (a variable Māori lunar-calendar
    // date) is intentionally omitted - it isn't computable algorithmically
    // and there's no reliably-sourced date list for this app's full year
    // range, so it's left out rather than risk showing a wrong date. ----
    addMondayisedPair('NZ', new Date(year, 0, 1), 'New Year\'s Day', new Date(year, 0, 2), 'Day after New Year\'s Day');
    addMondayised(new Date(year, 1, 6), 'NZ', 'Waitangi Day');
    add(goodFriday, 'NZ', 'Good Friday');
    add(easterMonday, 'NZ', 'Easter Monday');
    addMondayised(new Date(year, 3, 25), 'NZ', 'ANZAC Day');
    add(nthWeekdayOfMonth(year, 5, 1, 1), 'NZ', 'King\'s Birthday');
    add(nthWeekdayOfMonth(year, 9, 1, 4), 'NZ', 'Labour Day');
    addMondayisedPair('NZ', new Date(year, 11, 25), 'Christmas Day', new Date(year, 11, 26), 'Boxing Day');

    return map;
}

function getHolidaysForDate(date) {
    const year = date.getFullYear();
    if (!holidaysByYearCache.has(year)) holidaysByYearCache.set(year, buildHolidaysForYear(year));
    return holidaysByYearCache.get(year).get(dateKey(date)) || [];
}

const HOLIDAY_COUNTRY_BY_CODE = new Map(HOLIDAY_COUNTRIES.map(c => [c.code, c]));

// Groups a date's holidays by name (e.g. "Good Friday" observed by 8 of the
// 9 countries lands on the same date with the same name) so overlapping
// holidays render as ONE row with multiple small country tags, instead of
// one full row per country - the only way this stays readable once 9
// calendars can all land on the same day (Christmas, Good Friday...).
function renderHolidayChipsForDate(cellDate) {
    const holidays = getHolidaysForDate(cellDate).filter(h => enabledHolidayCountries.has(h.country));
    if (holidays.length === 0) return '';

    const byName = new Map(); // name -> country codes, insertion order = HOLIDAY_COUNTRIES order
    holidays.forEach(h => {
        if (!byName.has(h.name)) byName.set(h.name, []);
        byName.get(h.name).push(h.country);
    });

    return Array.from(byName.entries()).map(([name, countries]) => {
        const tags = countries.map(code => `<span class="calendar-holiday-tag ${code.toLowerCase()}">${code}</span>`).join('');
        const tooltipCountries = countries.map(code => (HOLIDAY_COUNTRY_BY_CODE.get(code) || {}).tooltipLabel || code).join(', ');
        return `
            <div class="calendar-holiday" title="${escapeHtml(`${tooltipCountries}: ${name}`)}">
                <span class="calendar-holiday-tags">${tags}</span>
                <span class="calendar-holiday-name">${escapeHtml(name)}</span>
            </div>`;
    }).join('');
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

        const holidayHtml = showHolidayCalendar ? renderHolidayChipsForDate(cellDate) : '';

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
