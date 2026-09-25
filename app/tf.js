/* asymbode — transfer-function fields: preview, parsing and loading. */
(function (A) {
'use strict';

const state = A.state;
const els = A.els;
const BM = window.BodeMath;
const { setStatus, showMsg } = A;

/** Raw combined expression from the K / numerator / denominator fields. */
function tfRawExpr() {
    return BM.tfExpr(
        els.kInput && els.kInput.value,
        els.numInput && els.numInput.value,
        els.denInput && els.denInput.value);
}

function updateTfPreview() {
    if (!els.tfRender || !els.numInput || !els.denInput) return;
    els.tfRender.innerHTML = BM.texPreview(
        els.kInput && els.kInput.value,
        els.numInput.value,
        els.denInput.value);
}

function loadTF() {
    const raw = tfRawExpr();
    try {
        const tf = BM.parseTransferFunction(raw);
        state.tf = tf;
        state.tfState = BM.stateFromTF(tf);
        state.ctrlHeld = false;
        A.resetSolution();
        showMsg(els.tfError, '', false);
        setStatus('Transfer function loaded — place poles &amp; zeroes to match its Bode plot, then <b>Show solution &amp; Check</b>');
        return tf;
    } catch (err) {
        state.tf = null;
        state.tfState = null;
        showMsg(els.tfError, 'G(s) error: ' + err.message, true);
        setStatus('Could not parse the transfer function');
        return null;
    }
}

A.tfRawExpr = tfRawExpr;
A.updateTfPreview = updateTfPreview;
A.loadTF = loadTF;

})(globalThis.BodeApp = globalThis.BodeApp || {});
