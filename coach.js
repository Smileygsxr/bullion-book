// ==== Coach: a rule-based "personal trainer" for your trading ====
// Reads ALL of the active account's trades (not the Dashboard filters - a
// coach should see everything), computes a set of behavioural and
// performance metrics, and turns them into: strengths, weaknesses, one
// focus area, and a measurable goal with steps you can accept and track.
// Goals persist on the account (Firestore/localStorage) until completed
// or abandoned.

const COACH_MIN_TRADES = 10;

// ---- Metric computation ----
function computeCoachMetrics() {
    const account = getActiveAccount();
    const allRows = ((account && account.trades) || []).map(computeTradeSummary);
    const closed = allRows
        .filter(r => r.returnAmount !== null)
        .sort((a, b) => new Date(a.date) - new Date(b.date));
    const wins = closed.filter(r => r.status === 'WIN');
    const losses = closed.filter(r => r.status === 'LOSS');

    const m = { closed, wins, losses, total: closed.length };
    if (closed.length === 0) return m;

    m.winRate = (wins.length / closed.length) * 100;
    m.grossProfit = wins.reduce((s, r) => s + r.returnAmount, 0);
    m.grossLoss = Math.abs(losses.reduce((s, r) => s + r.returnAmount, 0));
    m.profitFactor = m.grossLoss > 0 ? m.grossProfit / m.grossLoss : (m.grossProfit > 0 ? Infinity : 0);
    m.netPnl = closed.reduce((s, r) => s + r.returnAmount, 0);

    m.avgWin = wins.length > 0 ? average(wins.map(r => r.returnAmount)) : 0;
    m.avgLoss = losses.length > 0 ? Math.abs(average(losses.map(r => r.returnAmount))) : 0;
    m.winLossRatio = m.avgLoss > 0 ? m.avgWin / m.avgLoss : (m.avgWin > 0 ? 2 : 0);

    // Hold-time asymmetry: sitting in losers longer than winners is the
    // classic "hope is not a strategy" pattern
    m.avgWinHold = wins.length > 0 ? average(wins.map(r => r.holdSeconds)) : 0;
    m.avgLossHold = losses.length > 0 ? average(losses.map(r => r.holdSeconds)) : 0;
    m.holdAsymmetry = m.avgWinHold > 0 ? m.avgLossHold / m.avgWinHold : 0;

    // Stop-loss discipline: without a stop there's no R, no plan
    m.slCount = closed.filter(r => r.rMultiple !== null).length;
    m.slPct = (m.slCount / closed.length) * 100;

    // Revenge trading: trades opened within 30 minutes of a closed loss
    const revenge = [];
    for (let i = 1; i < closed.length; i++) {
        const prev = closed[i - 1];
        if (prev.status !== 'LOSS') continue;
        const gapMinutes = (new Date(closed[i].date) - new Date(prev.date)) / 60000;
        if (gapMinutes >= 0 && gapMinutes <= 30) revenge.push(closed[i]);
    }
    m.revengeCount = revenge.length;
    m.revengeWinRate = revenge.length > 0 ? (revenge.filter(r => r.status === 'WIN').length / revenge.length) * 100 : null;
    m.revengePnl = revenge.reduce((s, r) => s + r.returnAmount, 0);

    // Overtrading: heavy days (2x the median trade count) vs normal days
    const byDay = new Map();
    closed.forEach(r => {
        const day = r.date.slice(0, 10);
        if (!byDay.has(day)) byDay.set(day, []);
        byDay.get(day).push(r);
    });
    const dayCounts = Array.from(byDay.values()).map(list => list.length).sort((a, b) => a - b);
    const medianCount = dayCounts[Math.floor(dayCounts.length / 2)] || 1;
    const heavyDays = Array.from(byDay.values()).filter(list => list.length > Math.max(2, medianCount * 2));
    m.heavyDayCount = heavyDays.length;
    m.heavyDayPnl = heavyDays.reduce((s, list) => s + list.reduce((s2, r) => s2 + r.returnAmount, 0), 0);
    m.tradedDayCount = byDay.size;
    m.greenDayPct = byDay.size > 0
        ? (Array.from(byDay.values()).filter(list => list.reduce((s, r) => s + r.returnAmount, 0) > 0).length / byDay.size) * 100
        : 0;

    // Best/worst hour buckets (5+ trades to count)
    const hourBuckets = new Map();
    closed.forEach(r => {
        const h = getWallClockHour(r.date);
        if (!hourBuckets.has(h)) hourBuckets.set(h, []);
        hourBuckets.get(h).push(r);
    });
    let worstHour = null, worstHourPnl = 0, bestHour = null, bestHourPnl = 0;
    hourBuckets.forEach((list, h) => {
        if (list.length < 5) return;
        const pnl = list.reduce((s, r) => s + r.returnAmount, 0);
        if (pnl < worstHourPnl) { worstHourPnl = pnl; worstHour = h; }
        if (pnl > bestHourPnl) { bestHourPnl = pnl; bestHour = h; }
    });
    m.worstHour = worstHour; m.worstHourPnl = worstHourPnl;
    m.bestHour = bestHour; m.bestHourPnl = bestHourPnl;

    // Tagging discipline + best/worst tag (3+ trades)
    m.taggedPct = (closed.filter(r => r.tagIds && r.tagIds.length > 0).length / closed.length) * 100;
    const tagDefs = (account.tagDefs) || [];
    const tagNameById = new Map(tagDefs.map(t => [t.id, t.name]));
    const tagBuckets = new Map();
    closed.forEach(r => (r.tagIds || []).forEach(id => {
        if (!tagBuckets.has(id)) tagBuckets.set(id, []);
        tagBuckets.get(id).push(r);
    }));
    let worstTag = null, worstTagPnl = 0, bestTag = null, bestTagPnl = 0;
    tagBuckets.forEach((list, id) => {
        if (list.length < 3) return;
        const pnl = list.reduce((s, r) => s + r.returnAmount, 0);
        if (pnl < worstTagPnl) { worstTagPnl = pnl; worstTag = tagNameById.get(id) || 'Unknown'; }
        if (pnl > bestTagPnl) { bestTagPnl = pnl; bestTag = tagNameById.get(id) || 'Unknown'; }
    });
    m.worstTag = worstTag; m.worstTagPnl = worstTagPnl;
    m.bestTag = bestTag; m.bestTagPnl = bestTagPnl;

    // Drawdown vs profits (same walk as the Pro Score)
    let cumulative = 0, peak = 0, maxDrawdown = 0;
    closed.forEach(r => {
        cumulative += r.returnAmount;
        peak = Math.max(peak, cumulative);
        maxDrawdown = Math.max(maxDrawdown, peak - cumulative);
    });
    m.maxDrawdown = maxDrawdown;
    m.drawdownRatio = m.grossProfit > 0 ? maxDrawdown / m.grossProfit : 1;

    m.guardrailsSet = typeof appSettings !== 'undefined'
        && ((parseFloat(appSettings.maxDailyLoss) || 0) > 0 || (parseInt(appSettings.maxDailyTrades, 10) || 0) > 0);

    return m;
}

// ---- Findings rules: each returns null (not applicable) or a finding ----
// { id, type: 'strength'|'weakness', severity: 1-3, icon, title, detail }
function computeCoachFindings(m) {
    const findings = [];
    const push = f => { if (f) findings.push(f); };
    const pct = v => `${v.toFixed(0)}%`;

    // Win rate
    if (m.winRate >= 55) push({ id: 'winrate', type: 'strength', severity: 2, icon: 'fa-bullseye', title: `Solid ${pct(m.winRate)} win rate`, detail: 'You pick your battles well - more than half your trades land green. Protect this by staying selective.' });
    else if (m.winRate < 40) push({ id: 'winrate', type: 'weakness', severity: 2, icon: 'fa-bullseye', title: `Win rate is ${pct(m.winRate)}`, detail: 'Under 40% of trades win. That can still be profitable with big winners, but combined with average-sized wins it bleeds. Fewer, higher-conviction entries.' });

    // Win/loss size ratio
    if (m.wins.length >= 5 && m.losses.length >= 5) {
        if (m.winLossRatio >= 1.5) push({ id: 'ratio', type: 'strength', severity: 2, icon: 'fa-scale-balanced', title: `Winners ${m.winLossRatio.toFixed(1)}x your losers`, detail: `Average win ${formatTotal(m.avgWin)} vs average loss ${formatTotal(m.avgLoss)} - healthy risk/reward that forgives losing streaks.` });
        else if (m.winLossRatio < 1) push({ id: 'ratio', type: 'weakness', severity: 3, icon: 'fa-scale-unbalanced', title: 'Your losers outweigh your winners', detail: `Average win ${formatTotal(m.avgWin)} vs average loss ${formatTotal(m.avgLoss)}. Every loss needs more than one win just to recover - either cut losses sooner or hold winners longer.` });
    }

    // Hold asymmetry
    if (m.wins.length >= 5 && m.losses.length >= 5 && m.avgWinHold > 0) {
        if (m.holdAsymmetry >= 2) push({ id: 'hold', type: 'weakness', severity: 3, icon: 'fa-hourglass-half', title: `You sit in losers ${m.holdAsymmetry.toFixed(1)}x longer`, detail: `Winners held ~${formatHoldDuration(m.avgWinHold)}, losers ~${formatHoldDuration(m.avgLossHold)}. Holding and hoping is how small losses become account-movers.` });
        else if (m.holdAsymmetry > 0 && m.holdAsymmetry <= 1) push({ id: 'hold', type: 'strength', severity: 2, icon: 'fa-scissors', title: 'You cut losers fast', detail: `Losers are closed as fast or faster than winners (${formatHoldDuration(m.avgLossHold)} vs ${formatHoldDuration(m.avgWinHold)}) - textbook discipline.` });
    }

    // Stop-loss discipline
    if (m.slPct >= 80) push({ id: 'stops', type: 'strength', severity: 1, icon: 'fa-shield-halved', title: `${pct(m.slPct)} of trades have a stop-loss`, detail: 'Nearly every trade has defined risk, which is why your R-multiples are meaningful. Keep it at 100%.' });
    else if (m.slPct < 50) push({ id: 'stops', type: 'weakness', severity: 2, icon: 'fa-shield-halved', title: `Only ${pct(m.slPct)} of trades have a stop-loss`, detail: 'Without a stop there is no defined risk, no R-multiple, and no way to size positions consistently. This is the cheapest fix on this list.' });

    // Revenge trading
    if (m.revengeCount >= 5 && m.revengeWinRate !== null && m.revengeWinRate < m.winRate - 12) {
        push({ id: 'revenge', type: 'weakness', severity: 3, icon: 'fa-fire', title: 'Revenge trades are burning you', detail: `${m.revengeCount} trades were opened within 30 minutes of a loss - they win only ${pct(m.revengeWinRate)} (vs your usual ${pct(m.winRate)}) and total ${formatTotal(m.revengePnl)}. The next trade after a loss should be your MOST selective, not your fastest.` });
    } else if (m.revengeCount >= 5 && m.revengeWinRate !== null && m.revengeWinRate >= m.winRate) {
        push({ id: 'revenge', type: 'strength', severity: 1, icon: 'fa-snowflake', title: 'You stay cool after losses', detail: `Trades taken soon after a loss perform as well as your normal trades (${pct(m.revengeWinRate)} win rate) - tilt isn't in your vocabulary.` });
    }

    // Overtrading
    if (m.heavyDayCount >= 3 && m.heavyDayPnl < 0) {
        push({ id: 'overtrade', type: 'weakness', severity: 2, icon: 'fa-gauge-high', title: 'Heavy days cost you money', detail: `${m.heavyDayCount} day(s) with well above your usual trade count total ${formatTotal(m.heavyDayPnl)}. More trades has meant worse results - quality over quantity.` });
    }

    // Time-of-day edges
    if (m.bestHour !== null && m.bestHourPnl > 0) {
        push({ id: 'besthour', type: 'strength', severity: 1, icon: 'fa-clock', title: `${formatHourLabel(m.bestHour)} is your power hour`, detail: `${formatTotal(m.bestHourPnl)} earned in the ${formatHourLabel(m.bestHour)} hour. Consider concentrating your trading around the windows where you demonstrably have an edge.` });
    }
    if (m.worstHour !== null && m.worstHourPnl < 0) {
        push({ id: 'worsthour', type: 'weakness', severity: 2, icon: 'fa-clock', title: `${formatHourLabel(m.worstHour)} keeps taking from you`, detail: `${formatTotal(m.worstHourPnl)} lost in the ${formatHourLabel(m.worstHour)} hour. Check the P&L heatmap - if there's no edge there, simply stop trading that window.` });
    }

    // Tags
    if (m.bestTag && m.bestTagPnl > 0) push({ id: 'besttag', type: 'strength', severity: 1, icon: 'fa-tag', title: `"${m.bestTag}" is your best setup`, detail: `${formatTotal(m.bestTagPnl)} from trades tagged "${m.bestTag}". This is your bread and butter - trade more of THIS and less of everything else.` });
    if (m.worstTag && m.worstTagPnl < 0) push({ id: 'worsttag', type: 'weakness', severity: 2, icon: 'fa-tag', title: `"${m.worstTag}" trades keep losing`, detail: `${formatTotal(m.worstTagPnl)} lost on trades tagged "${m.worstTag}". Either fix the entry criteria for this setup or retire it.` });

    // Tagging discipline
    if (m.taggedPct < 30) push({ id: 'tagging', type: 'weakness', severity: 1, icon: 'fa-pen', title: `Only ${pct(m.taggedPct)} of trades are tagged`, detail: 'Untagged trades give you no feedback loop - you can\'t see which setups work if trades aren\'t labeled. Tag every trade, even just "A-setup" vs "impulse".' });
    else if (m.taggedPct >= 80) push({ id: 'tagging', type: 'strength', severity: 1, icon: 'fa-pen', title: 'Excellent journaling discipline', detail: `${pct(m.taggedPct)} of trades are tagged - your data is rich enough to actually learn from.` });

    // Drawdown
    if (m.drawdownRatio <= 0.3 && m.grossProfit > 0) push({ id: 'drawdown', type: 'strength', severity: 2, icon: 'fa-chart-line', title: 'Shallow drawdowns', detail: `Your worst equity dip (${formatTotal(m.maxDrawdown)}) is small next to your gross profits - losing streaks don't spiral.` });
    else if (m.drawdownRatio >= 0.7) push({ id: 'drawdown', type: 'weakness', severity: 3, icon: 'fa-arrow-trend-down', title: 'Drawdowns run deep', detail: `Your worst dip (${formatTotal(m.maxDrawdown)}) eats most of what you make. Cap the damage: smaller size after losses and a hard daily stop.` });

    // Guardrails
    if (!m.guardrailsSet) push({ id: 'guardrails', type: 'weakness', severity: 1, icon: 'fa-hand', title: 'No risk guardrails set', detail: 'You haven\'t set a Max Daily Loss or Max Trades Per Day (Settings → Account Settings). A hard, pre-committed limit beats in-the-moment willpower every time.' });

    // Green day consistency
    if (m.tradedDayCount >= 10 && m.greenDayPct >= 60) push({ id: 'greendays', type: 'strength', severity: 2, icon: 'fa-calendar-check', title: `${pct(m.greenDayPct)} of your days end green`, detail: 'Day-to-day consistency is the hardest thing in trading, and you have it.' });

    return findings;
}

// ---- Goal templates: primary weakness -> measurable goal ----
const COACH_GOALS = {
    hold: {
        title: 'Cut losers as fast as you cut winners',
        why: 'You hold losing trades much longer than winners - the single most expensive habit in trading.',
        targetLabel: 'Avg loser hold ≤ avg winner hold over your next 20 closed trades',
        steps: ['Set a stop-loss on every trade BEFORE entry - no exceptions', 'When price hits the stop, exit - never "give it one more candle"', 'If a trade goes nowhere in 2x your usual winner hold time, close it', 'Review each loser in Trade View: mark the exact candle you SHOULD have exited']
    },
    ratio: {
        title: 'Make winners bigger than losers',
        why: 'Your average loss outweighs your average win, so the math is against you even when you win often.',
        targetLabel: 'Avg win ≥ 1.2x avg loss over your next 20 closed trades',
        steps: ['Only take setups with at least 2:1 reward-to-risk to your target', 'Move your stop to breakeven once the trade is 1R in profit', 'Stop taking profit at the first small wobble - let the chart prove the move is over', 'Check MAE/MFE on Stats to see how much profit you currently leave behind']
    },
    revenge: {
        title: 'Break the revenge-trading loop',
        why: 'Trades opened right after a loss perform far worse than your normal trades.',
        targetLabel: 'Zero trades within 30 minutes of a loss over your next 20 trades',
        steps: ['After ANY losing trade, stand up and walk away for 30 minutes', 'Write one line in a Day Note about why the loss happened before re-entering', 'Set Max Trades Per Day in Settings as a hard backstop', 'If you feel the urge to "win it back", close the platform for the day']
    },
    stops: {
        title: 'Define risk on every single trade',
        why: 'Most of your trades have no stop-loss, which means no plan, no R-multiple, and unbounded risk.',
        targetLabel: 'Stop-loss set on 100% of your next 20 trades',
        steps: ['Decide the invalidation price BEFORE clicking buy/sell', 'Enter the stop in the trade\'s Target/Stop-Loss fields when logging it', 'Size the position so hitting the stop costs a fixed small % of account', 'Review your Avg R on Stats weekly once the data flows']
    },
    winrate: {
        title: 'Raise trade quality',
        why: 'Too few trades are winning - the edge is being spread over too many mediocre entries.',
        targetLabel: 'Win rate ≥ 50% over your next 20 closed trades',
        steps: ['Write down your A-setup checklist and tag every trade that matches it', 'Skip any trade that doesn\'t tick every box - no "close enough"', 'Trade only your historically best hours (see the P&L heatmap)', 'Max 3 trades per day until the win rate stabilises']
    },
    drawdown: {
        title: 'Cap the drawdowns',
        why: 'Your worst losing streaks dig holes that eat most of your profits.',
        targetLabel: 'No losing streak deeper than 3R over your next 20 trades',
        steps: ['Set a Max Daily Loss in Settings and honor it like a margin call', 'After 2 consecutive losses, halve your position size', 'After 3 consecutive losses, done for the day - no exceptions', 'Start each week by reviewing the Weekly Review grade before trading']
    },
    overtrade: {
        title: 'Trade less, earn more',
        why: 'Your heaviest trading days are your worst - volume is replacing selectivity.',
        targetLabel: 'No more than 3 trades per day over the next 2 weeks',
        steps: ['Set Max Trades Per Day = 3 in Settings (the banner will hold you to it)', 'Before each entry ask: "would I show this trade on the Community wall?"', 'When you hit 3 trades, close the platform - green or red', 'Journal one line per skipped B-grade setup; review them weekly']
    },
    worsttag: {
        title: 'Retire your losing setup',
        why: 'One tagged setup keeps costing money - cutting it is instant P&L improvement.',
        targetLabel: 'Zero trades on your worst-performing tag for the next 2 weeks',
        steps: ['Check Stats → Tag table and confirm which tag bleeds the most', 'Ban that setup for 2 weeks - no exceptions, tag discipline continues', 'Re-review its past trades in Trade View: what did the losers share?', 'Only re-admit the setup with ONE fixed, written entry rule']
    },
    worsthour: {
        title: 'Cut your worst hour',
        why: 'One specific hour of the day consistently takes money from you.',
        targetLabel: 'Zero trades in your worst hour for the next 2 weeks',
        steps: ['Confirm the hour on the Stats P&L heatmap', 'Block it out: no entries during that window, even "perfect" setups', 'Use the window for review instead: yesterday\'s trades in Trade View', 'After 2 weeks, compare your win rate with and without that hour']
    },
    tagging: {
        title: 'Tag everything for 2 weeks',
        why: 'Without labels on trades, none of the setup analytics can help you improve.',
        targetLabel: '100% of trades tagged over the next 2 weeks',
        steps: ['Create 3-5 simple tags: your setups plus "impulse"', 'Tag at entry time via the Journal tab - not in a weekend batch', 'Be honest: if it wasn\'t a planned setup, tag it "impulse"', 'After 2 weeks, open Stats → Tag table and meet your real edge']
    },
    guardrails: {
        title: 'Install your safety net',
        why: 'Pre-committed limits beat in-the-moment willpower - you currently have none set.',
        targetLabel: 'Guardrails set and never breached for 2 weeks',
        steps: ['Set Max Daily Loss to roughly 2x your average daily loss (Settings)', 'Set Max Trades Per Day to your median day + 1', 'When the red banner appears, stop - that\'s the whole system', 'Raise the limits only after 2 clean weeks, never mid-day']
    }
};

// ---- Rendering ----
function renderCoachPage() {
    const content = document.getElementById('coach-content');
    if (!content) return;

    const m = computeCoachMetrics();

    if (m.total < COACH_MIN_TRADES) {
        content.innerHTML = `
            <div class="community-empty">
                <i class="fa-solid fa-dumbbell"></i>
                <h3>Your coach needs more film to study</h3>
                <p>Log at least ${COACH_MIN_TRADES} closed trades (you have ${m.total}) and this page will break down your strengths, weaknesses, and build you a training plan.</p>
            </div>`;
        return;
    }

    const findings = computeCoachFindings(m);
    const strengths = findings.filter(f => f.type === 'strength').sort((a, b) => b.severity - a.severity);
    const weaknesses = findings.filter(f => f.type === 'weakness').sort((a, b) => b.severity - a.severity);
    const focus = weaknesses.find(w => COACH_GOALS[w.id]) || weaknesses[0] || null;

    // Fitness score: blend of performance (Pro Score ingredients) + discipline
    const proMetrics = computeProScoreMetrics(m.closed, m.wins, m.losses);
    const performanceScore = average(proMetrics.map(x => x.value));
    const disciplineScore = Math.min(100, m.slPct * 0.4 + m.taggedPct * 0.3 + (m.guardrailsSet ? 30 : 0));
    const fitness = Math.round(performanceScore * 0.65 + disciplineScore * 0.35);
    const fitnessTone = fitness >= 70 ? 'var(--win)' : fitness >= 45 ? 'var(--accent-gold)' : 'var(--loss)';
    const fitnessWord = fitness >= 80 ? 'Elite shape' : fitness >= 65 ? 'Strong form' : fitness >= 45 ? 'Work in progress' : 'Training camp needed';

    const findingCard = f => `
        <div class="coach-finding ${f.type}">
            <i class="fa-solid ${f.icon}"></i>
            <div class="coach-finding-body">
                <span class="coach-finding-title">${f.title}</span>
                <span class="coach-finding-detail">${f.detail}</span>
            </div>
        </div>`;

    content.innerHTML = `
        <div class="coach-hero review-animate">
            <div class="coach-fitness" style="color:${fitnessTone}">
                <div class="coach-fitness-num sensitive-value">${fitness}</div>
                <div class="coach-fitness-label">TRADER FITNESS</div>
                <div class="coach-fitness-word">${fitnessWord}</div>
            </div>
            <div class="coach-hero-text">
                <h2><i class="fa-solid fa-dumbbell"></i> Coach's read on your last ${m.total} trades</h2>
                <p>Fitness blends performance (win rate, profit factor, drawdowns - 65%) with discipline (stops, tagging, guardrails - 35%).
                ${strengths.length} strength${strengths.length === 1 ? '' : 's'}, ${weaknesses.length} thing${weaknesses.length === 1 ? '' : 's'} to work on.
                ${focus ? 'Your training focus is below.' : 'No major leaks found - keep doing what you\'re doing.'}</p>
            </div>
            <div class="coach-bull" title="Stay golden. Stay bullish.">
                <img src="images/golden-bull.png" alt="Golden bull"
                     onerror="this.closest('.coach-bull').style.display='none'">
            </div>
        </div>

        <div class="coach-cols">
            <div class="stats-panel review-animate">
                <div class="stats-panel-title"><i class="fa-solid fa-medal coach-title-icon win"></i> STRENGTHS</div>
                ${strengths.length > 0 ? strengths.map(findingCard).join('') : '<p class="mae-mfe-note">Nothing stands out yet - strengths show up as your sample grows.</p>'}
            </div>
            <div class="stats-panel review-animate">
                <div class="stats-panel-title"><i class="fa-solid fa-triangle-exclamation coach-title-icon loss"></i> WEAK POINTS</div>
                ${weaknesses.length > 0 ? weaknesses.map(findingCard).join('') : '<p class="mae-mfe-note">No leaks detected. Seriously - well done.</p>'}
            </div>
        </div>

        ${renderCoachGoalSection(m, focus)}`;
}

// ---- Goal section: active goal w/ progress, or suggestion from focus ----
function renderCoachGoalSection(m, focus) {
    const account = getActiveAccount();
    const goal = account.coachGoal || null;

    if (goal) {
        // Progress: closed trades dated after acceptance
        const since = m.closed.filter(r => new Date(r.date).getTime() >= goal.acceptedAt);
        const horizon = goal.horizonTrades || 20;
        const progressPct = Math.min(100, Math.round((since.length / horizon) * 100));
        const stepsHtml = goal.steps.map((s, i) => `
            <label class="coach-step${s.done ? ' done' : ''}">
                <input type="checkbox" ${s.done ? 'checked' : ''} onchange="toggleCoachStep(${i}, this.checked)">
                <span>${s.text}</span>
            </label>`).join('');
        const stepsDone = goal.steps.filter(s => s.done).length;

        return `
        <div class="stats-panel coach-goal-panel review-animate">
            <div class="stats-panel-title"><i class="fa-solid fa-flag-checkered coach-title-icon gold"></i> ACTIVE GOAL</div>
            <h3 class="coach-goal-title">${goal.title}</h3>
            <p class="coach-goal-why">${goal.why}</p>
            <div class="coach-goal-target"><i class="fa-solid fa-crosshairs"></i> ${goal.targetLabel}</div>

            <div class="coach-goal-progress">
                <div class="coach-goal-progress-track"><div class="coach-goal-progress-fill" style="width:${progressPct}%"></div></div>
                <span class="coach-goal-progress-label">${since.length}/${horizon} trades since accepting &middot; ${stepsDone}/${goal.steps.length} steps done</span>
            </div>

            <div class="coach-steps">${stepsHtml}</div>

            <div class="coach-goal-actions">
                ${since.length >= horizon || stepsDone === goal.steps.length
                    ? '<button type="button" class="news-tab coach-goal-complete" onclick="completeCoachGoal()"><i class="fa-solid fa-trophy"></i> Complete goal</button>'
                    : ''}
                <button type="button" class="news-tab coach-goal-abandon" onclick="abandonCoachGoal()"><i class="fa-solid fa-xmark"></i> Abandon</button>
            </div>
        </div>`;
    }

    if (!focus || !COACH_GOALS[focus.id]) {
        return `
        <div class="stats-panel coach-goal-panel review-animate">
            <div class="stats-panel-title"><i class="fa-solid fa-flag-checkered coach-title-icon gold"></i> YOUR NEXT GOAL</div>
            <p class="mae-mfe-note">No obvious training goal right now - keep logging trades and check back as your data grows.</p>
        </div>`;
    }

    const template = COACH_GOALS[focus.id];
    return `
    <div class="stats-panel coach-goal-panel coach-goal-suggested review-animate">
        <div class="stats-panel-title"><i class="fa-solid fa-flag-checkered coach-title-icon gold"></i> SUGGESTED GOAL <span class="review-panel-hint">based on your #1 weak point</span></div>
        <h3 class="coach-goal-title">${template.title}</h3>
        <p class="coach-goal-why">${template.why}</p>
        <div class="coach-goal-target"><i class="fa-solid fa-crosshairs"></i> ${template.targetLabel}</div>
        <div class="coach-steps">
            ${template.steps.map(s => `<div class="coach-step preview"><i class="fa-solid fa-circle-check"></i><span>${s}</span></div>`).join('')}
        </div>
        <div class="coach-goal-actions">
            <button type="button" class="news-tab coach-goal-accept" onclick="acceptCoachGoal('${focus.id}')"><i class="fa-solid fa-handshake"></i> Accept this goal</button>
        </div>
    </div>`;
}

function acceptCoachGoal(goalId) {
    const template = COACH_GOALS[goalId];
    if (!template) return;
    const account = getActiveAccount();
    account.coachGoal = {
        id: goalId,
        title: template.title,
        why: template.why,
        targetLabel: template.targetLabel,
        horizonTrades: 20,
        acceptedAt: Date.now(),
        steps: template.steps.map(text => ({ text, done: false }))
    };
    saveAccountsState();
    renderCoachPage();
}

function toggleCoachStep(index, done) {
    const account = getActiveAccount();
    if (!account.coachGoal || !account.coachGoal.steps[index]) return;
    account.coachGoal.steps[index].done = done;
    saveAccountsState();
    renderCoachPage();
}

function completeCoachGoal() {
    const account = getActiveAccount();
    if (!account.coachGoal) return;
    account.coachGoal = null;
    saveAccountsState();
    renderCoachPage();
    if (typeof communityToast === 'function') communityToast('Goal completed - your coach is proud. New focus below.');
}

function abandonCoachGoal() {
    showConfirmDialog({
        title: 'Abandon this goal?',
        body: 'Progress and checked steps will be lost. Your coach will suggest a new goal based on your current weak points.',
        confirmText: 'Yes, abandon it',
        onConfirm: () => {
            const account = getActiveAccount();
            account.coachGoal = null;
            saveAccountsState();
            renderCoachPage();
        }
    });
}

// Easter egg: the bull stays still until you hover the sidebar's coffee
// button - then it charges. (Delegated listeners so it works even though
// the bull is re-rendered with the page.)
document.addEventListener('mouseover', event => {
    if (!event.target.closest || !event.target.closest('.sidebar-support-btn')) return;
    document.querySelectorAll('.coach-bull').forEach(el => el.classList.add('charging'));
});
document.addEventListener('mouseout', event => {
    if (!event.target.closest || !event.target.closest('.sidebar-support-btn')) return;
    if (event.relatedTarget && event.relatedTarget.closest && event.relatedTarget.closest('.sidebar-support-btn')) return;
    document.querySelectorAll('.coach-bull').forEach(el => el.classList.remove('charging'));
});
