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
    renderProScore(closed, wins, losses);
    renderStatsEquityChart(closed);
    renderWinsLossesCompare(wins, losses);
    renderStatsDayOfWeekChart(closed);
    renderStatsHourChart(closed);
    renderStatsHeatmap(closed);
    renderStatsTagTable(closed);
    renderStatsSymbolTable(closed);
    renderStatsPlaybookTable(closed);
    renderMaeMfeStats(closed);
    renderVolatilityStats(closed);
}

// ---- Pro Score: a hexagonal radar chart averaging 6 normalized (0-100)
// metrics into one headline number, the same idea as TradeZella's "Zella
// Score" - built entirely from data already computed elsewhere on this page. ----
function computeProScoreMetrics(closed, wins, losses) {
    const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;

    const grossProfit = wins.reduce((sum, r) => sum + r.returnAmount, 0);
    const grossLoss = Math.abs(losses.reduce((sum, r) => sum + r.returnAmount, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 2 : 0);
    const profitFactorScore = Math.max(0, Math.min(100, profitFactor * 50));

    const avgWin = average(wins.map(r => r.returnAmount));
    const avgLoss = Math.abs(average(losses.map(r => r.returnAmount)));
    const avgWinLossRatio = avgLoss > 0 ? avgWin / avgLoss : (avgWin > 0 ? 2 : 0);
    const avgWinLossScore = Math.max(0, Math.min(100, avgWinLossRatio * 50));

    // Walk the equity curve (cumulative P&L in close order) to find the worst
    // peak-to-trough dip - the basis for both Max Drawdown and Recovery Factor.
    const sortedClosed = closed.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
    let cumulative = 0, peak = 0, maxDrawdown = 0;
    sortedClosed.forEach(r => {
        cumulative += r.returnAmount;
        peak = Math.max(peak, cumulative);
        maxDrawdown = Math.max(maxDrawdown, peak - cumulative);
    });
    const netProfit = cumulative;

    const maxDrawdownScore = grossProfit > 0
        ? Math.max(0, 100 - (maxDrawdown / grossProfit) * 100)
        : (maxDrawdown === 0 ? 100 : 0);

    const recoveryFactor = maxDrawdown > 0 ? netProfit / maxDrawdown : (netProfit > 0 ? 4 : 0);
    const recoveryFactorScore = Math.max(0, Math.min(100, recoveryFactor * 25));

    // Consistency: what % of your total profit came from a single best day -
    // low consistency means one lucky day is carrying your whole track record.
    const byDay = new Map();
    closed.forEach(r => {
        const day = r.date.slice(0, 10);
        byDay.set(day, (byDay.get(day) || 0) + r.returnAmount);
    });
    const dayTotals = Array.from(byDay.values());
    const totalPositive = dayTotals.filter(v => v > 0).reduce((sum, v) => sum + v, 0);
    const bestDay = dayTotals.length > 0 ? Math.max(...dayTotals) : 0;
    const consistencyScore = totalPositive > 0
        ? Math.max(0, Math.min(100, 100 - (Math.max(0, bestDay) / totalPositive) * 100))
        : 0;

    return [
        { label: 'Win %', value: Math.max(0, Math.min(100, winRate)) },
        { label: 'Profit Factor', value: profitFactorScore },
        { label: 'Avg Win/Loss', value: avgWinLossScore },
        { label: 'Recovery Factor', value: recoveryFactorScore },
        { label: 'Max Drawdown', value: maxDrawdownScore },
        { label: 'Consistency', value: consistencyScore }
    ];
}

// Returns "x,y" pairs for 6 axes spaced 60° apart starting at 12 o'clock -
// valuesFrac is 6 numbers in [0,1], the fraction of maxRadius for that axis.
function hexPoints(cx, cy, radius, valuesFrac) {
    return valuesFrac.map((v, i) => {
        const angle = (-90 + i * 60) * Math.PI / 180;
        const r = radius * v;
        return `${(cx + r * Math.cos(angle)).toFixed(1)},${(cy + r * Math.sin(angle)).toFixed(1)}`;
    }).join(' ');
}

function renderProScore(closed, wins, losses) {
    const container = document.getElementById('pro-score-radar');
    const scoreEl = document.getElementById('pro-score-value');
    const markerEl = document.getElementById('pro-score-marker');
    if (!container || !scoreEl) return;

    if (closed.length === 0) {
        container.innerHTML = '<div class="pro-score-empty">No closed trades yet.</div>';
        scoreEl.textContent = '-';
        if (markerEl) markerEl.style.left = '0%';
        return;
    }

    const metrics = computeProScoreMetrics(closed, wins, losses);
    const overallScore = average(metrics.map(m => m.value));

    const cx = 150, cy = 105, maxR = 70;
    const gridPolygons = [0.2, 0.4, 0.6, 0.8, 1.0]
        .map(level => `<polygon points="${hexPoints(cx, cy, maxR, metrics.map(() => level))}" class="pro-score-grid-ring"/>`)
        .join('');

    const axisLines = metrics.map((m, i) => {
        const angle = (-90 + i * 60) * Math.PI / 180;
        const x = cx + maxR * Math.cos(angle);
        const y = cy + maxR * Math.sin(angle);
        return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="pro-score-axis-line"/>`;
    }).join('');

    const dataPoints = hexPoints(cx, cy, maxR, metrics.map(m => m.value / 100));

    const vertexDots = metrics.map((m, i) => {
        const angle = (-90 + i * 60) * Math.PI / 180;
        const r = maxR * (m.value / 100);
        const x = cx + r * Math.cos(angle);
        const y = cy + r * Math.sin(angle);
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" class="pro-score-vertex" data-vertex-index="${i}"/>`;
    }).join('');

    // Invisible larger hit-targets over each vertex - the visible dot (r=3.5)
    // is too small to hover reliably, per the ~24px minimum hit-area rule.
    const hitTargets = metrics.map((m, i) => {
        const angle = (-90 + i * 60) * Math.PI / 180;
        const r = maxR * (m.value / 100);
        const x = cx + r * Math.cos(angle);
        const y = cy + r * Math.sin(angle);
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="12" class="pro-score-hit" data-vertex-index="${i}" data-score-label="${escapeHtml(m.label)}" data-score-value="${m.value.toFixed(0)}"/>`;
    }).join('');

    const labels = metrics.map((m, i) => {
        const angle = (-90 + i * 60) * Math.PI / 180;
        const labelR = maxR + 18;
        const x = cx + labelR * Math.cos(angle);
        const y = cy + labelR * Math.sin(angle);
        const cos = Math.cos(angle);
        const anchor = cos > 0.3 ? 'start' : (cos < -0.3 ? 'end' : 'middle');
        return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" class="pro-score-axis-label">${escapeHtml(m.label)}</text>`;
    }).join('');

    // Wide margins on both sides of the hexagon - SVG clips anything outside its
    // viewBox by default, and axis label text (e.g. "Profit Factor") extends well
    // past the hexagon's own radius, so the viewBox needs real room for it.
    container.innerHTML = `
        <svg viewBox="0 0 300 210" class="pro-score-svg">
            ${gridPolygons}
            ${axisLines}
            <polygon points="${dataPoints}" class="pro-score-data-polygon"/>
            ${vertexDots}
            ${labels}
            ${hitTargets}
        </svg>`;

    scoreEl.textContent = overallScore.toFixed(2);
    if (markerEl) markerEl.style.left = `${Math.max(0, Math.min(100, overallScore))}%`;

    bindProScoreTooltip(container);
}

// ---- Hover tooltip for the Pro Score radar vertices - reuses the same
// floating tooltip element/style as the diverging bar charts. ----
function bindProScoreTooltip(container) {
    if (container.dataset.tooltipBound) return;
    container.dataset.tooltipBound = 'true';

    const tooltip = getStatsBarTooltip();

    container.addEventListener('mouseover', event => {
        const hit = event.target.closest('.pro-score-hit');
        if (!hit) return;
        tooltip.innerHTML = `
            <div class="stats-bar-tooltip-label">${escapeHtml(hit.dataset.scoreLabel)}</div>
            <div class="stats-bar-tooltip-value">
                <span class="stats-bar-tooltip-swatch pro-score"></span>
                <span>${hit.dataset.scoreValue}/100</span>
            </div>`;
        tooltip.style.display = 'block';

        const vertex = container.querySelector(`.pro-score-vertex[data-vertex-index="${hit.dataset.vertexIndex}"]`);
        if (vertex) vertex.classList.add('hovered');
    });

    container.addEventListener('mousemove', event => {
        const hit = event.target.closest('.pro-score-hit');
        if (!hit || tooltip.style.display === 'none') return;
        tooltip.style.left = `${event.clientX + 14}px`;
        tooltip.style.top = `${event.clientY - 12}px`;
    });

    container.addEventListener('mouseout', event => {
        const hit = event.target.closest('.pro-score-hit');
        const toHit = event.relatedTarget && event.relatedTarget.closest && event.relatedTarget.closest('.pro-score-hit');
        if (hit && hit !== toHit) {
            tooltip.style.display = 'none';
            const vertex = container.querySelector(`.pro-score-vertex[data-vertex-index="${hit.dataset.vertexIndex}"]`);
            if (vertex) vertex.classList.remove('hovered');
        }
    });
}

// ---- Playbook performance breakdown ----
function renderStatsPlaybookTable(closed) {
    const account = getActiveAccount();
    const playbooks = (account.playbooks) || [];
    const playbookNameById = new Map(playbooks.map(p => [p.id, p.name]));

    const byPlaybook = new Map();
    closed.forEach(r => {
        const key = r.playbookId || '';
        if (!byPlaybook.has(key)) byPlaybook.set(key, []);
        byPlaybook.get(key).push(r);
    });

    const totalPnl = closed.reduce((sum, r) => sum + r.returnAmount, 0);

    let playbookRows = Array.from(byPlaybook.entries())
        .map(([playbookId, trades]) => {
            const pnl = trades.reduce((sum, r) => sum + r.returnAmount, 0);
            const wins = trades.filter(r => r.status === 'WIN').length;
            const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;
            const contributionPct = totalPnl !== 0 ? (pnl / totalPnl) * 100 : 0;
            const rValues = trades.map(r => r.rMultiple).filter(v => v !== null);
            const avgR = rValues.length > 0 ? rValues.reduce((s, v) => s + v, 0) / rValues.length : null;
            const name = playbookId ? (playbookNameById.get(playbookId) || 'Unknown Playbook') : '--NO PLAYBOOK--';
            return { name, trades: trades.length, winRate, pnl, contributionPct, avgR: avgR === null ? -Infinity : avgR, avgRDisplay: avgR };
        });
    playbookRows = sortStatsRows(playbookRows, 'playbook');

    setHtml('stats-playbook-table-body', playbookRows.map(row => `
        <tr>
            <td>${escapeHtml(row.name)}</td>
            <td>${row.trades}</td>
            <td>${row.winRate.toFixed(0)}%</td>
            <td class="${row.pnl < 0 ? 'value-negative' : 'value-positive'}">${formatTotal(row.pnl)}</td>
            <td class="${row.avgRDisplay !== null && row.avgRDisplay < 0 ? 'value-negative' : ''}">${row.avgRDisplay !== null ? row.avgRDisplay.toFixed(2) + 'R' : '-'}</td>
            <td>${row.contributionPct.toFixed(2)}%</td>
        </tr>`).join(''));
}

// ---- MAE / MFE (Maximum Adverse/Favorable Excursion) ----
// Best-effort: only computable for trades where real candle data exists (the
// auto-fetched XAUUSD daily charts in /data) and whose entry+exit fall on the
// same calendar day, since that's the only price history this app has. Runs
// asynchronously (CSV fetches) and fills the card in once done, rather than
// blocking the rest of the (synchronous) Stats render.
const maeMfeCandleCache = new Map(); // "date_interval" -> parsed [{time, high, low}] or null
const MAE_MFE_INTERVALS = ['1', '5', '15'];

// leg.datetime strings are naive "GMT+2 wall clock" (see csv-import.js/
// getWallClockHour) - converts to a true UTC timestamp so it's comparable
// against the chart CSV's own timezone-suffixed timestamps.
function gmt2WallClockToUtcMillis(datetimeStr) {
    const [datePart, timePart] = datetimeStr.split('T');
    const [y, m, d] = datePart.split('-').map(Number);
    const [hh, mm] = timePart.split(':').map(Number);
    return Date.UTC(y, m - 1, d, hh, mm) - 2 * 3600000;
}

function fetchMaeMfeCandles(dateStr, intervalIndex) {
    intervalIndex = intervalIndex || 0;
    if (intervalIndex >= MAE_MFE_INTERVALS.length) return Promise.resolve(null);

    const interval = MAE_MFE_INTERVALS[intervalIndex];
    const cacheKey = `${dateStr}_${interval}`;
    if (maeMfeCandleCache.has(cacheKey)) return Promise.resolve(maeMfeCandleCache.get(cacheKey));

    const filename = `XAU-USD_${interval}Minute_BID_${dateStr}_00_00-23_59_Africa_Johannesburg.csv`;
    return fetch(`./data/${filename}`)
        .then(response => {
            if (!response.ok) throw new Error('missing');
            return response.text();
        })
        .then(csvText => {
            const parsed = Papa.parse(csvText.trim(), { header: true, skipEmptyLines: true });
            const candles = parsed.data
                .map(r => ({
                    time: new Date(r['Africa/Johannesburg']).getTime(),
                    high: parseFloat(r.High),
                    low: parseFloat(r.Low)
                }))
                .filter(c => !isNaN(c.time) && !isNaN(c.high) && !isNaN(c.low));
            maeMfeCandleCache.set(cacheKey, candles);
            return candles;
        })
        .catch(() => fetchMaeMfeCandles(dateStr, intervalIndex + 1));
}

function getTradeEntryExitWindow(trade, direction) {
    const legs = trade.legs.slice().sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
    const entryAction = direction === 'long' ? 'buy' : 'sell';
    const exitAction = direction === 'long' ? 'sell' : 'buy';
    const firstEntry = legs.find(l => l.action === entryAction);
    const lastExit = legs.slice().reverse().find(l => l.action === exitAction);
    if (!firstEntry || !lastExit) return null;
    return { entryLeg: firstEntry, exitLeg: lastExit };
}

function computeMaeMfeForTrade(row, trade, contractSize) {
    const window = getTradeEntryExitWindow(trade, row.direction);
    if (!window) return Promise.resolve(null);

    const entryDay = window.entryLeg.datetime.slice(0, 10);
    const exitDay = window.exitLeg.datetime.slice(0, 10);
    if (entryDay !== exitDay) return Promise.resolve(null); // spans multiple days - not supported yet

    return fetchMaeMfeCandles(entryDay).then(candles => {
        if (!candles || candles.length === 0) return null;

        const entryTime = gmt2WallClockToUtcMillis(window.entryLeg.datetime);
        const exitTime = gmt2WallClockToUtcMillis(window.exitLeg.datetime);
        const windowCandles = candles.filter(c => c.time >= entryTime && c.time <= exitTime);
        if (windowCandles.length === 0) return null;

        let worst = row.entryPrice;
        let best = row.entryPrice;
        windowCandles.forEach(c => {
            if (row.direction === 'long') {
                worst = Math.min(worst, c.low);
                best = Math.max(best, c.high);
            } else {
                worst = Math.max(worst, c.high);
                best = Math.min(best, c.low);
            }
        });

        const directionSign = row.direction === 'long' ? 1 : -1;
        const mae = (worst - row.entryPrice) * directionSign * row.qty * contractSize;
        const mfe = (best - row.entryPrice) * directionSign * row.qty * contractSize;
        return { mae, mfe };
    });
}

function renderMaeMfeStats(closed) {
    const el = document.getElementById('stats-mae-mfe-result');
    if (!el) return;

    if (typeof Papa === 'undefined') return; // PapaParse loads after this file - skip if unavailable

    const account = getActiveAccount();
    const trades = account.trades || [];
    const eligible = closed.filter(r => r.symbol === 'XAUUSD');

    if (eligible.length === 0) {
        el.textContent = 'No closed XAUUSD trades in view - MAE/MFE needs real chart data, which this app only auto-fetches for XAUUSD.';
        return;
    }

    el.textContent = 'Calculating from chart data...';

    const contractSize = getContractSizeForSymbol('XAUUSD');
    Promise.all(eligible.map(row => {
        const trade = trades.find(t => t.id === row.id);
        return trade ? computeMaeMfeForTrade(row, trade, contractSize) : Promise.resolve(null);
    })).then(results => {
        const valid = results.filter(Boolean);
        if (valid.length === 0) {
            el.textContent = 'Chart data wasn\'t available for any of these trades\' dates.';
            return;
        }

        const avgMae = average(valid.map(v => v.mae));
        const avgMfe = average(valid.map(v => v.mfe));

        el.innerHTML = `
            <div class="mae-mfe-item">
                <span class="mae-mfe-label">Avg MAE (worst drawdown)</span>
                <span class="mae-mfe-value value-negative sensitive-value">${formatTotal(avgMae)}</span>
            </div>
            <div class="mae-mfe-item">
                <span class="mae-mfe-label">Avg MFE (best unrealized)</span>
                <span class="mae-mfe-value value-positive sensitive-value">${formatTotal(avgMfe)}</span>
            </div>
            <p class="mae-mfe-note">Based on ${valid.length} of ${eligible.length} XAUUSD trade${eligible.length === 1 ? '' : 's'} in view with available chart data (same-day trades only).</p>`;
    });
}

// ---- Performance vs. Volatility ----
// Splits trades into "high" and "low" volatility days based on that day's
// actual XAUUSD intraday range (high-low across the day's candles, reusing
// the same chart data/cache as MAE/MFE), then compares win rate and P&L
// across the two buckets. Only possible because this app fetches real gold
// chart data daily - no generic trade journal has this.
const dailyRangeCache = new Map(); // dateStr -> range number or null

function computeDailyRange(dateStr) {
    if (dailyRangeCache.has(dateStr)) return Promise.resolve(dailyRangeCache.get(dateStr));

    return fetchMaeMfeCandles(dateStr).then(candles => {
        if (!candles || candles.length === 0) {
            dailyRangeCache.set(dateStr, null);
            return null;
        }
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const range = Math.max(...highs) - Math.min(...lows);
        dailyRangeCache.set(dateStr, range);
        return range;
    });
}

function median(values) {
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function renderVolatilityStats(closed) {
    const container = document.getElementById('stats-volatility-result');
    if (!container) return;

    if (typeof Papa === 'undefined') return; // PapaParse loads after this file - skip if unavailable

    const eligible = closed.filter(r => r.symbol === 'XAUUSD');
    if (eligible.length === 0) {
        container.innerHTML = '<p class="mae-mfe-note">No closed XAUUSD trades in view - this stat needs real chart data, which this app only auto-fetches for XAUUSD.</p>';
        return;
    }

    container.innerHTML = '<p class="mae-mfe-note">Calculating from chart data...</p>';

    const uniqueDays = Array.from(new Set(eligible.map(r => r.date.slice(0, 10))));
    Promise.all(uniqueDays.map(day => computeDailyRange(day).then(range => [day, range])))
        .then(entries => {
            const rangeByDay = new Map(entries.filter(([, range]) => range !== null));
            const scoredTrades = eligible
                .map(r => ({ row: r, range: rangeByDay.get(r.date.slice(0, 10)) }))
                .filter(t => t.range !== undefined);

            if (scoredTrades.length === 0 || rangeByDay.size < 2) {
                container.innerHTML = '<p class="mae-mfe-note">Chart data wasn\'t available for enough of these trades\' dates to compare volatility.</p>';
                return;
            }

            const dayMedian = median(Array.from(rangeByDay.values()));
            const highVol = scoredTrades.filter(t => t.range >= dayMedian).map(t => t.row);
            const lowVol = scoredTrades.filter(t => t.range < dayMedian).map(t => t.row);

            const bucketStats = rows => {
                const wins = rows.filter(r => r.status === 'WIN');
                const winRate = rows.length > 0 ? (wins.length / rows.length) * 100 : 0;
                const total = rows.reduce((sum, r) => sum + r.returnAmount, 0);
                return { trades: rows.length, winRate, total, avg: average(rows.map(r => r.returnAmount)) };
            };

            const high = bucketStats(highVol);
            const low = bucketStats(lowVol);
            const valFmt = (n, count) => count > 0
                ? `<span class="${n < 0 ? 'value-negative' : 'value-positive'} sensitive-value">${formatTotal(n)}</span>`
                : '-';

            const rowDefs = [
                ['Trades', high.trades, low.trades],
                ['Win Rate', high.trades > 0 ? `${high.winRate.toFixed(0)}%` : '-', low.trades > 0 ? `${low.winRate.toFixed(0)}%` : '-'],
                ['Total P&L', valFmt(high.total, high.trades), valFmt(low.total, low.trades)],
                ['Average', valFmt(high.avg, high.trades), valFmt(low.avg, low.trades)]
            ];

            container.innerHTML = `
                <div class="wl-compare-row wl-compare-header-row">
                    <div class="wl-compare-value left">High Volatility Days</div>
                    <div class="wl-compare-label"></div>
                    <div class="wl-compare-value right">Low Volatility Days</div>
                </div>
                ${rowDefs.map(([label, highVal, lowVal]) => `
                <div class="wl-compare-row">
                    <div class="wl-compare-value left">${highVal}</div>
                    <div class="wl-compare-label">${label}</div>
                    <div class="wl-compare-value right">${lowVal}</div>
                </div>`).join('')}
                <p class="mae-mfe-note">Split at the median daily range (${formatTotal(dayMedian)}) across ${rangeByDay.size} day${rangeByDay.size === 1 ? '' : 's'} with chart data.</p>`;
        });
}

// ---- Wins vs Losses comparison ----
function renderWinsLossesCompare(wins, losses) {
    const container = document.getElementById('wins-losses-compare');
    if (!container) return;

    const winTotal = wins.reduce((sum, r) => sum + r.returnAmount, 0);
    const lossTotal = losses.reduce((sum, r) => sum + r.returnAmount, 0);
    const winAvg = average(wins.map(r => r.returnAmount));
    const lossAvg = average(losses.map(r => r.returnAmount));
    const largestWin = wins.reduce((best, r) => (!best || r.returnAmount > best.returnAmount ? r : best), null);
    const largestLoss = losses.reduce((worst, r) => (!worst || r.returnAmount < worst.returnAmount ? r : worst), null);

    const rowDefs = [
        ['Trades', wins.length, losses.length, false],
        ['Total P&L', formatTotal(winTotal), formatTotal(lossTotal), true],
        ['Average', wins.length > 0 ? formatTotal(winAvg) : '-', losses.length > 0 ? formatTotal(lossAvg) : '-', true],
        ['Avg Hold', wins.length > 0 ? formatAvgHold(average(wins.map(r => r.holdSeconds))) : '-', losses.length > 0 ? formatAvgHold(average(losses.map(r => r.holdSeconds))) : '-', false],
        ['Largest', largestWin ? formatTotal(largestWin.returnAmount) : '-', largestLoss ? formatTotal(largestLoss.returnAmount) : '-', true]
    ];

    container.innerHTML = rowDefs.map(([label, winVal, lossVal, sensitive]) => `
        <div class="wl-compare-row">
            <div class="wl-compare-value win ${sensitive ? 'sensitive-value' : ''}">${winVal}</div>
            <div class="wl-compare-label">${label}</div>
            <div class="wl-compare-value loss ${sensitive ? 'sensitive-value' : ''}">${lossVal}</div>
        </div>`).join('');
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

    const totalFees = closed.reduce((sum, r) => sum + (r.fees || 0), 0);
    const rMultiples = closed.map(r => r.rMultiple).filter(v => v !== null && v !== undefined);
    const avgRMultiple = rMultiples.length > 0 ? average(rMultiples) : null;

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
        ['Avg Size', avgSize.toFixed(2)],
        ['Total Fees', formatTotal(totalFees), true],
        ['Avg R-Multiple', avgRMultiple === null ? '-' : `${avgRMultiple.toFixed(2)}R`]
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
    'Avg Size': 'Average quantity (lots/shares) per trade.',
    'Total Fees': 'Total commissions/fees paid across all closed trades - already subtracted from your P&L.',
    'Avg R-Multiple': 'Average return in units of risk (R), based on each trade\'s distance from entry to its Stop-Loss. Only counts trades that had a Stop-Loss set.'
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
        <div class="stats-bar-row stats-bar-ticks-row">
            <div class="stats-bar-row-label"></div>
            <div class="stats-bar-row-track sensitive-value">
                <div class="stats-bar-ticks-half">
                    <span>-${Math.round(maxAbs)}</span><span>-${Math.round(step)}</span><span></span>
                </div>
                <div class="stats-bar-zero">0</div>
                <div class="stats-bar-ticks-half">
                    <span></span><span>${Math.round(step)}</span><span>${Math.round(maxAbs)}</span>
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

// ---- Day-of-week x hour P&L heatmap ----
// The two bar charts above answer "which days" and "which hours" separately;
// this shows the interaction (e.g. Tuesday 9am specifically), which is where
// session habits actually live. Cell color = P&L direction, intensity = size
// relative to the biggest cell; hover for trades/win-rate/P&L detail.
function renderStatsHeatmap(closed) {
    const container = document.getElementById('stats-heatmap');
    if (!container) return;

    if (closed.length === 0) {
        container.innerHTML = '<div style="color: var(--text-muted); font-size: 0.8rem; text-align: center;">No closed trades yet.</div>';
        return;
    }

    // cells[weekday][hour] = { count, wins, pnl }
    const cells = new Map();
    let minHour = 24, maxHour = -1;
    closed.forEach(r => {
        const day = getWallClockWeekday(r.date);
        const hour = getWallClockHour(r.date);
        if (isNaN(hour)) return;
        minHour = Math.min(minHour, hour);
        maxHour = Math.max(maxHour, hour);
        const key = `${day}_${hour}`;
        if (!cells.has(key)) cells.set(key, { count: 0, wins: 0, pnl: 0 });
        const cell = cells.get(key);
        cell.count += 1;
        if (r.status === 'WIN') cell.wins += 1;
        cell.pnl += r.returnAmount;
    });

    if (maxHour < 0) {
        container.innerHTML = '<div style="color: var(--text-muted); font-size: 0.8rem; text-align: center;">No closed trades yet.</div>';
        return;
    }

    const hours = [];
    for (let h = minHour; h <= maxHour; h++) hours.push(h);

    // Mon-Fri always shown; weekend rows only when they actually have trades
    // (crypto trades on Sat/Sun exist, forex ones don't).
    const days = [1, 2, 3, 4, 5];
    [6, 0].forEach(d => { if (hours.some(h => cells.has(`${d}_${h}`))) days.push(d); });

    const maxAbsPnl = Math.max(1, ...Array.from(cells.values()).map(c => Math.abs(c.pnl)));

    let html = `<div class="stats-heatmap-grid" style="grid-template-columns: 46px repeat(${hours.length}, 1fr);">`;
    html += '<div></div>' + hours.map(h => `<div class="stats-heatmap-hour-label">${formatHourLabel(h).replace(' ', '')}</div>`).join('');

    days.forEach(day => {
        html += `<div class="stats-heatmap-day-label">${WEEKDAY_LABELS[day].slice(0, 3)}</div>`;
        hours.forEach(hour => {
            const cell = cells.get(`${day}_${hour}`);
            if (!cell) {
                html += '<div class="stats-heatmap-cell empty"></div>';
                return;
            }
            const alpha = 0.18 + 0.62 * (Math.abs(cell.pnl) / maxAbsPnl);
            const color = cell.pnl > 0 ? `rgba(var(--win-rgb), ${alpha.toFixed(2)})`
                : cell.pnl < 0 ? `rgba(var(--loss-rgb), ${alpha.toFixed(2)})`
                : 'rgba(255, 255, 255, 0.08)';
            const winRate = Math.round((cell.wins / cell.count) * 100);
            html += `<div class="stats-heatmap-cell" style="background:${color};"
                data-heat-label="${WEEKDAY_LABELS[day]} ${formatHourLabel(hour)}"
                data-heat-count="${cell.count}" data-heat-winrate="${winRate}" data-heat-pnl="${cell.pnl}"></div>`;
        });
    });

    html += '</div>';
    container.innerHTML = html;
    bindHeatmapTooltip(container);
}

function bindHeatmapTooltip(container) {
    if (container.dataset.tooltipBound) return;
    container.dataset.tooltipBound = 'true';

    const tooltip = getStatsBarTooltip();

    container.addEventListener('mouseover', event => {
        const cell = event.target.closest('.stats-heatmap-cell[data-heat-label]');
        if (!cell) return;
        const pnl = parseFloat(cell.dataset.heatPnl);
        tooltip.innerHTML = `
            <div class="stats-bar-tooltip-label">${escapeHtml(cell.dataset.heatLabel)}</div>
            <div class="stats-bar-tooltip-value">
                <span class="stats-bar-tooltip-swatch ${pnl < 0 ? 'negative' : 'positive'}"></span>
                <span class="sensitive-value">${formatTotal(pnl)}</span>
            </div>
            <div class="stats-bar-tooltip-label">${cell.dataset.heatCount} trade(s) &middot; ${cell.dataset.heatWinrate}% win rate</div>`;
        tooltip.style.display = 'block';
    });

    container.addEventListener('mousemove', event => {
        const cell = event.target.closest('.stats-heatmap-cell[data-heat-label]');
        if (!cell || tooltip.style.display === 'none') return;
        tooltip.style.left = `${event.clientX + 14}px`;
        tooltip.style.top = `${event.clientY - 12}px`;
    });

    container.addEventListener('mouseout', event => {
        const cell = event.target.closest('.stats-heatmap-cell[data-heat-label]');
        const toCell = event.relatedTarget && event.relatedTarget.closest && event.relatedTarget.closest('.stats-heatmap-cell[data-heat-label]');
        if (cell && cell !== toCell) tooltip.style.display = 'none';
    });
}

// ---- Breakdown tables (sortable by column, click a header to toggle) ----
const statsTableSort = {
    tag: { key: 'trades', dir: 'desc' },
    symbol: { key: 'trades', dir: 'desc' },
    playbook: { key: 'trades', dir: 'desc' }
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
    const account = getActiveAccount();
    const tagDefs = (account.tagDefs) || [];
    const tagNameById = new Map(tagDefs.map(t => [t.id, t.name]));
    const tagById = new Map(tagDefs.map(t => [t.id, t]));
    const categoryNameById = new Map((typeof getTagCategoriesArray === 'function' ? getTagCategoriesArray(account) : []).map(c => [c.id, c.name]));

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
            const wins = tagTrades.filter(r => r.status === 'WIN').length;
            const winRate = tagTrades.length > 0 ? (wins / tagTrades.length) * 100 : 0;
            // Avg R only over trades that actually have a stop-loss (rMultiple
            // is null without one) - averaging in zeros would fake the number.
            const rValues = tagTrades.map(r => r.rMultiple).filter(v => v !== null);
            const avgR = rValues.length > 0 ? rValues.reduce((s, v) => s + v, 0) / rValues.length : null;
            const name = tagId ? (tagNameById.get(tagId) || 'Unknown Tag') : '--NO TAGS--';
            const tag = tagId ? tagById.get(tagId) : null;
            const categoryName = tag && tag.category ? (categoryNameById.get(tag.category) || '-') : '-';
            return { name, categoryName, trades: tagTrades.length, winRate, pnl, pnlPct, contributionPct, avgR: avgR === null ? -Infinity : avgR, avgRDisplay: avgR };
        });
    tagRows = sortStatsRows(tagRows, 'tag');

    setHtml('stats-tag-table-body', tagRows.map(row => `
        <tr>
            <td>${escapeHtml(row.name)}</td>
            <td>${escapeHtml(row.categoryName)}</td>
            <td>${row.trades}</td>
            <td>${row.winRate.toFixed(0)}%</td>
            <td class="${row.pnl < 0 ? 'value-negative' : 'value-positive'}">${formatTotal(row.pnl)}</td>
            <td class="${row.pnl < 0 ? 'value-negative' : 'value-positive'}">${row.pnlPct.toFixed(2)}%</td>
            <td class="${row.avgRDisplay !== null && row.avgRDisplay < 0 ? 'value-negative' : ''}">${row.avgRDisplay !== null ? row.avgRDisplay.toFixed(2) + 'R' : '-'}</td>
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

// ==== Weekly Review page ====
// A self-writing week-in-review: pick a week (defaults to the current one),
// see its grade, P&L, win rate vs your all-time baseline, best/worst day and
// trade, which tags made/cost money, and an expandable day-by-day breakdown.
// Reads ALL of the account's trades directly - deliberately NOT the Dashboard
// filter panel, since a review should reflect what actually happened.
let reviewWeekOffset = 0;

function shiftReviewWeek(delta) {
    reviewWeekOffset += delta;
    renderReviewPage();
}

function resetReviewWeek() {
    reviewWeekOffset = 0;
    renderReviewPage();
}

function selectReviewWeek(offset) {
    reviewWeekOffset = offset;
    renderReviewPage();
}

// The 7 wall-clock date strings (Mon..Sun) of the week `offset` weeks away
// from the current one. String-based on purpose: trade dates are wall-clock
// GMT+2 strings, so comparing "YYYY-MM-DD" prefixes avoids any timezone math.
function getReviewWeekDates(offset) {
    const now = new Date();
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayOfWeek = (monday.getDay() + 6) % 7; // Mon=0 .. Sun=6
    monday.setDate(monday.getDate() - dayOfWeek + offset * 7);

    const dates = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
        const pad = n => String(n).padStart(2, '0');
        dates.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    }
    return dates;
}

const REVIEW_MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatReviewDayLabel(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    const dayName = WEEKDAY_LABELS[date.getUTCDay()].slice(0, 3);
    return `${dayName} ${String(d).padStart(2, '0')} ${REVIEW_MONTH_ABBR[m - 1]}`;
}

// Composite 0-100 week score -> letter grade. Blends quality (win rate),
// efficiency (profit factor, capped so one monster week doesn't hide bad
// habits) and consistency (share of traded days that ended green).
function computeWeekGrade(week, wins, losses) {
    const winRate = week.length > 0 ? (wins.length / week.length) * 100 : 0;

    const grossProfit = wins.reduce((s, r) => s + r.returnAmount, 0);
    const grossLoss = Math.abs(losses.reduce((s, r) => s + r.returnAmount, 0));
    const pf = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 3 : 0);
    const pfScore = Math.min(pf, 3) / 3 * 100;

    const byDay = new Map();
    week.forEach(r => {
        const day = r.date.slice(0, 10);
        byDay.set(day, (byDay.get(day) || 0) + r.returnAmount);
    });
    const tradedDays = byDay.size;
    const greenDays = Array.from(byDay.values()).filter(v => v > 0).length;
    const dayScore = tradedDays > 0 ? (greenDays / tradedDays) * 100 : 0;

    const score = winRate * 0.4 + pfScore * 0.3 + dayScore * 0.3;
    let letter, cls;
    if (score >= 85) { letter = 'A+'; cls = 'grade-a'; }
    else if (score >= 70) { letter = 'A'; cls = 'grade-a'; }
    else if (score >= 55) { letter = 'B'; cls = 'grade-b'; }
    else if (score >= 40) { letter = 'C'; cls = 'grade-c'; }
    else { letter = 'D'; cls = 'grade-d'; }
    return { score: Math.round(score), letter, cls };
}

// Monday "YYYY-MM-DD" of the week a wall-clock trade date falls in - the
// grouping key for the weeks strip and the record-week check.
function reviewMondayKeyOf(dateStr) {
    const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    const shift = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - shift);
    const pad = n => String(n).padStart(2, '0');
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function reviewTile(label, icon, valueHtml, subHtml, countUp) {
    return `
        <div class="review-tile review-animate">
            <div class="review-tile-label"><i class="fa-solid ${icon}"></i> ${label}</div>
            <div class="review-tile-value sensitive-value"${countUp ? ` data-countup="${countUp.value}" data-countup-format="${countUp.format}"` : ''}>${valueHtml}</div>
            ${subHtml ? `<div class="review-tile-sub">${subHtml}</div>` : ''}
        </div>`;
}

// Count-up: tiles marked data-countup animate 0 -> final value on render.
// Skipped (values set instantly) when the user prefers reduced motion.
function animateReviewCountUps(container) {
    const els = container.querySelectorAll('[data-countup]');
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    els.forEach(el => {
        const target = parseFloat(el.dataset.countup);
        const format = el.dataset.countupFormat;
        const render = v => {
            if (format === 'money') el.textContent = formatTotal(v);
            else if (format === 'pct') el.textContent = `${Math.round(v)}%`;
            else el.textContent = v.toFixed(2);
        };
        const finish = () => {
            // Re-render the FINAL value through the original HTML (keeps the
            // win/loss color span that textContent updates flatten away).
            el.innerHTML = el.dataset.countupFinalHtml || el.innerHTML;
        };
        if (reduced || isNaN(target)) { return; }

        el.dataset.countupFinalHtml = el.innerHTML;
        const start = performance.now();
        const duration = 650;
        const step = now => {
            const t = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - t, 3);
            render(target * eased);
            if (t < 1) requestAnimationFrame(step);
            else finish();
        };
        requestAnimationFrame(step);
    });
}

// Last 12 weeks as clickable mini diverging bars - a quick "how have my
// weeks been trending" scrubber that doubles as navigation.
function buildReviewWeeksStrip(allClosed) {
    const byWeek = new Map();
    allClosed.forEach(r => {
        const key = reviewMondayKeyOf(r.date);
        if (!byWeek.has(key)) byWeek.set(key, { pnl: 0, count: 0 });
        const w = byWeek.get(key);
        w.pnl += r.returnAmount;
        w.count += 1;
    });

    const offsets = [];
    for (let o = -11; o <= 0; o++) offsets.push(o);

    const cells = offsets.map(o => {
        const monday = getReviewWeekDates(o)[0];
        const wk = byWeek.get(monday) || { pnl: 0, count: 0 };
        return { offset: o, monday, pnl: wk.pnl, count: wk.count };
    });

    const maxAbs = Math.max(1, ...cells.map(c => Math.abs(c.pnl)));

    return `
        <div class="review-weeks-strip review-animate" id="review-weeks-strip">
            ${cells.map(c => {
                const [y, m, d] = c.monday.split('-').map(Number);
                const heightPct = Math.round((Math.abs(c.pnl) / maxAbs) * 100);
                const barCls = c.pnl > 0 ? 'pos' : c.pnl < 0 ? 'neg' : 'flat';
                return `
                <div class="review-week-cell${c.offset === reviewWeekOffset ? ' selected' : ''}"
                     onclick="selectReviewWeek(${c.offset})"
                     data-heat-label="Week of ${String(d).padStart(2, '0')} ${REVIEW_MONTH_ABBR[m - 1]}"
                     data-heat-count="${c.count}" data-heat-pnl="${c.pnl}" data-heat-winrate="">
                    <div class="review-week-bar-track">
                        <div class="review-week-bar ${barCls}" style="height:${c.count > 0 ? Math.max(heightPct, 8) : 0}%;"></div>
                    </div>
                    <div class="review-week-cell-label">${String(d).padStart(2, '0')} ${REVIEW_MONTH_ABBR[m - 1]}</div>
                </div>`;
            }).join('')}
        </div>`;
}

// Cumulative P&L across the week's trades (oldest first) as an SVG area
// sparkline; every trade is a hoverable dot.
function buildReviewSparkline(week) {
    if (week.length < 2) return '';
    const ordered = week.slice().sort((a, b) => new Date(a.date) - new Date(b.date));

    let running = 0;
    const points = ordered.map(r => ({ row: r, cum: (running += r.returnAmount) }));
    const values = [0].concat(points.map(p => p.cum));

    const w = 900, h = 150, padX = 10, padY = 14;
    const min = Math.min(...values), max = Math.max(...values);
    const span = (max - min) || 1;
    const stepX = (w - padX * 2) / (values.length - 1);
    const toX = i => padX + i * stepX;
    const toY = v => padY + (h - padY * 2) * (1 - (v - min) / span);

    const lineCoords = values.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`);
    const areaPath = `M ${toX(0).toFixed(1)},${toY(0).toFixed(1)} L ${lineCoords.join(' L ')} L ${toX(values.length - 1).toFixed(1)},${h - padY} L ${toX(0).toFixed(1)},${h - padY} Z`;

    const finalUp = values[values.length - 1] >= 0;
    const tone = finalUp ? 'var(--win)' : 'var(--loss)';
    const gradId = 'review-spark-grad';
    const zeroY = toY(0).toFixed(1);

    const dots = points.map((p, i) => `
        <circle class="review-spark-dot" cx="${toX(i + 1).toFixed(1)}" cy="${toY(p.cum).toFixed(1)}" r="4"
            fill="${p.row.returnAmount >= 0 ? 'var(--win)' : 'var(--loss)'}" stroke="var(--bg-card)" stroke-width="2"
            data-heat-label="${escapeHtml(p.row.symbol)} &middot; ${formatReviewDayLabel(p.row.date.slice(0, 10))} ${typeof formatTradeTime === 'function' ? formatTradeTime(p.row.date) : ''}"
            data-heat-count="1" data-heat-winrate="" data-heat-pnl="${p.row.returnAmount}"
            onclick="openTradeViewModal(null, '${p.row.id}')"></circle>`).join('');

    return `
        <div class="stats-panel review-animate">
            <div class="stats-panel-title">WEEK EQUITY CURVE <span class="review-panel-hint">hover a dot for the trade, click to open it</span></div>
            <svg class="review-spark-svg" id="review-spark-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
                <defs>
                    <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="${tone}" stop-opacity="0.35"/>
                        <stop offset="100%" stop-color="${tone}" stop-opacity="0"/>
                    </linearGradient>
                </defs>
                <line x1="0" y1="${zeroY}" x2="${w}" y2="${zeroY}" stroke="rgba(255,255,255,0.12)" stroke-dasharray="4 4" stroke-width="1"/>
                <path d="${areaPath}" fill="url(#${gradId})"/>
                <polyline points="${lineCoords.join(' ')}" fill="none" stroke="${tone}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
                ${dots}
            </svg>
        </div>`;
}

function toggleReviewDay(headEl) {
    const row = headEl.closest('.review-day-row');
    if (row && row.querySelector('.review-day-trades')) row.classList.toggle('open');
}

// Weekly notes autosave: debounced so it isn't hitting Firestore per
// keystroke. Empty text is kept as '' (not deleted) on purpose - Firestore's
// merge would otherwise resurrect the old note from the previous save.
let reviewNotesSaveTimer = null;

function handleReviewNotesInput(textarea) {
    clearTimeout(reviewNotesSaveTimer);
    const statusEl = document.getElementById('review-notes-status');
    if (statusEl) statusEl.textContent = 'Saving...';

    reviewNotesSaveTimer = setTimeout(() => {
        const account = getActiveAccount();
        if (!account) return;
        if (!account.weeklyNotes) account.weeklyNotes = {};
        account.weeklyNotes[textarea.dataset.weekKey] = textarea.value;
        saveAccountsState();
        if (statusEl) {
            statusEl.textContent = 'Saved';
            setTimeout(() => { if (statusEl.textContent === 'Saved') statusEl.textContent = ''; }, 1600);
        }
    }, 600);
}

function renderReviewPage() {
    const content = document.getElementById('review-content');
    const weekLabel = document.getElementById('review-week-label');
    if (!content || !weekLabel) return;

    const weekDates = getReviewWeekDates(reviewWeekOffset);
    weekLabel.textContent = `${formatReviewDayLabel(weekDates[0])} - ${formatReviewDayLabel(weekDates[6])} ${weekDates[6].slice(0, 4)}`;
    const thisWeekBtn = document.getElementById('review-this-week-btn');
    if (thisWeekBtn) thisWeekBtn.classList.toggle('active', reviewWeekOffset === 0);

    const account = getActiveAccount();
    const allClosed = ((account && account.trades) || [])
        .map(computeTradeSummary)
        .filter(r => r.returnAmount !== null);

    const weekSet = new Set(weekDates);
    const week = allClosed.filter(r => weekSet.has(r.date.slice(0, 10)));

    const stripHtml = buildReviewWeeksStrip(allClosed);

    // Weekly notes: keyed by the week's Monday, stored on the account so
    // they save to Firestore with everything else. Available even on weeks
    // with no trades ("skipped this week - holiday" is a valid review note).
    const weekKey = weekDates[0];
    const noteText = (account && account.weeklyNotes && account.weeklyNotes[weekKey]) || '';
    const notesPanelHtml = `
        <div class="stats-panel review-animate">
            <div class="stats-panel-title">WEEKLY NOTES <span class="review-notes-status" id="review-notes-status"></span></div>
            <textarea class="review-notes-textarea" data-week-key="${weekKey}"
                placeholder="What worked? What didn't? What will you do differently next week?"
                oninput="handleReviewNotesInput(this)">${escapeHtml(noteText)}</textarea>
        </div>`;

    if (week.length === 0) {
        content.innerHTML = stripHtml
            + '<div class="review-empty">No closed trades this week. Use the arrows above - or click a bar in the strip - to look at another week.</div>'
            + notesPanelHtml;
        bindReviewTooltips();
        return;
    }

    // -- Headline numbers, with all-time baseline for context --
    const wins = week.filter(r => r.status === 'WIN');
    const losses = week.filter(r => r.status === 'LOSS');
    const netPnl = week.reduce((s, r) => s + r.returnAmount, 0);
    const winRate = (wins.length / week.length) * 100;

    const allWins = allClosed.filter(r => r.status === 'WIN');
    const allWinRate = allClosed.length > 0 ? (allWins.length / allClosed.length) * 100 : 0;
    const winRateDelta = winRate - allWinRate;

    const grossProfit = wins.reduce((s, r) => s + r.returnAmount, 0);
    const grossLoss = Math.abs(losses.reduce((s, r) => s + r.returnAmount, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);

    const grade = computeWeekGrade(week, wins, losses);

    // -- Record week? (best net P&L of any week with trades) --
    const weekTotals = new Map();
    allClosed.forEach(r => {
        const key = reviewMondayKeyOf(r.date);
        weekTotals.set(key, (weekTotals.get(key) || 0) + r.returnAmount);
    });
    const isRecordWeek = netPnl > 0 && netPnl >= Math.max(...weekTotals.values());

    // -- Per-day rollup --
    const byDay = new Map(weekDates.map(d => [d, { count: 0, pnl: 0, trades: [] }]));
    week.forEach(r => {
        const day = byDay.get(r.date.slice(0, 10));
        day.count += 1;
        day.pnl += r.returnAmount;
        day.trades.push(r);
    });

    const tradedDays = weekDates.filter(d => byDay.get(d).count > 0);
    const bestDay = tradedDays.slice().sort((a, b) => byDay.get(b).pnl - byDay.get(a).pnl)[0];
    const worstDay = tradedDays.slice().sort((a, b) => byDay.get(a).pnl - byDay.get(b).pnl)[0];

    const bestTrade = week.slice().sort((a, b) => b.returnAmount - a.returnAmount)[0];
    const worstTrade = week.slice().sort((a, b) => a.returnAmount - b.returnAmount)[0];

    // -- Tag rollup for the week --
    const tagDefs = (account.tagDefs) || [];
    const tagNameById = new Map(tagDefs.map(t => [t.id, t.name]));
    const byTag = new Map();
    week.forEach(r => {
        (r.tagIds || []).forEach(tagId => {
            if (!byTag.has(tagId)) byTag.set(tagId, { count: 0, pnl: 0 });
            const t = byTag.get(tagId);
            t.count += 1;
            t.pnl += r.returnAmount;
        });
    });
    const tagRows = Array.from(byTag.entries())
        .map(([tagId, t]) => ({ name: tagNameById.get(tagId) || 'Unknown Tag', count: t.count, pnl: t.pnl }))
        .sort((a, b) => b.pnl - a.pnl);

    // -- Auto-written takeaways --
    const takeaways = [];
    takeaways.push({
        icon: netPnl >= 0 ? 'fa-flag-checkered' : 'fa-flag',
        html: netPnl >= 0
            ? `Finished the week <strong class="value-positive sensitive-value">${formatTotal(netPnl)}</strong> up over ${week.length} trade(s).`
            : `Finished the week <strong class="value-negative sensitive-value">${formatTotal(netPnl)}</strong> down over ${week.length} trade(s).`
    });
    if (allClosed.length > week.length) {
        takeaways.push({
            icon: winRateDelta >= 0 ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down',
            html: winRateDelta >= 0
                ? `Win rate of <strong>${winRate.toFixed(0)}%</strong> ran <strong class="value-positive">${winRateDelta.toFixed(0)} points above</strong> your all-time ${allWinRate.toFixed(0)}%.`
                : `Win rate of <strong>${winRate.toFixed(0)}%</strong> ran <strong class="value-negative">${Math.abs(winRateDelta).toFixed(0)} points below</strong> your all-time ${allWinRate.toFixed(0)}%.`
        });
    }
    if (bestDay && byDay.get(bestDay).pnl > 0) {
        takeaways.push({ icon: 'fa-trophy', html: `Strongest day: <strong>${formatReviewDayLabel(bestDay)}</strong> (<span class="value-positive sensitive-value">${formatTotal(byDay.get(bestDay).pnl)}</span> over ${byDay.get(bestDay).count} trade(s)).` });
    }
    if (worstDay && byDay.get(worstDay).pnl < 0) {
        takeaways.push({ icon: 'fa-triangle-exclamation', html: `Toughest day: <strong>${formatReviewDayLabel(worstDay)}</strong> (<span class="value-negative sensitive-value">${formatTotal(byDay.get(worstDay).pnl)}</span> over ${byDay.get(worstDay).count} trade(s)).` });
    }
    const worstTag = tagRows[tagRows.length - 1];
    if (worstTag && worstTag.pnl < 0) {
        takeaways.push({ icon: 'fa-tag', html: `"<strong>${escapeHtml(worstTag.name)}</strong>" trades cost <span class="value-negative sensitive-value">${formatTotal(worstTag.pnl)}</span> this week - worth reviewing before next week.` });
    }
    const bestTag = tagRows[0];
    if (bestTag && bestTag.pnl > 0) {
        takeaways.push({ icon: 'fa-star', html: `"<strong>${escapeHtml(bestTag.name)}</strong>" was the best-working setup: <span class="value-positive sensitive-value">${formatTotal(bestTag.pnl)}</span> across ${bestTag.count} trade(s).` });
    }

    const pnlClass = netPnl < 0 ? 'value-negative' : 'value-positive';
    const pfDisplay = profitFactor === Infinity ? '&infin;' : profitFactor.toFixed(2);

    // -- Interactive day-by-day rows --
    const maxAbsDayPnl = Math.max(1, ...weekDates.map(d => Math.abs(byDay.get(d).pnl)));
    const dayRowsHtml = weekDates.map(d => {
        const day = byDay.get(d);
        const cls = day.pnl < 0 ? 'value-negative' : (day.pnl > 0 ? 'value-positive' : '');
        const barPct = day.count > 0 ? Math.max(6, Math.round((Math.abs(day.pnl) / maxAbsDayPnl) * 100)) : 0;
        const barCls = day.pnl > 0 ? 'pos' : day.pnl < 0 ? 'neg' : 'flat';
        const tradesHtml = day.trades
            .slice().sort((a, b) => new Date(a.date) - new Date(b.date))
            .map(r => `
                <div class="review-day-trade-line" onclick="event.stopPropagation(); openTradeViewModal(null, '${r.id}')">
                    <i class="fa-solid ${r.direction === 'long' ? 'fa-arrow-trend-up value-positive' : 'fa-arrow-trend-down value-negative'}"></i>
                    <span class="review-day-trade-time">${typeof formatTradeTime === 'function' ? formatTradeTime(r.date) : ''}</span>
                    <span class="review-day-trade-symbol">${escapeHtml(r.symbol)}</span>
                    <span class="review-day-trade-fill"></span>
                    <span class="${r.returnAmount < 0 ? 'value-negative' : 'value-positive'} sensitive-value">${formatTotal(r.returnAmount)}${r.rMultiple !== null ? ` <span class="review-day-trade-r">(${r.rMultiple.toFixed(1)}R)</span>` : ''}</span>
                    <i class="fa-solid fa-up-right-from-square review-day-trade-open"></i>
                </div>`).join('');
        return `
        <div class="review-day-row${day.count > 0 ? ' clickable' : ''}">
            <div class="review-day-head" ${day.count > 0 ? 'onclick="toggleReviewDay(this)"' : ''}>
                <span class="review-day-name">${formatReviewDayLabel(d)}</span>
                <span class="review-day-count">${day.count > 0 ? `${day.count} trade${day.count > 1 ? 's' : ''}` : '-'}</span>
                <span class="review-day-pnl ${cls} sensitive-value">${day.count > 0 ? formatTotal(day.pnl) : ''}</span>
                <span class="review-day-minibar"><span class="review-day-minibar-fill ${barCls}" style="width:${barPct}%"></span></span>
                ${day.count > 0 ? '<i class="fa-solid fa-chevron-right review-day-chevron"></i>' : '<span></span>'}
            </div>
            ${day.count > 0 ? `<div class="review-day-trades">${tradesHtml}</div>` : ''}
        </div>`;
    }).join('');

    const tagTableHtml = tagRows.length === 0
        ? '<div class="review-empty-inline">No tagged trades this week.</div>'
        : `<table class="stats-table">
            <thead><tr><th>Tag</th><th>Trades</th><th>P&L</th></tr></thead>
            <tbody>${tagRows.map(t => `
                <tr>
                    <td>${escapeHtml(t.name)}</td>
                    <td>${t.count}</td>
                    <td class="${t.pnl < 0 ? 'value-negative' : 'value-positive'} sensitive-value">${formatTotal(t.pnl)}</td>
                </tr>`).join('')}
            </tbody>
        </table>`;

    // Ring geometry: r=48 -> circumference ~301.6; offset animated after paint.
    const ringCircumference = 2 * Math.PI * 48;
    const ringTarget = ringCircumference * (1 - grade.score / 100);

    content.innerHTML = `
        ${stripHtml}

        <div class="review-hero">
            <div class="review-grade-card review-animate ${grade.cls}">
                <div class="review-grade-ring">
                    <svg viewBox="0 0 110 110">
                        <circle class="review-ring-bg" cx="55" cy="55" r="48"/>
                        <circle class="review-ring-fg" id="review-ring-fg" cx="55" cy="55" r="48"
                            stroke-dasharray="${ringCircumference.toFixed(1)}"
                            stroke-dashoffset="${ringCircumference.toFixed(1)}"
                            data-ring-target="${ringTarget.toFixed(1)}"/>
                    </svg>
                    <div class="review-grade-letter">${grade.letter}</div>
                </div>
                <div class="review-grade-title">WEEK GRADE</div>
                <div class="review-grade-sub">${grade.score}/100 &middot; win rate, profit factor & green days</div>
                ${isRecordWeek && allClosed.length > week.length ? '<div class="review-record-chip"><i class="fa-solid fa-trophy"></i> Best week on record</div>' : ''}
                <button type="button" class="review-share-week-btn" onclick="shareWeekToCommunity()" title="Post this week's grade and stats to the Community Trade Wall - percentages and R only, never dollar amounts">
                    <i class="fa-solid fa-share-nodes"></i> Share Week
                </button>
            </div>

            <div class="review-tiles">
                ${reviewTile('NET P&L', 'fa-sack-dollar', `<span class="${pnlClass}">${formatTotal(netPnl)}</span>`, `${week.length} closed trade(s)`, { value: netPnl, format: 'money' })}
                ${reviewTile('WIN RATE', 'fa-bullseye', `${winRate.toFixed(0)}%`, allClosed.length > week.length ? `all-time ${allWinRate.toFixed(0)}%` : '', { value: winRate, format: 'pct' })}
                ${reviewTile('PROFIT FACTOR', 'fa-scale-balanced', pfDisplay, `${wins.length}W / ${losses.length}L`, profitFactor === Infinity ? null : { value: profitFactor, format: 'num' })}
                ${reviewTile('BEST DAY', 'fa-trophy', bestDay ? `<span class="${byDay.get(bestDay).pnl < 0 ? 'value-negative' : 'value-positive'}">${formatTotal(byDay.get(bestDay).pnl)}</span>` : '-', bestDay ? formatReviewDayLabel(bestDay) : '')}
                ${reviewTile('WORST DAY', 'fa-cloud-rain', worstDay ? `<span class="${byDay.get(worstDay).pnl < 0 ? 'value-negative' : 'value-positive'}">${formatTotal(byDay.get(worstDay).pnl)}</span>` : '-', worstDay ? formatReviewDayLabel(worstDay) : '')}
                ${reviewTile('AVG PER TRADE', 'fa-chart-line', `<span class="${netPnl / week.length < 0 ? 'value-negative' : 'value-positive'}">${formatTotal(netPnl / week.length)}</span>`, 'net / trades', { value: netPnl / week.length, format: 'money' })}
            </div>
        </div>

        ${buildReviewSparkline(week)}

        <div class="review-notes-row">
            <div class="stats-panel review-animate">
                <div class="stats-panel-title">TAKEAWAYS</div>
                <ul class="review-takeaways">${takeaways.map(t => `<li><i class="fa-solid ${t.icon}"></i><span>${t.html}</span></li>`).join('')}</ul>
            </div>
            ${notesPanelHtml}
        </div>

        <div class="review-cols">
            <div class="stats-panel review-animate">
                <div class="stats-panel-title">DAY BY DAY <span class="review-panel-hint">click a day to see its trades</span></div>
                <div class="review-day-list">${dayRowsHtml}</div>
            </div>

            <div class="review-stack">
                <div class="stats-panel review-animate">
                    <div class="stats-panel-title">BEST / WORST TRADE <span class="review-panel-hint">click to open</span></div>
                    <div class="review-trade-line clickable" onclick="openTradeViewModal(null, '${bestTrade.id}')">
                        <i class="fa-solid fa-arrow-trend-up value-positive"></i>
                        <span>${escapeHtml(bestTrade.symbol)} &middot; ${formatReviewDayLabel(bestTrade.date.slice(0, 10))}</span>
                        <span class="${bestTrade.returnAmount < 0 ? 'value-negative' : 'value-positive'} sensitive-value">${formatTotal(bestTrade.returnAmount)}${bestTrade.rMultiple !== null ? ` (${bestTrade.rMultiple.toFixed(1)}R)` : ''}</span>
                    </div>
                    ${worstTrade !== bestTrade ? `
                    <div class="review-trade-line clickable" onclick="openTradeViewModal(null, '${worstTrade.id}')">
                        <i class="fa-solid fa-arrow-trend-down value-negative"></i>
                        <span>${escapeHtml(worstTrade.symbol)} &middot; ${formatReviewDayLabel(worstTrade.date.slice(0, 10))}</span>
                        <span class="${worstTrade.returnAmount < 0 ? 'value-negative' : 'value-positive'} sensitive-value">${formatTotal(worstTrade.returnAmount)}${worstTrade.rMultiple !== null ? ` (${worstTrade.rMultiple.toFixed(1)}R)` : ''}</span>
                    </div>` : ''}
                </div>

                <div class="stats-panel review-animate">
                    <div class="stats-panel-title">TAGS THIS WEEK</div>
                    ${tagTableHtml}
                </div>
            </div>
        </div>`;

    // Kick off the grade ring sweep + tile count-ups now the DOM exists.
    const ring = document.getElementById('review-ring-fg');
    if (ring) {
        const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduced) {
            ring.style.strokeDashoffset = ring.dataset.ringTarget;
        } else {
            requestAnimationFrame(() => requestAnimationFrame(() => {
                ring.style.strokeDashoffset = ring.dataset.ringTarget;
            }));
        }
    }
    animateReviewCountUps(content);
    bindReviewTooltips();
}

// One shared hover tooltip (same element the Stats charts use) for the weeks
// strip and the sparkline dots - both mark targets with data-heat-* attrs.
function bindReviewTooltips() {
    const content = document.getElementById('review-content');
    if (!content || content.dataset.tooltipBound) return;
    content.dataset.tooltipBound = 'true';

    const tooltip = getStatsBarTooltip();
    const selector = '.review-week-cell[data-heat-label], .review-spark-dot[data-heat-label]';

    content.addEventListener('mouseover', event => {
        const el = event.target.closest(selector);
        if (!el) return;
        const pnl = parseFloat(el.dataset.heatPnl);
        const count = el.dataset.heatCount;
        tooltip.innerHTML = `
            <div class="stats-bar-tooltip-label">${escapeHtml(el.dataset.heatLabel)}</div>
            <div class="stats-bar-tooltip-value">
                <span class="stats-bar-tooltip-swatch ${pnl < 0 ? 'negative' : 'positive'}"></span>
                <span class="sensitive-value">${formatTotal(pnl)}</span>
            </div>
            ${count ? `<div class="stats-bar-tooltip-label">${count} trade(s)</div>` : ''}`;
        tooltip.style.display = 'block';
    });

    content.addEventListener('mousemove', event => {
        const el = event.target.closest(selector);
        if (!el || tooltip.style.display === 'none') return;
        tooltip.style.left = `${event.clientX + 14}px`;
        tooltip.style.top = `${event.clientY - 12}px`;
    });

    content.addEventListener('mouseout', event => {
        const el = event.target.closest(selector);
        const toEl = event.relatedTarget && event.relatedTarget.closest && event.relatedTarget.closest(selector);
        if (el && el !== toEl) tooltip.style.display = 'none';
    });
}
