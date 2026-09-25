/* asymbode — formatting helpers, clamping and tiny DOM/status utilities.
 * Must load right after state.js: later modules destructure these at load time. */
(function (A) {
'use strict';

const els = A.els;

const SUP = {
    '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
    '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
};

function supStr(n) { return String(n).split('').map(c => SUP[c] || c).join(''); }

function fmtDecade(k) {
    if (Number.isInteger(k) && Math.abs(k) <= 12) return '10' + supStr(k);
    return fmtNum(Math.pow(10, k));
}

function fmtNum(v, sig) {
    if (v === 0) return '0';
    const a = Math.abs(v);
    if (a >= 1e5 || a < 1e-3) {
        const e = Math.floor(Math.log10(a));
        const m = v / Math.pow(10, e);
        const ms = (Math.abs(m - Math.round(m)) < 1e-9) ? String(Math.round(m)) : m.toFixed(1);
        return ms + 'e' + (e >= 0 ? '+' : '') + e;
    }
    return String(Number(v.toPrecision(sig || 4)));
}

function fmtW(w) { return fmtNum(w); }

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

/** Write HTML into the bottom status bar. */
function setStatus(html) { els.status.innerHTML = html; }

/** Show/hide a message element (text-only, e.g. the transfer-function error). */
function showMsg(el, text, show) {
    if (!el) return;
    if (show) { el.textContent = text; el.hidden = false; }
    else { el.hidden = true; el.textContent = ''; }
}

A.supStr = supStr;
A.fmtDecade = fmtDecade;
A.fmtNum = fmtNum;
A.fmtW = fmtW;
A.clamp = clamp;
A.setStatus = setStatus;
A.showMsg = showMsg;

})(globalThis.BodeApp = globalThis.BodeApp || {});
