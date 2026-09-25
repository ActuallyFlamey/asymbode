/* asymbode — solution overlay: legend, Ctrl-held exact view, checklist. */
(function (A) {
'use strict';

const state = A.state;
const els = A.els;
const BM = window.BodeMath;
const { setStatus } = A;

const CHECK_HINT =
    '<div class="empty-hint">Load a transfer function, draw your asymptote, then press <b>Show solution &amp; Check</b>.</div>';

/** Hide the overlay and put the checklist back to its "not checked yet" hint. */
function resetSolution() {
    state.showSol = false;
    if (els.lgSolution) els.lgSolution.hidden = true;
    if (els.lgExact) els.lgExact.hidden = true;
    if (els.checkResults) els.checkResults.innerHTML = CHECK_HINT;
}

function updateLegend() {
    if (els.lgSolution) els.lgSolution.hidden = !(state.showSol && !state.ctrlHeld);
    if (els.lgExact) els.lgExact.hidden = !(state.showSol && state.ctrlHeld);
}

function setCtrlHeld(v) {
    if (state.ctrlHeld === v) return;
    state.ctrlHeld = v;
    updateLegend();
    if (state.showSol) {
        setStatus(v
            ? 'Real Bode plot (exact G(jω)) — release <b>Ctrl</b> for the asymptotic solution'
            : 'Asymptotic solution shown — hold <b>Ctrl</b> for the real Bode plot');
        A.render();
    }
}

function renderCheck(res) {
    const box = els.checkResults;
    box.innerHTML = '';
    const allOk = res.score.ok === res.score.total;
    const score = document.createElement('div');
    score.className = 'check-score ' + (allOk ? 'good' : 'bad');
    score.textContent = res.score.ok + ' / ' + res.score.total + ' correct' +
        (allOk ? ' — perfect!' : '');
    box.appendChild(score);
    for (const it of res.items) {
        const row = document.createElement('div');
        row.className = 'check-item ' + (it.ok ? 'ok' : 'fail') + (it.plot ? ' on-' + it.plot : '');
        const mark = document.createElement('span');
        mark.className = 'mark';
        mark.textContent = it.ok ? '✓' : '✗';
        row.appendChild(mark);
        if (it.plot) {
            const tag = document.createElement('span');
            tag.className = 'plot-tag ' + it.plot;
            tag.textContent = it.plot === 'mag' ? 'mag' : 'φ';
            tag.title = 'Drawn on the ' + (it.plot === 'mag' ? 'magnitude' : 'phase') + ' graph';
            row.appendChild(tag);
        }
        const txt = document.createElement('span');
        txt.textContent = it.text;
        row.appendChild(txt);
        box.appendChild(row);
    }
    const hint = document.createElement('div');
    hint.className = 'ctrl-hint';
    hint.innerHTML = 'hold <kbd>Ctrl</kbd> to see the real Bode plot';
    box.appendChild(hint);
}

function showSolutionAndCheck() {
    if (!state.tf) {
        setStatus('Fix the transfer function in the sidebar — it loads automatically when you leave a field');
        return;
    }
    const res = BM.checkSolution(state.tf, state.user);
    state.showSol = true;
    A.fitView();
    renderCheck(res);
    updateLegend();
    setStatus('Solution shown — score <b>' + res.score.ok + '/' + res.score.total + '</b>' +
        (res.score.ok === res.score.total ? ' — perfect!' : '') +
        ' · hold <b>Ctrl</b> for the real Bode plot · <b>F</b> fits the view');
    return res;
}

A.resetSolution = resetSolution;
A.updateLegend = updateLegend;
A.setCtrlHeld = setCtrlHeld;
A.showSolutionAndCheck = showSolutionAndCheck;

})(globalThis.BodeApp = globalThis.BodeApp || {});
