// Multi-account balances/transactions. Persisted in Firestore under users/{uid}
// for logged-in users, or localStorage for guests (skipLogin has no uid to scope
// a Firestore doc to). "Primary account" == accountsState.activeAccountId: the
// one shown in the sidebar and edited by default in the modal.
const GUEST_ACCOUNTS_KEY = 'bb_accounts_guest';

let accountsState = { accounts: {}, activeAccountId: null };
let draftAccount = null;

function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function makeDefaultAccount(name) {
    const id = genId();
    return { id, name: name || 'Primary Live', transactions: [] };
}

// Balance = deposits/withdrawals (account.transactions) +/- realized trade P&L.
// Uses computeTradeReturnAmount (trades.js), not computeTradeSummary, to avoid an
// infinite loop - see the comment on computeTradeReturnAmount for why.
function computeAccountBalance(account) {
    const transactionTotal = (account.transactions || []).reduce((sum, t) => {
        const amount = parseFloat(t.amount) || 0;
        return sum + (t.type === 'withdraw' ? -amount : amount);
    }, 0);

    const tradePnlTotal = (account.trades || []).reduce((sum, trade) => sum + computeTradeReturnAmount(trade), 0);

    return transactionTotal + tradePnlTotal;
}

function formatCurrency(amount) {
    const sign = amount < 0 ? '-' : '';
    return `${sign}${getCurrencySymbol()}${Math.abs(amount).toFixed(2)}`;
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- Contract size (Settings > Contract Sizes) ----
// A raw price move times "quantity" only equals real dollar P&L when quantity is
// already in dollar-equivalent units. Trade quantities here are broker LOTS, so
// each symbol needs its own multiplier - e.g. XAUUSD is 100oz per lot, so a $10
// move on 0.01 lots is $10 P&L (10 * 0.01 * 100), not $0.10. This is NOT
// leverage (leverage only affects margin required, never P&L) - it's the
// instrument's contract size. account.contractSizes is an array of
// { id, symbol, size } rows (editable in Settings), falling back to well-known
// defaults, then 1 (old behavior) if the symbol isn't recognized either way.
const BUILT_IN_CONTRACT_SIZES = { XAUUSD: 100 };

function getContractSizeForSymbol(symbol) {
    const account = getActiveAccount();
    const key = (symbol || '').trim().toUpperCase();
    const row = (account.contractSizes || []).find(r => r.symbol.toUpperCase() === key);
    if (row && typeof row.size === 'number' && row.size > 0) return row.size;
    return BUILT_IN_CONTRACT_SIZES[key] || 1;
}

// ---- Generic confirmation dialog - a single reusable modal (app.html) instead
// of the browser's native confirm() popup, used by any destructive action that
// doesn't already have its own dedicated confirm modal (Delete Trade/Note do). ----
let genericConfirmModalAction = null;

function showConfirmDialog({ title, body, confirmText, onConfirm }) {
    const titleEl = document.getElementById('generic-confirm-modal-title');
    const bodyEl = document.getElementById('generic-confirm-modal-body');
    const confirmBtn = document.getElementById('generic-confirm-modal-confirm-btn');
    const overlay = document.getElementById('generic-confirm-modal-overlay');
    if (!titleEl || !bodyEl || !confirmBtn || !overlay) return;

    titleEl.textContent = title;
    bodyEl.textContent = body;
    confirmBtn.textContent = confirmText || 'Yes, continue';
    genericConfirmModalAction = onConfirm;

    overlay.style.display = 'flex';
}

function closeGenericConfirmModal() {
    const overlay = document.getElementById('generic-confirm-modal-overlay');
    if (overlay) overlay.style.display = 'none';
    genericConfirmModalAction = null;
}

function runGenericConfirmModalAction() {
    const action = genericConfirmModalAction;
    closeGenericConfirmModal();
    if (typeof action === 'function') action();
}

function initAccounts() {
    auth.onAuthStateChanged(user => {
        if (user) {
            loadAccountsFromFirestore(user.uid);
        } else {
            loadAccountsFromLocalStorage();
        }
    });
}

function loadAccountsFromFirestore(uid) {
    db.collection('users').doc(uid).get()
        .then(doc => applyLoadedState(doc.exists ? doc.data().bullionAccounts : null))
        .catch(err => {
            console.error('Failed to load accounts from Firestore:', err.message);
            applyLoadedState(null);
        });
}

function loadAccountsFromLocalStorage() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(GUEST_ACCOUNTS_KEY)); } catch (e) { /* ignore corrupt data */ }
    applyLoadedState(saved);
}

function applyLoadedState(saved) {
    if (saved && saved.accounts && Object.keys(saved.accounts).length > 0) {
        accountsState = saved;
        if (!accountsState.accounts[accountsState.activeAccountId]) {
            accountsState.activeAccountId = Object.keys(accountsState.accounts)[0];
        }
        renderSidebarAccount();
    } else {
        const account = makeDefaultAccount('Primary Live');
        accountsState = { accounts: { [account.id]: account }, activeAccountId: account.id };
        saveAccountsState();
        renderSidebarAccount();
    }
}

function saveAccountsState() {
    const uid = auth.currentUser && auth.currentUser.uid;
    if (uid) {
        // mergeFields (NOT merge:true): accounts is a map keyed by account id,
        // and a deep merge would treat deleted ids as "keep the stored value" -
        // resurrecting deleted accounts on the next load. mergeFields replaces
        // this field wholesale while preserving the doc's other fields
        // (chartDrawings, appSettings, profilePhotoDataUrl).
        db.collection('users').doc(uid).set({ bullionAccounts: accountsState }, { mergeFields: ['bullionAccounts'] })
            .catch(err => console.error('Failed to save accounts to Firestore:', err.message));
    } else {
        localStorage.setItem(GUEST_ACCOUNTS_KEY, JSON.stringify(accountsState));
    }
}

function getActiveAccount() {
    return accountsState.accounts[accountsState.activeAccountId];
}

// ---- Sidebar: balance display + primary-account switcher ----
// Split from renderSidebarAccount so trades.js can refresh just the balance after
// saving/deleting a trade (balance now includes trade P&L) without looping back
// into renderTradeLog, which renderSidebarAccount itself triggers below.
function updateSidebarBalanceDisplay() {
    const balanceEl = document.getElementById('sidebar-account-balance');
    const switcherEl = document.getElementById('account-switcher-select');
    const active = getActiveAccount();
    if (balanceEl && active) balanceEl.textContent = formatCurrency(computeAccountBalance(active));

    if (switcherEl) {
        switcherEl.innerHTML = Object.values(accountsState.accounts)
            .map(acc => `<option value="${acc.id}" ${acc.id === accountsState.activeAccountId ? 'selected' : ''}>${escapeHtml(acc.name)}</option>`)
            .join('');
    }
}

function renderSidebarAccount() {
    updateSidebarBalanceDisplay();

    // trades.js renders the dashboard trade log (and merges in day notes by date)
    // for whichever account is now active
    if (typeof renderTradeLog === 'function') renderTradeLog();
}

function switchActiveAccount(accountId) {
    if (!accountsState.accounts[accountId]) return;
    accountsState.activeAccountId = accountId;
    saveAccountsState();
    renderSidebarAccount();
    // Each account remembers its own CSV import timezone/history - refresh the
    // Import Trades panel immediately in case it's already open, instead of only
    // updating once the user leaves and re-enters that Settings tab.
    if (typeof renderCsvImportMeta === 'function') renderCsvImportMeta();
    // Re-render whatever page is currently open (Stats, Calendar, Review...) so
    // it reflects the new account immediately - pages otherwise only re-render
    // when navigated to (app.js showPage).
    if (typeof refreshActivePageForAccountChange === 'function') refreshActivePageForAccountChange();
}

// ---- Modal: Account & Transactions ----
function openAccountModal() {
    const active = getActiveAccount();
    if (!active) return;
    draftAccount = JSON.parse(JSON.stringify(active));
    renderAccountModal();
    document.getElementById('account-modal-overlay').style.display = 'flex';
}

function closeAccountModal() {
    document.getElementById('account-modal-overlay').style.display = 'none';
    draftAccount = null;
}

function renderAccountModal() {
    document.getElementById('account-modal-name').value = draftAccount.name;
    document.getElementById('account-modal-primary').checked = draftAccount.id === accountsState.activeAccountId;
    renderTransactionRows();
}

function renderTransactionRows() {
    const tbody = document.getElementById('account-modal-transactions');
    if (!tbody) return;

    tbody.innerHTML = draftAccount.transactions.map(t => `
        <tr>
            <td>
                <select class="modal-select" onchange="updateDraftTransaction('${t.id}','type',this.value)">
                    <option value="deposit" ${t.type === 'deposit' ? 'selected' : ''}>Deposit</option>
                    <option value="withdraw" ${t.type === 'withdraw' ? 'selected' : ''}>Withdraw</option>
                </select>
            </td>
            <td><input type="date" class="modal-input" value="${t.date || ''}" onchange="updateDraftTransaction('${t.id}','date',this.value)"></td>
            <td><input type="number" step="0.01" class="modal-input" value="${t.amount || 0}" onchange="updateDraftTransaction('${t.id}','amount',this.value)"></td>
            <td><input type="text" class="modal-input" value="${escapeHtml(t.note || '')}" onchange="updateDraftTransaction('${t.id}','note',this.value)"></td>
            <td><button class="txn-remove-btn" onclick="removeDraftTransaction('${t.id}')" title="Remove"><i class="fa-solid fa-circle-xmark"></i></button></td>
        </tr>
    `).join('');

    document.getElementById('account-modal-balance').value = formatCurrency(computeAccountBalance(draftAccount));
}

function updateDraftTransaction(id, field, value) {
    const txn = draftAccount.transactions.find(t => t.id === id);
    if (!txn) return;
    txn[field] = value;
    document.getElementById('account-modal-balance').value = formatCurrency(computeAccountBalance(draftAccount));
}

function addDraftTransaction() {
    draftAccount.transactions.push({
        id: genId(), type: 'deposit', date: new Date().toISOString().slice(0, 10), amount: 0, note: ''
    });
    renderTransactionRows();
}

function removeDraftTransaction(id) {
    draftAccount.transactions = draftAccount.transactions.filter(t => t.id !== id);
    renderTransactionRows();
}

function saveAccountModal() {
    draftAccount.name = document.getElementById('account-modal-name').value.trim() || 'Account';
    const makePrimary = document.getElementById('account-modal-primary').checked;

    accountsState.accounts[draftAccount.id] = draftAccount;
    if (makePrimary) accountsState.activeAccountId = draftAccount.id;

    saveAccountsState();
    renderSidebarAccount();
    closeAccountModal();
}

function deleteAccountModal() {
    const accountToDelete = draftAccount;
    showConfirmDialog({
        title: 'Delete Account?',
        body: `Delete "${accountToDelete.name}" and all its transactions? This can't be undone.`,
        confirmText: 'Yes, delete it',
        onConfirm: () => {
            delete accountsState.accounts[accountToDelete.id];

            if (Object.keys(accountsState.accounts).length === 0) {
                const fresh = makeDefaultAccount('Primary Live');
                accountsState.accounts[fresh.id] = fresh;
                accountsState.activeAccountId = fresh.id;
            } else if (accountsState.activeAccountId === accountToDelete.id) {
                accountsState.activeAccountId = Object.keys(accountsState.accounts)[0];
            }

            saveAccountsState();
            renderSidebarAccount();
            closeAccountModal();
        }
    });
}

function newAccountModal() {
    const fresh = makeDefaultAccount('New Account');
    accountsState.accounts[fresh.id] = fresh;
    saveAccountsState();
    renderSidebarAccount();

    draftAccount = JSON.parse(JSON.stringify(fresh));
    renderAccountModal();
}
