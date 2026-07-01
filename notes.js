// Day Notes: independent mood/market journal entries (not one-per-day - clicking
// "New Note" always creates another one), stored as an array on the active account
// (account.dayNotes), shown inline in the Dashboard trade log sorted by date, with
// newer notes stacked above older ones sharing the same date.
let draftNoteId = null;
let noteDraft = { mood: null, condition: null, volatility: null };

function todayDateKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Older versions stored one note per day as { 'YYYY-MM-DD': note }. Migrate that
// shape to the array shape in place the first time it's touched, so existing notes
// aren't lost.
function getDayNotesArray(account) {
    if (Array.isArray(account.dayNotes)) return account.dayNotes;

    const migrated = Object.entries(account.dayNotes || {}).map(([date, note], i) =>
        Object.assign({ id: genId(), date, createdAt: Date.now() - i }, note)
    );
    account.dayNotes = migrated;
    if (migrated.length > 0) saveAccountsState();
    return migrated;
}

function openNoteModal(noteId) {
    const account = getActiveAccount();
    const notesArr = getDayNotesArray(account);
    const existing = noteId ? notesArr.find(n => n.id === noteId) : null;

    draftNoteId = existing ? existing.id : genId();
    noteDraft = existing
        ? { mood: existing.mood, condition: existing.condition, volatility: existing.volatility }
        : { mood: null, condition: null, volatility: null };

    document.getElementById('note-modal-date').value = existing ? existing.date : todayDateKey();
    document.getElementById('note-modal-summary').value = existing ? (existing.summary || '') : '';
    document.getElementById('note-editor-content').innerHTML = existing ? (existing.html || '') : '';

    updateNoteToggleUI();
    document.getElementById('note-modal-overlay').style.display = 'flex';
}

function closeNoteModal() {
    document.getElementById('note-modal-overlay').style.display = 'none';
    draftNoteId = null;
}

function selectNoteOption(group, value) {
    noteDraft[group] = noteDraft[group] === value ? null : value;
    updateNoteToggleUI();
}

function updateNoteToggleUI() {
    ['mood', 'condition', 'volatility'].forEach(group => {
        const setEl = document.getElementById(`note-${group}-set`);
        if (!setEl) return;
        setEl.querySelectorAll('.note-toggle-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.value === noteDraft[group]);
        });
    });
}

// ---- Rich text toolbar (plain execCommand - fine for this lightweight use case) ----
function runNoteEditorCommand(command, value) {
    document.getElementById('note-editor-content').focus();
    document.execCommand(command, false, value || null);
}

function runNoteEditorLink() {
    const url = prompt('Link URL:');
    if (url) runNoteEditorCommand('createLink', url);
}

function runNoteEditorImage() {
    const url = prompt('Image URL:');
    if (url) runNoteEditorCommand('insertImage', url);
}

// ---- Save / delete ----
function saveNoteModal() {
    const account = getActiveAccount();
    const notesArr = getDayNotesArray(account);

    const noteData = {
        id: draftNoteId,
        date: document.getElementById('note-modal-date').value,
        mood: noteDraft.mood,
        condition: noteDraft.condition,
        volatility: noteDraft.volatility,
        summary: document.getElementById('note-modal-summary').value.trim(),
        html: document.getElementById('note-editor-content').innerHTML
    };

    const existingIndex = notesArr.findIndex(n => n.id === draftNoteId);
    if (existingIndex >= 0) {
        noteData.createdAt = notesArr[existingIndex].createdAt;
        notesArr[existingIndex] = noteData;
    } else {
        noteData.createdAt = Date.now();
        notesArr.unshift(noteData);
    }

    saveAccountsState();
    renderTradeLog();
    closeNoteModal();
}

// A pinned note always stays at the very top of the Dashboard trade log,
// regardless of date/recency - the explicit override for when you actually
// want a note to stick (unlike the default, where notes now sink down over
// time just like any other dated entry - see mergeNoteAndTradeEntries).
function toggleNotePinned(noteId) {
    const account = getActiveAccount();
    const note = getDayNotesArray(account).find(n => n.id === noteId);
    if (!note) return;
    note.pinned = !note.pinned;
    saveAccountsState();
    renderTradeLog();
}

// Closes the note editor and opens a styled "Delete Note?" confirmation in its
// place (matches the Delete Trade confirmation), instead of stacking confirm()
// on top of an open modal.
let pendingDeleteNoteId = null;

function deleteNoteModal() {
    const account = getActiveAccount();
    const notesArr = getDayNotesArray(account);
    const exists = notesArr.some(n => n.id === draftNoteId);
    if (!exists) {
        closeNoteModal();
        return;
    }

    pendingDeleteNoteId = draftNoteId;
    closeNoteModal();
    document.getElementById('delete-note-modal-overlay').style.display = 'flex';
}

function closeDeleteNoteModal() {
    document.getElementById('delete-note-modal-overlay').style.display = 'none';
    pendingDeleteNoteId = null;
}

function confirmDeleteNote() {
    if (!pendingDeleteNoteId) return;
    const account = getActiveAccount();
    const notesArr = getDayNotesArray(account);
    const index = notesArr.findIndex(n => n.id === pendingDeleteNoteId);
    if (index !== -1) notesArr.splice(index, 1);

    saveAccountsState();
    renderTradeLog();
    closeDeleteNoteModal();
}

// ---- Dashboard row ----
const NOTE_MOOD_ICONS = {
    happy: '<i class="fa-regular fa-face-smile" style="color:#2ebd85;"></i>',
    neutral: '<i class="fa-regular fa-face-meh" style="color:#dfb15b;"></i>',
    sad: '<i class="fa-regular fa-face-frown" style="color:#f6465d;"></i>'
};
const NOTE_CONDITION_ICONS = {
    up: '<i class="fa-solid fa-arrow-trend-up" style="color:#2ebd85;"></i>',
    range: '<i class="fa-solid fa-right-left" style="color:#848e9c;"></i>',
    down: '<i class="fa-solid fa-arrow-trend-down" style="color:#f6465d;"></i>'
};
const NOTE_VOLATILITY_ICONS = {
    low: '<i class="fa-solid fa-signal" style="opacity:0.4;"></i>',
    medium: '<i class="fa-solid fa-chart-simple"></i>',
    high: '<i class="fa-solid fa-chart-column"></i>'
};

// Renders one note as a row matching the trade log's row width, but with its own
// free-form flex layout (not the 13-column grid) - called from trades.js's
// renderTradeLog() so notes interleave with trades by date in the same table.
function buildNoteRowHtml(note) {
    const [y, m, d] = note.date.split('-').map(Number);
    const dateLabel = `${m}/${d}/${y}`;

    const dayTrades = getAllTradeRows().filter(r => r.returnAmount !== null && dateKey(new Date(r.date)) === note.date);
    const wins = dayTrades.filter(r => r.status === 'WIN').length;
    const losses = dayTrades.filter(r => r.status === 'LOSS').length;
    const open = dayTrades.filter(r => r.status === 'OPEN').length;

    return `
    <div class="day-note-row" onclick="openNoteModal('${note.id}')">
        <i class="fa-solid fa-bookmark day-note-bookmark"></i>
        <span class="day-note-date">${dateLabel}</span>
        ${note.mood ? NOTE_MOOD_ICONS[note.mood] : ''}
        ${note.condition ? NOTE_CONDITION_ICONS[note.condition] : ''}
        ${note.volatility ? NOTE_VOLATILITY_ICONS[note.volatility] : ''}
        <span class="day-note-summary">${escapeHtml(note.summary || '')}</span>
        <span class="day-note-stats">
            <span class="day-note-stat" title="Trades">${dayTrades.length || '-'}</span>
            <span class="day-note-stat value-positive" title="Wins">${wins}</span>
            <span class="day-note-stat" title="Open">${open}</span>
            <span class="day-note-stat value-negative" title="Losses">${losses}</span>
        </span>
        <button class="day-note-pin-btn ${note.pinned ? 'active' : ''}" onclick="event.stopPropagation(); toggleNotePinned('${note.id}')" title="${note.pinned ? 'Unpin from top' : 'Pin to top'}">
            <i class="fa-solid fa-thumbtack"></i>
        </button>
    </div>`;
}
