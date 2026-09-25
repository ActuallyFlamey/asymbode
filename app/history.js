/* asymbode — undo / redo.
 *
 * Snapshots cover the drawing state only (the user model + mirror toggle);
 * view, selection and tool are UI state and intentionally not part of history. */
(function (A) {
'use strict';

const state = A.state;
const els = A.els;
const { setStatus } = A;

const HIST_MAX = 200;
let hist = [], hIdx = -1;

function histSnap() {
    return JSON.stringify({ u: state.user, s: state.syncPlots });
}

function recordHistory() {
    const s = histSnap();
    if (hIdx >= 0 && hist[hIdx] === s) return false;
    hist.length = hIdx + 1;
    hist.push(s);
    if (hist.length > HIST_MAX) { hist.shift(); }
    hIdx = hist.length - 1;
    updateHistoryButtons();
    return true;
}

function resetHistory() {
    hist = [histSnap()];
    hIdx = 0;
    updateHistoryButtons();
}

function restoreHist(s) {
    const o = JSON.parse(s);
    state.user = o.u;
    state.syncPlots = o.s !== false;
    if (els.syncToggle) els.syncToggle.checked = state.syncPlots;
    if (state.selId != null && !state.user.elems.some(e => e.id === state.selId))
        state.selId = null;
    A.updateSidebar();
    A.render();
}

function undo() {
    if (hIdx <= 0) { setStatus('Nothing to undo'); return false; }
    hIdx--;
    restoreHist(hist[hIdx]);
    updateHistoryButtons();
    setStatus('Undid last change — <b>Ctrl+Z</b> steps further back · <b>Ctrl+Y</b> redoes');
    return true;
}

function redo() {
    if (hIdx >= hist.length - 1) { setStatus('Nothing to redo'); return false; }
    hIdx++;
    restoreHist(hist[hIdx]);
    updateHistoryButtons();
    setStatus('Redid last change — <b>Ctrl+Z</b> undoes again');
    return true;
}

function updateHistoryButtons() {
    if (els.btnUndo) els.btnUndo.disabled = hIdx <= 0;
    if (els.btnRedo) els.btnRedo.disabled = hIdx >= hist.length - 1;
}

A.recordHistory = recordHistory;
A.resetHistory = resetHistory;
A.undo = undo;
A.redo = redo;

})(globalThis.BodeApp = globalThis.BodeApp || {});
