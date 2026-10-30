// Regression tests for the stored/URL script-injection holes found in the
// site review: Community share cards, the leaderboard, and the public journal
// link. Payloads are inert strings - these tests only inspect generated HTML.
module.exports = ({ test, assert, makeSandbox, fakeElement, loadInto, run, inlineScript }) => {
    const PAYLOAD = '<img src=x onerror=alert(1)>';

    function communitySandbox() {
        const sb = makeSandbox({ auth: { currentUser: { uid: 'viewer' }, onAuthStateChanged() {} } });
        return loadInto(sb, ['accounts.js', 'community.js']);
    }

    function cardHtml(sb, data, id) {
        sb.__doc = { id: id || 'share1', data: () => data };
        return run(sb, 'buildShareCardHtml(__doc)');
    }

    test('share card: text payloads in every field are escaped', () => {
        const sb = communitySandbox();
        const html = cardHtml(sb, {
            type: 'trade', uid: 'attacker', displayName: PAYLOAD, symbol: PAYLOAD, status: PAYLOAD,
            hold: PAYLOAD, day: PAYLOAD, playbook: PAYLOAD, tags: [PAYLOAD],
            returnPct: PAYLOAD, rMultiple: PAYLOAD, confidence: PAYLOAD, createdAt: PAYLOAD, reactions: { fire: PAYLOAD }
        });
        assert(html.indexOf('<img') === -1, 'raw <img> reached the card HTML');
        assert(html.indexOf('onerror=alert') === -1 || html.indexOf('&lt;img') >= 0, 'payload not neutralized');
    });

    test('share card: week-card numbers must be real numbers', () => {
        const sb = communitySandbox();
        const html = cardHtml(sb, {
            type: 'week', uid: 'attacker', grade: PAYLOAD, gradeScore: PAYLOAD, winRate: PAYLOAD,
            profitFactor: PAYLOAD, trades: PAYLOAD, greenDays: PAYLOAD, weekKey: PAYLOAD
        });
        assert(html.indexOf('<img') === -1, 'raw <img> reached the week card');
    });

    test('share card: a malicious document id cannot break out of onclick', () => {
        const sb = communitySandbox();
        const html = cardHtml(sb, { type: 'trade', uid: 'viewer', symbol: 'XAUUSD', status: 'WIN' }, "x');alert(1);//\" onmouseover=\"alert(2)");
        assert(html.indexOf("reactToShare('x')") === -1, 'doc id is inside a JS string');
        assert(html.indexOf('onmouseover="alert') === -1, 'doc id broke out of its attribute');
        assert(html.indexOf('onclick="reactToShare(this.dataset.shareId') >= 0, 'reaction buttons read the id from data-share-id');
        assert(html.indexOf('onclick="deleteMyShare(this.dataset.shareId)') >= 0, 'own-card delete reads the id from data-share-id');
    });

    test('share card: wrong field types no longer crash the whole wall', () => {
        const sb = communitySandbox();
        cardHtml(sb, { type: 'week', grade: 42, tags: 'not-an-array', reactions: 'nope', displayName: { a: 1 } });
        cardHtml(sb, { type: 'trade', tags: { length: 3 }, displayName: 7, photoURL: 5 });
        cardHtml(sb, {});
    });

    test('share card: a normal trade still renders its real values', () => {
        const sb = communitySandbox();
        const html = cardHtml(sb, {
            type: 'trade', uid: 'u2', displayName: 'Ruan', symbol: 'XAUUSD', direction: 'long', status: 'WIN',
            rMultiple: 1.8, returnPct: 0.42, hold: '12 MIN', day: '2026-10-30',
            playbook: 'London Breakout', tags: ['A-setup'], confidence: 8, reactions: { fire: 3 }, createdAt: Date.now() - 60000
        });
        ['XAUUSD', '+1.8R', '+0.42%', '12 MIN', 'London Breakout', 'A-setup', '8/10', 'LONG', '>3<'].forEach(bit =>
            assert(html.indexOf(bit) >= 0, `missing "${bit}"`));
    });

    test('leaderboard: entries are normalized before rendering or ranking', () => {
        const sb = communitySandbox();
        sb.__raw = { uid: 'u', displayName: { evil: true }, winRate: 140, trades: '5' + PAYLOAD, wins: 99, grade: PAYLOAD, photoURL: 7 };
        const e = run(sb, 'sanitizeLeaderboardEntry(__raw)');
        assert(e.displayName === 'Trader', 'non-string name falls back');
        assert(e.winRate === 100, 'win rate clamped to 100');
        assert(e.trades === 0, 'non-numeric trades -> 0 (entry gets filtered out)');
        assert(e.grade.length <= 3, 'grade truncated');
        assert(e.photoURL === null, 'non-string photo dropped');
        sb.__ok = { uid: 'u', displayName: 'A', winRate: 60, trades: 10, wins: 50 };
        const ok = run(sb, 'sanitizeLeaderboardEntry(__ok)');
        assert(ok.wins === 10, 'wins clamped to trade count');
        assert(Number.isFinite(run(sb, 'leaderboardRankScore(sanitizeLeaderboardEntry(__ok))')), 'rank score stays a number');
    });

    // Plain base64 exactly as links were generated before the URL-safe change
    function plainBase64(payload) {
        return Buffer.from(unescape(encodeURIComponent(JSON.stringify(payload))), 'binary').toString('base64');
    }

    function renderJournalHash(hash) {
        const sb = makeSandbox();
        ['journal-content', 'journal-title', 'journal-meta'].forEach(id => { sb._elements[id] = fakeElement(); });
        sb.window.location.hash = hash;
        require('vm').runInContext(inlineScript('journal.html'), sb, { filename: 'journal.html' });
        return sb._elements;
    }

    function renderJournal(payload) {
        return renderJournalHash('#data=' + plainBase64(payload));
    }

    test('journal link: old links containing "+" and new URL-safe links both open', () => {
        const trades = [{ date: '2026-10-29T10:00', symbol: 'XAUUSD', direction: 'long', qty: 1, entry: 2400, exit: 2410, ret: 25, retPct: 0.4 }];
        // Find an account name whose plain base64 really contains '+' (the case
        // that used to show "This link is invalid or corrupted")
        let payload = null, plain = '';
        // ('>' as the 3rd byte of a base64 group encodes to '+')
        for (let k = 1; k < 40 && !plain.includes('+'); k++) {
            payload = { accountName: 'Live ' + 'x'.repeat(k) + ' >> Café', currencySymbol: '€', generatedAt: '2026-10-30', trades };
            plain = plainBase64(payload);
        }
        assert(plain.includes('+'), 'test setup: no "+" found');
        const oldLink = renderJournalHash('#data=' + plain)['journal-content'].innerHTML;
        assert(oldLink.indexOf('XAUUSD') >= 0, 'an already-shared link with "+" should open');
        const urlSafe = plain.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const newLink = renderJournalHash('#data=' + urlSafe)['journal-content'].innerHTML;
        assert(newLink.indexOf('XAUUSD') >= 0, 'a URL-safe link should open');
    });

    test('journal link: crafted trade fields are escaped', () => {
        const el = renderJournal({
            accountName: PAYLOAD, currencySymbol: '<b>', generatedAt: '2026-10-30',
            trades: [{ date: '2026-10-29T10:00', symbol: PAYLOAD, direction: 'long', qty: PAYLOAD, entry: 2400, exit: 2410, ret: 25, retPct: 0.5 }]
        });
        const html = el['journal-content'].innerHTML;
        assert(html.indexOf('<img') === -1, 'raw <img> reached the journal page');
        assert(html.indexOf('<b>') === -1, 'currency symbol not escaped');
        assert(html.indexOf('&lt;img') >= 0, 'symbol shown as escaped text');
    });

    test('journal link: malformed payloads fail safely', () => {
        assert(renderJournal({ trades: 'nope' })['journal-content'].innerHTML.indexOf('No closed trades') >= 0, 'non-array trades handled');
        assert(renderJournal([])['journal-content'].innerHTML.indexOf('invalid') >= 0 ||
               renderJournal([])['journal-content'].innerHTML.indexOf('No closed trades') >= 0, 'array payload handled');
        renderJournal({ trades: [{ entry: 'x', exit: 'y', retPct: 'z' }] }); // must not throw on .toFixed
    });

    test('journal link: a real shared journal still renders', () => {
        const html = renderJournal({
            accountName: 'Live', currencySymbol: '$', generatedAt: '2026-10-30',
            trades: [
                { date: '2026-10-29T10:00', symbol: 'XAUUSD', direction: 'long', qty: 0.05, entry: 2400.1, exit: 2410.5, ret: 52, retPct: 0.43 },
                { date: '2026-10-28T09:00', symbol: 'EURUSD', direction: 'short', qty: 1, entry: 1.08, exit: 1.082, ret: -20, retPct: -0.18 }
            ]
        })['journal-content'].innerHTML;
        ['XAUUSD', 'EURUSD', '$2400.100', '0.43%', 'LONG', 'SHORT'].forEach(bit => assert(html.indexOf(bit) >= 0, `missing "${bit}"`));
    });
};
