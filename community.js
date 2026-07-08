// ==== Community: Trade Wall + opt-in weekly leaderboard ====
// Shared Firestore collections (rules in the project README/setup notes):
//   communityShares/{id}        - one card per shared trade or shared week
//   communityLeaderboard/{uid_weekKey} - one opt-in entry per user per week
//
// Privacy by design: NOTHING here ever contains dollar amounts or account
// balances - only symbols, percentages, R-multiples, win rates and grades.
// Sharing is always an explicit user action (a "Share" button), never automatic.

let communityTab = 'wall';
let leaderboardMetric = 'totalR';
let leaderboardWeekOffset = 0; // 0 = this week, -1 = last week
let communityWallCache = null;

// ---- Small shared helpers ----

// Monday of the week `offset` weeks from now, as "YYYY-MM-DD" (local time,
// same convention as the Weekly Review page).
function communityWeekKey(offset) {
    const now = new Date();
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) + offset * 7);
    const pad = n => String(n).padStart(2, '0');
    return `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
}

function communityTimeAgo(ms) {
    const s = Math.max(1, Math.floor((Date.now() - ms) / 1000));
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d ago`;
    return `${Math.floor(d / 7)}w ago`;
}

function communityDisplayName() {
    const user = auth.currentUser;
    if (!user) return 'Trader';
    return user.displayName || (user.email ? user.email.split('@')[0] : 'Trader');
}

// Avatar: only real http(s) photo URLs are stored/shown (never data-URLs -
// they'd bloat every card read). Fallback: colored initial derived from name.
function communityAvatarHtml(name, photoURL) {
    if (photoURL && /^https?:\/\//.test(photoURL)) {
        return `<img class="cw-avatar" src="${escapeHtml(photoURL)}" alt="" referrerpolicy="no-referrer">`;
    }
    const initial = (name || 'T').trim().charAt(0).toUpperCase();
    const hue = Array.from(name || 'T').reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7);
    return `<span class="cw-avatar cw-avatar-initial" style="background: hsl(${hue}, 45%, 38%)">${escapeHtml(initial)}</span>`;
}

function communityToast(message, isError) {
    let toast = document.getElementById('community-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'community-toast';
        document.body.appendChild(toast);
    }
    toast.className = `community-toast${isError ? ' error' : ''}`;
    toast.innerHTML = `<i class="fa-solid ${isError ? 'fa-triangle-exclamation' : 'fa-circle-check'}"></i> ${message}`;
    toast.classList.add('show');
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}

function communityRequiresLogin() {
    if (auth.currentUser) return false;
    communityToast('Log in to use the Community - guest data stays on this device only.', true);
    return true;
}

function communityErrorNote(err) {
    console.error('Community error:', err);
    if (err && (err.code === 'permission-denied' || `${err}`.includes('permission'))) {
        return 'The Community collections aren\'t enabled in Firestore rules yet.';
    }
    return 'Could not reach the Community right now - try again in a moment.';
}

// ---- Page shell ----
function renderCommunityPage() {
    const wall = document.getElementById('community-wall');
    if (!wall) return;

    document.querySelectorAll('.community-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === communityTab);
    });
    document.getElementById('community-wall-wrap').style.display = communityTab === 'wall' ? 'block' : 'none';
    document.getElementById('community-board-wrap').style.display = communityTab === 'board' ? 'block' : 'none';

    if (!auth.currentUser) {
        const note = '<div class="community-empty"><i class="fa-solid fa-lock"></i><h3>Log in to join the Community</h3><p>The Trade Wall and Leaderboard are for logged-in traders - your journal data itself always stays private.</p></div>';
        document.getElementById('community-wall').innerHTML = note;
        document.getElementById('community-board').innerHTML = note;
        return;
    }

    if (communityTab === 'wall') loadTradeWall();
    else loadLeaderboard();
}

function switchCommunityTab(tab) {
    communityTab = tab;
    renderCommunityPage();
}

// ---- Trade Wall ----
function loadTradeWall() {
    const container = document.getElementById('community-wall');
    if (!container || !db) return;
    container.innerHTML = '<div class="community-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading the wall...</div>';

    db.collection('communityShares').orderBy('createdAt', 'desc').limit(60).get()
        .then(snapshot => {
            communityWallCache = snapshot.docs;
            if (snapshot.empty) {
                container.innerHTML = `
                    <div class="community-empty">
                        <i class="fa-solid fa-wind"></i>
                        <h3>Nothing on the wall yet</h3>
                        <p>Be the first: open any closed trade and hit <strong>Share to Community</strong>, or share your week from the Weekly Review page.</p>
                    </div>`;
                return;
            }
            container.innerHTML = `<div class="cw-grid">${snapshot.docs.map(buildShareCardHtml).join('')}</div>`;
        })
        .catch(err => {
            container.innerHTML = `<div class="community-empty"><i class="fa-solid fa-plug-circle-xmark"></i><h3>Community unavailable</h3><p>${communityErrorNote(err)}</p></div>`;
        });
}

const COMMUNITY_REACTIONS = [
    { key: 'fire', emoji: '\u{1F525}' },
    { key: 'rocket', emoji: '\u{1F680}' },
    { key: 'clap', emoji: '\u{1F44F}' }
];

function myReactionSet() {
    try { return new Set(JSON.parse(localStorage.getItem('bb_my_reactions')) || []); } catch (e) { return new Set(); }
}

function buildReactionsRowHtml(doc) {
    const data = doc.data();
    const mine = myReactionSet();
    return `<div class="cw-reactions">${COMMUNITY_REACTIONS.map(r => {
        const count = (data.reactions && data.reactions[r.key]) || 0;
        const reacted = mine.has(`${doc.id}_${r.key}`);
        return `<button type="button" class="cw-react-btn${reacted ? ' reacted' : ''}" onclick="reactToShare('${doc.id}', '${r.key}', this)">
            <span class="cw-react-emoji">${r.emoji}</span><span class="cw-react-count">${count}</span>
        </button>`;
    }).join('')}</div>`;
}

function buildShareCardHtml(doc) {
    const d = doc.data();
    const mine = auth.currentUser && d.uid === auth.currentUser.uid;
    const header = `
        <div class="cw-card-head">
            ${communityAvatarHtml(d.displayName, d.photoURL)}
            <div class="cw-card-who">
                <span class="cw-card-name">${escapeHtml(d.displayName || 'Trader')}${mine ? ' <span class="cw-you-chip">you</span>' : ''}</span>
                <span class="cw-card-when">${communityTimeAgo(d.createdAt || Date.now())}</span>
            </div>
            ${mine ? `<button type="button" class="cw-card-del" title="Delete this share" onclick="deleteMyShare('${doc.id}')"><i class="fa-solid fa-trash"></i></button>` : ''}
        </div>`;

    let body = '';
    if (d.type === 'week') {
        const gradeCls = d.grade && d.grade.startsWith('A') ? 'grade-a' : d.grade === 'B' ? 'grade-b' : d.grade === 'C' ? 'grade-c' : 'grade-d';
        body = `
            <div class="cw-week-body">
                <div class="cw-week-grade ${gradeCls}">
                    <span class="cw-week-letter">${escapeHtml(d.grade || '-')}</span>
                    <span class="cw-week-score">${d.gradeScore != null ? d.gradeScore + '/100' : ''}</span>
                </div>
                <div class="cw-week-stats">
                    <div class="cw-week-title"><i class="fa-solid fa-clipboard-check"></i> Week of ${escapeHtml(d.weekKey || '')}</div>
                    <div class="cw-week-row"><span>Win rate</span><strong>${d.winRate != null ? d.winRate + '%' : '-'}</strong></div>
                    <div class="cw-week-row"><span>Profit factor</span><strong>${d.profitFactor === 999 ? '&infin;' : (d.profitFactor != null ? d.profitFactor : '-')}</strong></div>
                    <div class="cw-week-row"><span>Trades</span><strong>${d.trades != null ? d.trades : '-'}</strong></div>
                    <div class="cw-week-row"><span>Green days</span><strong>${d.greenDays != null ? d.greenDays : '-'}</strong></div>
                </div>
            </div>`;
    } else {
        const isWin = d.status === 'WIN';
        const isLoss = d.status === 'LOSS';
        const rHtml = d.rMultiple != null
            ? `<div class="cw-trade-r ${d.rMultiple >= 0 ? 'pos' : 'neg'}">${d.rMultiple >= 0 ? '+' : ''}${d.rMultiple}R</div>`
            : `<div class="cw-trade-r ${isLoss ? 'neg' : 'pos'}">${isWin ? 'WIN' : isLoss ? 'LOSS' : 'WASH'}</div>`;
        body = `
            <div class="cw-trade-body">
                <div class="cw-trade-top">
                    <span class="cw-trade-symbol">${escapeHtml(d.symbol || '?')}</span>
                    <span class="cw-side-chip ${d.direction === 'long' ? 'long' : 'short'}">
                        <i class="fa-solid ${d.direction === 'long' ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down'}"></i> ${d.direction === 'long' ? 'LONG' : 'SHORT'}
                    </span>
                    <span class="cw-status-chip ${isWin ? 'win' : isLoss ? 'loss' : 'wash'}">${escapeHtml(d.status || '')}</span>
                </div>
                ${rHtml}
                <div class="cw-trade-meta">
                    ${d.returnPct != null ? `<span class="${d.returnPct >= 0 ? 'value-positive' : 'value-negative'}">${d.returnPct >= 0 ? '+' : ''}${d.returnPct}%</span> &middot; ` : ''}
                    ${d.hold ? `${escapeHtml(d.hold)} &middot; ` : ''}${escapeHtml(d.day || '')}
                </div>
            </div>`;
    }

    return `<div class="cw-card">${header}${body}${buildReactionsRowHtml(doc)}</div>`;
}

// Toggles: first click adds the reaction, clicking again takes it back.
function reactToShare(shareId, key, btn) {
    if (communityRequiresLogin() || !db) return;

    const mine = myReactionSet();
    const mineKey = `${shareId}_${key}`;
    const removing = mine.has(mineKey);

    if (removing) mine.delete(mineKey);
    else mine.add(mineKey);
    localStorage.setItem('bb_my_reactions', JSON.stringify(Array.from(mine)));

    // Optimistic UI - update immediately, sync in the background
    if (btn) {
        btn.classList.toggle('reacted', !removing);
        if (!removing) {
            btn.classList.add('pop');
            setTimeout(() => btn.classList.remove('pop'), 350);
        }
        const countEl = btn.querySelector('.cw-react-count');
        if (countEl) {
            const next = (parseInt(countEl.textContent, 10) || 0) + (removing ? -1 : 1);
            countEl.textContent = Math.max(0, next);
        }
    }

    db.collection('communityShares').doc(shareId)
        .update({ [`reactions.${key}`]: firebase.firestore.FieldValue.increment(removing ? -1 : 1) })
        .catch(err => communityToast(communityErrorNote(err), true));
}

function deleteMyShare(shareId) {
    showConfirmDialog({
        title: 'Remove from the wall?',
        body: 'This deletes your shared card for everyone. Your actual trade/journal data is not affected.',
        confirmText: 'Yes, remove it',
        onConfirm: () => {
            db.collection('communityShares').doc(shareId).delete()
                .then(() => { communityToast('Removed from the wall.'); loadTradeWall(); })
                .catch(err => communityToast(communityErrorNote(err), true));
        }
    });
}

// ---- Sharing: from the Trade View modal ----
function shareTradeToCommunity() {
    if (communityRequiresLogin() || !db) return;
    if (typeof viewingTradeId === 'undefined' || !viewingTradeId) return;

    const account = getActiveAccount();
    const trade = ((account && account.trades) || []).find(t => t.id === viewingTradeId);
    if (!trade) return;

    const row = computeTradeSummary(trade);
    if (row.returnAmount === null) {
        communityToast('Only closed trades can be shared.', true);
        return;
    }

    const user = auth.currentUser;
    const payload = {
        type: 'trade',
        uid: user.uid,
        displayName: communityDisplayName(),
        photoURL: user.photoURL && /^https?:\/\//.test(user.photoURL) ? user.photoURL : null,
        createdAt: Date.now(),
        symbol: row.symbol,
        direction: row.direction,
        status: row.status,
        rMultiple: row.rMultiple !== null ? Math.round(row.rMultiple * 100) / 100 : null,
        returnPct: row.returnPct !== null ? Math.round(row.returnPct * 100) / 100 : null,
        hold: formatHoldDuration(row.holdSeconds),
        day: row.date.slice(0, 10),
        reactions: { fire: 0, rocket: 0, clap: 0 }
    };

    db.collection('communityShares').add(payload)
        .then(() => communityToast('Shared to the Trade Wall! (No dollar amounts are ever shown.)'))
        .catch(err => communityToast(communityErrorNote(err), true));
}

// ---- Sharing: the currently selected week from the Review page ----
// Recomputes the week's numbers the same way the Review page does, so the
// shared card always matches what the user is looking at.
function computeMyWeekSnapshot(weekOffset) {
    const account = getActiveAccount();
    const allClosed = ((account && account.trades) || [])
        .map(computeTradeSummary)
        .filter(r => r.returnAmount !== null);

    const weekDates = getReviewWeekDates(weekOffset);
    const weekSet = new Set(weekDates);
    const week = allClosed.filter(r => weekSet.has(r.date.slice(0, 10)));
    if (week.length === 0) return null;

    const wins = week.filter(r => r.status === 'WIN');
    const losses = week.filter(r => r.status === 'LOSS');
    const grade = computeWeekGrade(week, wins, losses);

    const grossProfit = wins.reduce((s, r) => s + r.returnAmount, 0);
    const grossLoss = Math.abs(losses.reduce((s, r) => s + r.returnAmount, 0));
    const pf = grossLoss > 0 ? Math.round((grossProfit / grossLoss) * 100) / 100 : (grossProfit > 0 ? 999 : 0);

    const byDay = new Map();
    week.forEach(r => {
        const day = r.date.slice(0, 10);
        byDay.set(day, (byDay.get(day) || 0) + r.returnAmount);
    });

    const rValues = week.map(r => r.rMultiple).filter(v => v !== null);

    return {
        weekKey: weekDates[0],
        grade: grade.letter,
        gradeScore: grade.score,
        winRate: Math.round((wins.length / week.length) * 100),
        profitFactor: pf,
        trades: week.length,
        greenDays: `${Array.from(byDay.values()).filter(v => v > 0).length}/${byDay.size}`,
        totalR: Math.round(rValues.reduce((s, v) => s + v, 0) * 100) / 100,
        rCount: rValues.length
    };
}

function shareWeekToCommunity() {
    if (communityRequiresLogin() || !db) return;
    const snap = computeMyWeekSnapshot(typeof reviewWeekOffset !== 'undefined' ? reviewWeekOffset : 0);
    if (!snap) {
        communityToast('No closed trades in this week to share.', true);
        return;
    }

    const user = auth.currentUser;
    db.collection('communityShares').add({
        type: 'week',
        uid: user.uid,
        displayName: communityDisplayName(),
        photoURL: user.photoURL && /^https?:\/\//.test(user.photoURL) ? user.photoURL : null,
        createdAt: Date.now(),
        weekKey: snap.weekKey,
        grade: snap.grade,
        gradeScore: snap.gradeScore,
        winRate: snap.winRate,
        profitFactor: snap.profitFactor,
        trades: snap.trades,
        greenDays: snap.greenDays,
        reactions: { fire: 0, rocket: 0, clap: 0 }
    })
        .then(() => communityToast('Week shared to the Trade Wall!'))
        .catch(err => communityToast(communityErrorNote(err), true));
}

// ---- Leaderboard ----
const LEADERBOARD_METRICS = {
    totalR: { label: 'Total R', suffix: 'R' },
    winRate: { label: 'Win Rate', suffix: '%' },
    profitFactor: { label: 'Profit Factor', suffix: '' }
};

function setLeaderboardMetric(metric) {
    leaderboardMetric = metric;
    loadLeaderboard();
}

function setLeaderboardWeek(offset) {
    leaderboardWeekOffset = offset;
    loadLeaderboard();
}

function publishWeekToLeaderboard() {
    if (communityRequiresLogin() || !db) return;
    const snap = computeMyWeekSnapshot(leaderboardWeekOffset);
    if (!snap) {
        communityToast('No closed trades in that week - nothing to publish.', true);
        return;
    }

    const user = auth.currentUser;
    const entryId = `${user.uid}_${snap.weekKey}`;
    db.collection('communityLeaderboard').doc(entryId).set({
        uid: user.uid,
        displayName: communityDisplayName(),
        photoURL: user.photoURL && /^https?:\/\//.test(user.photoURL) ? user.photoURL : null,
        weekKey: snap.weekKey,
        winRate: snap.winRate,
        profitFactor: snap.profitFactor,
        totalR: snap.totalR,
        rCount: snap.rCount,
        trades: snap.trades,
        grade: snap.grade,
        gradeScore: snap.gradeScore,
        updatedAt: Date.now()
    })
        .then(() => { communityToast('You\'re on the board! Re-publish any time to update your numbers.'); loadLeaderboard(); })
        .catch(err => communityToast(communityErrorNote(err), true));
}

function removeMyLeaderboardEntry() {
    if (communityRequiresLogin() || !db) return;
    const entryId = `${auth.currentUser.uid}_${communityWeekKey(leaderboardWeekOffset)}`;
    db.collection('communityLeaderboard').doc(entryId).delete()
        .then(() => { communityToast('Removed from the board.'); loadLeaderboard(); })
        .catch(err => communityToast(communityErrorNote(err), true));
}

function leaderboardMetricValue(entry) {
    const v = entry[leaderboardMetric];
    return typeof v === 'number' ? v : -Infinity;
}

function leaderboardMetricDisplay(entry) {
    const v = entry[leaderboardMetric];
    if (typeof v !== 'number') return '-';
    if (leaderboardMetric === 'profitFactor') return v === 999 ? '∞' : v.toFixed(2);
    if (leaderboardMetric === 'winRate') return `${v}%`;
    return `${v >= 0 ? '+' : ''}${v}R`;
}

function loadLeaderboard() {
    const container = document.getElementById('community-board');
    if (!container || !db) return;

    const weekKey = communityWeekKey(leaderboardWeekOffset);

    // Toolbar active states
    document.querySelectorAll('.lb-week-btn').forEach(btn => btn.classList.toggle('active', parseInt(btn.dataset.week, 10) === leaderboardWeekOffset));
    document.querySelectorAll('.lb-metric-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.metric === leaderboardMetric));

    container.innerHTML = '<div class="community-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading the board...</div>';

    db.collection('communityLeaderboard').where('weekKey', '==', weekKey).get()
        .then(snapshot => {
            const uid = auth.currentUser ? auth.currentUser.uid : null;
            const entries = snapshot.docs.map(doc => doc.data())
                .filter(e => typeof leaderboardMetricValue(e) === 'number')
                .sort((a, b) => leaderboardMetricValue(b) - leaderboardMetricValue(a));

            const iAmOnBoard = entries.some(e => e.uid === uid);
            const mySnap = computeMyWeekSnapshot(leaderboardWeekOffset);

            const ctaHtml = `
                <div class="lb-cta${iAmOnBoard ? ' on-board' : ''}">
                    <div class="lb-cta-text">
                        ${iAmOnBoard
                            ? '<strong>You\'re on the board.</strong> Numbers looking stale? Re-publish to refresh them.'
                            : mySnap
                                ? `<strong>Join the board?</strong> Your ${leaderboardWeekOffset === 0 ? 'week so far' : 'week'}: ${mySnap.winRate}% win rate &middot; ${mySnap.trades} trades &middot; ${mySnap.totalR >= 0 ? '+' : ''}${mySnap.totalR}R. Only these stats are published - never dollar amounts.`
                                : 'No closed trades in this week yet - the board is opt-in and only shows percentages and R, never dollars.'}
                    </div>
                    <div class="lb-cta-actions">
                        ${mySnap ? `<button type="button" class="news-tab lb-publish-btn" onclick="publishWeekToLeaderboard()"><i class="fa-solid fa-flag-checkered"></i> ${iAmOnBoard ? 'Update my entry' : 'Publish my week'}</button>` : ''}
                        ${iAmOnBoard ? '<button type="button" class="news-tab lb-remove-btn" onclick="removeMyLeaderboardEntry()"><i class="fa-solid fa-user-slash"></i> Leave board</button>' : ''}
                    </div>
                </div>`;

            if (entries.length === 0) {
                container.innerHTML = ctaHtml + `
                    <div class="community-empty">
                        <i class="fa-solid fa-ranking-star"></i>
                        <h3>The board is empty for this week</h3>
                        <p>Publish your week and claim the top spot while it's easy.</p>
                    </div>`;
                return;
            }

            const podium = entries.slice(0, 3);
            const rest = entries.slice(3);
            const podiumOrder = [podium[1], podium[0], podium[2]]; // 2nd | 1st | 3rd
            const medals = ['silver', 'gold', 'bronze'];
            const ranks = [2, 1, 3];

            const podiumHtml = `<div class="lb-podium">${podiumOrder.map((e, i) => {
                if (!e) return '<div class="lb-podium-slot empty"></div>';
                const isMe = uid && e.uid === uid;
                return `
                    <div class="lb-podium-slot ${medals[i]}${isMe ? ' me' : ''}">
                        <div class="lb-podium-medal"><i class="fa-solid ${ranks[i] === 1 ? 'fa-crown' : 'fa-medal'}"></i> #${ranks[i]}</div>
                        ${communityAvatarHtml(e.displayName, e.photoURL)}
                        <div class="lb-podium-name">${escapeHtml(e.displayName || 'Trader')}${isMe ? ' <span class="cw-you-chip">you</span>' : ''}</div>
                        <div class="lb-podium-value">${leaderboardMetricDisplay(e)}</div>
                        <div class="lb-podium-sub">${e.trades} trades &middot; grade ${escapeHtml(e.grade || '-')}</div>
                    </div>`;
            }).join('')}</div>`;

            const rowsHtml = rest.length === 0 ? '' : `
                <div class="lb-rows">${rest.map((e, i) => {
                    const isMe = uid && e.uid === uid;
                    return `
                    <div class="lb-row${isMe ? ' me' : ''}">
                        <span class="lb-row-rank">#${i + 4}</span>
                        ${communityAvatarHtml(e.displayName, e.photoURL)}
                        <span class="lb-row-name">${escapeHtml(e.displayName || 'Trader')}${isMe ? ' <span class="cw-you-chip">you</span>' : ''}</span>
                        <span class="lb-row-sub">${e.trades} trades &middot; ${e.winRate}% &middot; grade ${escapeHtml(e.grade || '-')}</span>
                        <span class="lb-row-value">${leaderboardMetricDisplay(e)}</span>
                    </div>`;
                }).join('')}</div>`;

            container.innerHTML = ctaHtml + podiumHtml + rowsHtml;
        })
        .catch(err => {
            container.innerHTML = `<div class="community-empty"><i class="fa-solid fa-plug-circle-xmark"></i><h3>Leaderboard unavailable</h3><p>${communityErrorNote(err)}</p></div>`;
        });
}
