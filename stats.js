// Stats page: aggregate analytics built entirely from the active account's real
// trades (trades.js) and transactions (accounts.js) - no separate data source.
function getAllTradeRows() {
    const account = getActiveAccount();
    const trades = (account && account.trades) || [];
    let rows = trades.map(computeTradeSummary);

    // Same Tags/Symbol/Direction/Status filter panel as the Dashboard (filters.js)
    // - keeps Stats in sync with whatever's currently filtered there.
    if (typeof tradeLogFilters !== 'undefined' && typeof tradeRowMatchesFilters === 'function') {
        rows = rows.filter(row => tradeRowMatchesFilters(row, tradeLogFilters));
    }

    return rows;
}

function renderStatsPage() {
    if (!document.getElementById('stats-metrics-row-1')) return;

    const rows = getAllTradeRows();
    const closed = rows.filter(r => r.returnAmount !== null);
    const wins = closed.filter(r => r.status === 'WIN');
    const losses = closed.filter(r => r.status === 'LOSS');

    renderStatsMetricCards(rows, closed, wins, losses);
    renderStatsEquityChart(closed);
    renderStatsDayOfWeekChart(closed);
    renderStatsHourChart(closed);
    renderStatsTagTable(closed);
    renderStatsSymbolTable(closed);
}

function average(values) {
    return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
}

function formatAvgHold(seconds) {
    const minutes = seconds / 60;
    if (minutes < 60) return `${minutes.toFixed(1)} Min`;
    const hours = minutes / 60;
    if (hours < 24) return `${hours.toFixed(1)} Hr`;
    return `${(hours / 24).toFixed(1)} D`;
}

function longestStreak(sortedRows, status) {
    let longest = 0;
    let current = 0;
    sortedRows.forEach(r => {
        if (r.status === status) {
            current += 1;
            longest = Math.max(longest, current);
        } else if (r.status === 'WIN' || r.status === 'LOSS') {
            current = 0;
        }
    });
    return longest;
}

function renderStatsMetricCards(rows, closed, wins, losses) {
    const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
    const avgWinAmount = average(wins.map(r => r.returnAmount));
    const avgWinPct = average(wins.map(r => r.returnPct));
    const avgLossAmount = average(losses.map(r => r.returnAmount));
    const avgLossPct = average(losses.map(r => r.returnPct));
    const expectancy = closed.length > 0
        ? (wins.length / closed.length) * avgWinAmount + (losses.length / closed.length) * avgLossAmount
        : 0;

    const grossProfit = wins.reduce((sum, r) => sum + r.returnAmount, 0);
    const grossLoss = Math.abs(losses.reduce((sum, r) => sum + r.returnAmount, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : null;

    const sortedClosed = closed.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
    const winStreak = longestStreak(sortedClosed, 'WIN');
    const lossStreak = longestStreak(sortedClosed, 'LOSS');

    const topLoss = losses.reduce((worst, r) => (!worst || r.returnAmount < worst.returnAmount ? r : worst), null);
    const topWin = wins.reduce((best, r) => (!best || r.returnAmount > best.returnAmount ? r : best), null);

    const daysTraded = new Map();
    closed.forEach(r => {
        const day = r.date.slice(0, 10);
        daysTraded.set(day, (daysTraded.get(day) || 0) + 1);
    });
    const avgDailyVol = daysTraded.size > 0
        ? Array.from(daysTraded.values()).reduce((sum, n) => sum + n, 0) / daysTraded.size
        : 0;

    const avgSize = average(rows.map(r => r.qty));

    setHtml('stats-metrics-row-1', [
        ['Win Rate', `${winRate.toFixed(0)}%`],
        ['Expectancy', formatTotal(expectancy), true],
        ['Profit Factor', profitFactor === null ? '-' : profitFactor.toFixed(2)],
        ['Avg Win Hold', wins.length > 0 ? formatAvgHold(average(wins.map(r => r.holdSeconds))) : '-'],
        ['Avg Loss Hold', losses.length > 0 ? formatAvgHold(average(losses.map(r => r.holdSeconds))) : '-'],
        ['Avg Loss', losses.length > 0 ? `${formatTotal(avgLossAmount)} (${avgLossPct.toFixed(1)}%)` : '-', true],
        ['Avg Win', wins.length > 0 ? `${formatTotal(avgWinAmount)} (${avgWinPct.toFixed(1)}%)` : '-', true]
    ].map(renderStatsMetricCard).join(''));

    setHtml('stats-metrics-row-2', [
        ['Win Streak', winStreak],
        ['Loss Streak', lossStreak],
        ['Top Loss', topLoss ? `${formatTotal(topLoss.returnAmount)} (${topLoss.returnPct.toFixed(1)}%)` : '-', true],
        ['Top Win', topWin ? `${formatTotal(topWin.returnAmount)} (${topWin.returnPct.toFixed(1)}%)` : '-', true],
        ['Avg Daily Vol', avgDailyVol.toFixed(0)],
        ['Avg Size', avgSize.toFixed(2)]
    ].map(renderStatsMetricCard).join(''));
}

// Short descriptions shown when a metric card is clicked (see
// toggleStatsMetricTooltip below) - no visible "?" hint, the whole card is
// clickable.
const STATS_METRIC_DESCRIPTIONS = {
    'Win Rate': '% of closed trades that were profitable.',
    'Expectancy': 'Average $ profit or loss you can expect per trade, across all closed trades.',
    'Profit Factor': 'Gross profit divided by gross loss. Above 1 means your wins outweigh your losses overall.',
    'Avg Win Hold': 'Average time a winning trade stayed open, from first entry to last exit.',
    'Avg Loss Hold': 'Average time a losing trade stayed open, from first entry to last exit.',
    'Avg Loss': 'Average $ and % lost per losing trade.',
    'Avg Win': 'Average $ and % gained per winning trade.',
    'Win Streak': 'Longest run of consecutive winning trades in a row.',
    'Loss Streak': 'Longest run of consecutive losing trades in a row.',
    'Top Loss': 'Your single largest losing trade.',
    'Top Win': 'Your single largest winning trade.',
    'Avg Daily Vol': 'Average number of trades placed per day you traded.',
    'Avg Size': 'Average quantity (lots/shares) per trade.'
};

function renderStatsMetricCard([label, value, sensitive]) {
    const description = (STATS_METRIC_DESCRIPTIONS[label] || '').replace(/'/g, "\\'");
    return `
        <div class="stats-metric-card" onclick="toggleStatsMetricTooltip(event, this, '${description}')">
            <div class="stats-metric-label">${escapeHtml(label)}</div>
            <div class="stats-metric-value${sensitive ? ' sensitive-value' : ''}">${value}</div>
        </div>`;
}

// Reuses the same floating tooltip box look as the Settings "?" tooltips
// (.settings-info-tooltip in styles.css), but its own element/state since this
// is triggered by clicking the whole card, not a small icon.
let pinnedStatsMetricCard = null;

function getStatsMetricTooltip() {
    let el = document.getElementById('stats-metric-tooltip');
    if (!el) {
        el = document.createElement('div');
        el.id = 'stats-metric-tooltip';
        el.className = 'settings-info-tooltip';
        document.body.appendChild(el);
    }
    return el;
}

function toggleStatsMetricTooltip(event, card, description) {
    event.stopPropagation();
    if (!description) return;

    const tooltip = getStatsMetricTooltip();
    if (pinnedStatsMetricCard === card) {
        pinnedStatsMetricCard = null;
        tooltip.style.display = 'none';
        return;
    }

    pinnedStatsMetricCard = card;
    tooltip.textContent = description;
    tooltip.style.display = 'block';
    const rect = card.getBoundingClientRect();
    tooltip.style.left = `${rect.left}px`;
    tooltip.style.top = `${rect.bottom + 6}px`;
}

document.addEventListener('click', () => {
    if (!pinnedStatsMetricCard) return;
    pinnedStatsMetricCard = null;
    const tooltip = document.getElementById('stats-metric-tooltip');
    if (tooltip) tooltip.style.display = 'none';
});

function setHtml(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
}

// ---- Equity curve: cumulative trade PnL, one point per day a trade closed ----
let statsEquityChartInstance = null;

function renderStatsEquityChart(closed) {
    const container = document.getElementById('stats-equity-chart');
    if (!container) return;

    if (statsEquityChartInstance) {
        statsEquityChartInstance.remove();
        statsEquityChartInstance = null;
    }

    const sortedClosed = closed.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
    const byDay = new Map();
    let cumulative = 0;
    sortedClosed.forEach(r => {
        cumulative += r.returnAmount;
        byDay.set(r.date.slice(0, 10), cumulative);
    });

    const data = Array.from(byDay.entries()).map(([day, value]) => {
        const [y, m, d] = day.split('-').map(Number);
        return { time: Date.UTC(y, m - 1, d) / 1000, value };
    });

    statsEquityChartInstance = LightweightCharts.createChart(container, {
        width: container.clientWidth || 600,
        height: container.clientHeight || 240,
        layout: { background: { color: 'transparent' }, textColor: '#848e9c', attributionLogo: false },
        grid: {
            vertLines: { color: 'rgba(255, 255, 255, 0.04)' },
            horzLines: { color: 'rgba(255, 255, 255, 0.04)' }
        },
        rightPriceScale: {
            borderColor: '#2a2e39',
            localization: { priceFormatter: price => `$${price.toFixed(2)}` }
        },
        timeScale: { borderColor: '#2a2e39', timeVisible: false, fixLeftEdge: true, fixRightEdge: true, rightOffset: 0 },
        // Native crosshair labels are plain canvas rectangles with no rounded-corner
        // option - hidden here in favor of custom DOM "pill" badges (see
        // attachCrosshairPillLabels in trades.js).
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
    const series = statsEquityChartInstance.addSeries(LightweightCharts.BaselineSeries, {
        baseValue: { type: 'price', price: 0 },
        topLineColor: '#2ebd85',
        topFillColor1: 'rgba(46, 189, 133, 0.4)',
        topFillColor2: 'rgba(46, 189, 133, 0.02)',
        bottomLineColor: '#f6465d',
        bottomFillColor1: 'rgba(246, 70, 93, 0.02)',
        bottomFillColor2: 'rgba(246, 70, 93, 0.4)',
        lineWidth: 2,
        lineType: LightweightCharts.LineType.Curved,
        // A persistent dashed line at the latest equity value - the floating
        // "$X.XX" badge that sits on top of it is custom (built in trades.js),
        // since Lightweight Charts' own last-value label can't be positioned
        // mid-chart.
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

    const finalData = data.length > 0 ? data : [{ time: 0, value: 0 }];
    series.setData(finalData);
    // Force the exact pixels-per-point spacing needed to span the full width,
    // rather than relying on fitContent()'s default margin/logical-range math.
    const chartWidth = container.clientWidth || 600;
    const barSpacing = finalData.length > 1 ? chartWidth / (finalData.length - 1) : chartWidth;
    statsEquityChartInstance.timeScale().applyOptions({ barSpacing });
    statsEquityChartInstance.timeScale().setVisibleLogicalRange({ from: 0.5, to: finalData.length - 0.5 });
    const labelControls = attachCrosshairPillLabels(statsEquityChartInstance, series, container, getCurrencySymbol());
    const lastPoint = finalData[finalData.length - 1];
    labelControls.setDefaultValue(lastPoint.time, lastPoint.value);
}

// ---- Diverging (positive/negative) horizontal bar charts ----
function renderDivergingBarChart(containerId, items) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (items.length === 0) {
        container.innerHTML = '<div style="color: var(--text-muted); font-size: 0.8rem; text-align: center;">No closed trades yet.</div>';
        return;
    }

    const maxAbs = Math.max(1, ...items.map(i => Math.abs(i.value)));

    const rowsHtml = items.map(item => {
        const pct = Math.min(100, (Math.abs(item.value) / maxAbs) * 100);
        const isNeg = item.value < 0;
        return `
        <div class="stats-bar-row" data-bar-label="${escapeHtml(item.label)}" data-bar-value="${item.value}">
            <div class="stats-bar-row-label">${escapeHtml(item.label)}</div>
            <div class="stats-bar-row-track">
                <div class="stats-bar-half negative">${isNeg ? `<div class="stats-bar-fill negative" style="width:${pct}%"></div>` : ''}</div>
                <div class="stats-bar-divider"></div>
                <div class="stats-bar-half positive">${!isNeg ? `<div class="stats-bar-fill positive" style="width:${pct}%"></div>` : ''}</div>
            </div>
        </div>`;
    }).join('');

    const step = maxAbs / 2;
    const ticksHtml = `
        <div class="stats-bar-row">
            <div class="stats-bar-row-label"></div>
            <div class="stats-bar-row-track sensitive-value">
                <div class="stats-bar-ticks-half">
                    <span>-${Math.round(maxAbs)}</span><span>-${Math.round(step)}</span><span>0</span>
                </div>
                <div class="stats-bar-divider"></div>
                <div class="stats-bar-ticks-half">
                    <span>0</span><span>${Math.round(step)}</span><span>${Math.round(maxAbs)}</span>
                </div>
            </div>
        </div>`;

    container.innerHTML = rowsHtml + ticksHtml;
    bindDivergingBarTooltip(container);
}

// ---- Hover tooltip for the diverging bar charts (Day of Week / Hour) ----
function getStatsBarTooltip() {
    let tooltip = document.getElementById('stats-bar-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'stats-bar-tooltip';
        tooltip.className = 'stats-bar-tooltip';
        document.body.appendChild(tooltip);
    }
    return tooltip;
}

// Event delegation, bound once per container (guarded via a dataset flag since
// renderDivergingBarChart re-renders innerHTML on every stats refresh).
function bindDivergingBarTooltip(container) {
    if (container.dataset.tooltipBound) return;
    container.dataset.tooltipBound = 'true';

    const tooltip = getStatsBarTooltip();

    container.addEventListener('mouseover', event => {
        const row = event.target.closest('.stats-bar-row[data-bar-value]');
        if (!row) return;

        const value = parseFloat(row.dataset.barValue);
        const isNeg = value < 0;
        tooltip.innerHTML = `
            <div class="stats-bar-tooltip-label">${escapeHtml(row.dataset.barLabel)}</div>
            <div class="stats-bar-tooltip-value">
                <span class="stats-bar-tooltip-swatch ${isNeg ? 'negative' : 'positive'}"></span>
                <span class="sensitive-value">${formatTotal(value)}</span>
            </div>`;
        tooltip.style.display = 'block';
    });

    container.addEventListener('mousemove', event => {
        const row = event.target.closest('.stats-bar-row[data-bar-value]');
        if (!row || tooltip.style.display === 'none') return;
        tooltip.style.left = `${event.clientX + 14}px`;
        tooltip.style.top = `${event.clientY - 12}px`;
    });

    container.addEventListener('mouseout', event => {
        const row = event.target.closest('.stats-bar-row[data-bar-value]');
        const toRow = event.relatedTarget && event.relatedTarget.closest && event.relatedTarget.closest('.stats-bar-row[data-bar-value]');
        if (row && row !== toRow) tooltip.style.display = 'none';
    });
}

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// r.date ("YYYY-MM-DDTHH:MM", no timezone suffix) is a wall-clock string meaning
// "this hour/day in whatever timezone the chart is in" (GMT+2 for CSV-imported
// trades - see csv-import.js). new Date(r.date).getHours()/.getDay() would
// re-interpret that string in the VIEWER's OWN browser timezone instead, which
// only coincidentally matches when the viewer happens to also be on GMT+2 - so
// the hour/day is read directly from the string instead, via a UTC-anchored
// Date that no local timezone conversion can touch.
function getWallClockHour(dateStr) {
    const timePart = dateStr.split('T')[1] || '';
    return parseInt(timePart.slice(0, 2), 10);
}

function getWallClockWeekday(dateStr) {
    const [datePart] = dateStr.split('T');
    const [y, m, d] = datePart.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function renderStatsDayOfWeekChart(closed) {
    const totals = new Array(7).fill(0);
    closed.forEach(r => { totals[getWallClockWeekday(r.date)] += r.returnAmount; });
    const items = WEEKDAY_LABELS.map((label, i) => ({ label, value: totals[i] }));
    renderDivergingBarChart('stats-day-chart', items);
}

function formatHourLabel(hour) {
    const period = hour < 12 ? 'AM' : 'PM';
    const displayHour = hour % 12 === 0 ? 12 : hour % 12;
    return `${displayHour} ${period}`;
}

function renderStatsHourChart(closed) {
    const totals = new Map();
    closed.forEach(r => {
        const hour = getWallClockHour(r.date);
        totals.set(hour, (totals.get(hour) || 0) + r.returnAmount);
    });

    const items = Array.from(totals.keys())
        .sort((a, b) => a - b)
        .map(hour => ({ label: formatHourLabel(hour), value: totals.get(hour) }));

    renderDivergingBarChart('stats-hour-chart', items);
}

// ---- Breakdown tables (sortable by column, click a header to toggle) ----
const statsTableSort = {
    tag: { key: 'trades', dir: 'desc' },
    symbol: { key: 'trades', dir: 'desc' }
};

function sortStatsTable(tableType, key) {
    const state = statsTableSort[tableType];
    if (state.key === key) {
        state.dir = state.dir === 'asc' ? 'desc' : 'asc';
    } else {
        state.key = key;
        state.dir = 'desc';
    }
    renderStatsPage();
}

function sortStatsRows(rows, tableType) {
    const { key, dir } = statsTableSort[tableType];
    const sorted = rows.slice().sort((a, b) => {
        let av = a[key];
        let bv = b[key];
        if (typeof av === 'string') av = av.toLowerCase();
        if (typeof bv === 'string') bv = bv.toLowerCase();
        if (av < bv) return dir === 'asc' ? -1 : 1;
        if (av > bv) return dir === 'asc' ? 1 : -1;
        return 0;
    });

    document.querySelectorAll(`#page-stats th.sortable i[id^="stats-${tableType}-sort-icon-"]`).forEach(icon => {
        const iconKey = icon.id.replace(`stats-${tableType}-sort-icon-`, '');
        icon.className = iconKey === key
            ? (dir === 'asc' ? 'fa-solid fa-sort-up' : 'fa-solid fa-sort-down')
            : 'fa-solid fa-sort';
    });

    return sorted;
}

function renderStatsTagTable(closed) {
    const tagDefs = (getActiveAccount().tagDefs) || [];
    const tagNameById = new Map(tagDefs.map(t => [t.id, t.name]));

    // A trade can carry multiple tags now, so it's counted once per tag it has
    // (not split proportionally) - contribution % across tags won't sum to 100%
    // when trades carry more than one tag, same as a typical "filter by tag" view.
    const byTag = new Map();
    closed.forEach(r => {
        const keys = (r.tagIds && r.tagIds.length > 0) ? r.tagIds : [''];
        keys.forEach(key => {
            if (!byTag.has(key)) byTag.set(key, []);
            byTag.get(key).push(r);
        });
    });

    const totalPnl = closed.reduce((sum, r) => sum + r.returnAmount, 0);

    let tagRows = Array.from(byTag.entries())
        .map(([tagId, tagTrades]) => {
            const pnl = tagTrades.reduce((sum, r) => sum + r.returnAmount, 0);
            const entTot = tagTrades.reduce((sum, r) => sum + r.entTot, 0);
            const pnlPct = entTot !== 0 ? (pnl / entTot) * 100 : 0;
            const contributionPct = totalPnl !== 0 ? (pnl / totalPnl) * 100 : 0;
            const name = tagId ? (tagNameById.get(tagId) || 'Unknown Tag') : '--NO TAGS--';
            return { name, trades: tagTrades.length, pnl, pnlPct, contributionPct };
        });
    tagRows = sortStatsRows(tagRows, 'tag');

    setHtml('stats-tag-table-body', tagRows.map(row => `
        <tr>
            <td>${escapeHtml(row.name)}</td>
            <td>${row.trades}</td>
            <td class="${row.pnl < 0 ? 'value-negative' : 'value-positive'}">${formatTotal(row.pnl)}</td>
            <td class="${row.pnl < 0 ? 'value-negative' : 'value-positive'}">${row.pnlPct.toFixed(2)}%</td>
            <td>${row.contributionPct.toFixed(2)}%</td>
        </tr>`).join(''));
}

function renderStatsSymbolTable(closed) {
    const bySymbol = new Map();
    closed.forEach(r => {
        if (!bySymbol.has(r.symbol)) bySymbol.set(r.symbol, []);
        bySymbol.get(r.symbol).push(r);
    });

    const totalPnl = closed.reduce((sum, r) => sum + r.returnAmount, 0);

    let symbolRows = Array.from(bySymbol.entries())
        .map(([symbol, symbolTrades]) => {
            const pnl = symbolTrades.reduce((sum, r) => sum + r.returnAmount, 0);
            const entTot = symbolTrades.reduce((sum, r) => sum + r.entTot, 0);
            const pnlPct = entTot !== 0 ? (pnl / entTot) * 100 : 0;
            const contributionPct = totalPnl !== 0 ? (pnl / totalPnl) * 100 : 0;
            return { symbol, trades: symbolTrades.length, pnl, pnlPct, contributionPct };
        });
    symbolRows = sortStatsRows(symbolRows, 'symbol');

    setHtml('stats-symbol-table-body', symbolRows.map(row => `
        <tr>
            <td>${escapeHtml(row.symbol)}</td>
            <td>${row.trades}</td>
            <td class="${row.pnl < 0 ? 'value-negative' : 'value-positive'}">${formatTotal(row.pnl)}</td>
            <td class="${row.pnl < 0 ? 'value-negative' : 'value-positive'}">${row.pnlPct.toFixed(2)}%</td>
            <td>${row.contributionPct.toFixed(2)}%</td>
        </tr>`).join(''));
}
