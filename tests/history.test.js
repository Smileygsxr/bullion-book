// Trade Change History (accounts.js): every save diffs the active account's
// trades against the last save, so any operation = one revertible change.
module.exports = ({ test, assert, assertEqual, makeSandbox, loadInto, run }) => {
    function historySandbox() {
        const sb = makeSandbox();
        run(sb, `
            function computeTradeSummary() { return { returnAmount: 0 }; }
            function computeTradeReturnAmount() { return 0; }
            function getCurrencySymbol() { return '$'; }
            function normalizeBrokerSymbol(s) { return String(s).replace(/m$/, ''); } // XAUUSDm -> XAUUSD
        `);
        loadInto(sb, ['accounts.js']);
        run(sb, `
            renderSidebarAccount = function () {};
            updateSidebarBalanceDisplay = function () {};
            function T(id, sym) {
                return { id: id, symbol: sym, tagIds: [], legs: [{ id: id + 'L', action: 'buy', datetime: '2026-01-05T10:00', quantity: 1, price: 100, fee: 0 }] };
            }
            function ids() { return getActiveAccount().trades.map(t => t.id).sort().join(','); }
        `);
        return sb;
    }

    test('history: edits, deletes and a bulk import are one entry each; reverts are exact', () => {
        const sb = historySandbox();
        const js = code => run(sb, code);
        // Load includes a raw broker symbol that load-time cleanup fixes - must NOT be a "change"
        js("applyLoadedState({ accounts: { A1: { id: 'A1', name: 'Test', transactions: [], trades: [T('t1','XAUUSDm'), T('t2','EURUSD'), T('t3','GBPUSD')] } }, activeAccountId: 'A1' })");
        assertEqual(js("loadTradeHistory('A1').length"), 0, 'load + symbol cleanup records no history');
        js('var original = JSON.stringify(getActiveAccount().trades)');

        js("getActiveAccount().trades[0].tagIds = ['tagX']; saveAccountsState()");
        js("getActiveAccount().trades = getActiveAccount().trades.filter(t => t.id !== 't2'); saveAccountsState()");
        js("labelNextTradeChange('Imported 3 trades from x.csv')");
        js("getActiveAccount().trades.push(T('n1','XAUUSD'), T('n2','XAUUSD'), T('n3','XAUUSD')); saveAccountsState()");
        js("getActiveAccount().name = 'Renamed'; saveAccountsState()");

        js("var h = loadTradeHistory('A1')");
        assertEqual(js('h.length'), 3, 'non-trade save adds no entry');
        assert(js("h[0].label === 'Imported 3 trades from x.csv' && h[0].added.length === 3"), 'bulk import = 1 entry, ids only');
        assert(js("h[1].label === 'Deleted EURUSD trade' && h[1].removed[0].id === 't2'"), 'delete keeps the full trade for undo');
        assert(js("h[2].label === 'Edited XAUUSD trade' && h[2].changed[0].tagIds.length === 0"), 'edit keeps the BEFORE copy');

        js('revertTradeHistoryTo(h[0].id)');
        assertEqual(js('ids()'), 't1,t3', 'revert newest undoes only the import');
        js("h = loadTradeHistory('A1')");
        assert(js("h.length === 3 && h[0].label.indexOf('Reverted 1 change') === 0"), 'revert recorded as its own entry');
        js('revertTradeHistoryTo(h[0].id)');
        assertEqual(js('ids()'), 'n1,n2,n3,t1,t3', 'reverting the revert restores the import');

        js("h = loadTradeHistory('A1'); revertTradeHistoryTo(h[h.length - 1].id)");
        assert(js(`(function () {
            const byId = (a, b) => (a.id < b.id ? -1 : 1);
            return JSON.stringify(getActiveAccount().trades.slice().sort(byId)) === JSON.stringify(JSON.parse(original).sort(byId));
        })()`), 'revert-to-oldest restores the exact original trades');
        assertEqual(js("loadTradeHistory('A1').length"), 1, 'consumed entries removed, 1 revert entry left');
    });

    test('history: capped at 10, and a reload never records a phantom change', () => {
        const sb = historySandbox();
        const js = code => run(sb, code);
        js("applyLoadedState({ accounts: { A1: { id: 'A1', name: 'Test', transactions: [], trades: [T('t1','XAUUSD')] } }, activeAccountId: 'A1' })");
        js("for (let i = 0; i < 12; i++) { getActiveAccount().trades[0].journal = 'n' + i; saveAccountsState(); }");
        assertEqual(js("loadTradeHistory('A1').length"), 10, 'history capped at the last 10 changes');
        // A second load (e.g. Firestore after guest) must not diff against the stale baseline
        js("var newestBefore = loadTradeHistory('A1')[0].id");
        js("applyLoadedState({ accounts: { A1: { id: 'A1', name: 'Test', transactions: [], trades: [T('zz','USDJPYm')] } }, activeAccountId: 'A1' })");
        assert(js("loadTradeHistory('A1')[0].id === newestBefore"), 'reload with different trades records no phantom change');
    });
};
