/* asymbode-math — shared formatting helpers: dB values, ω values, superscripts. */
(function (A) {
'use strict';

function fmtDb(v) {
    if (!isFinite(v)) return String(v);
    return (Math.abs(v - Math.round(v)) < 0.05) ? String(Math.round(v)) : v.toFixed(1);
}

function fmtW(w) {
    const a = Math.abs(w);
    if (a === 0) return '0';
    if (a >= 1e5 || a < 1e-3) {
        const e = Math.floor(Math.log10(a));
        const m = w / Math.pow(10, e);
        const ms = Math.abs(m - 1) < 1e-9
            ? '10'
            : (Math.abs(m - Math.round(m)) < 1e-9 ? String(Math.round(m)) : Number(m.toPrecision(3))) + '·10';
        return ms + sup(e);
    }
    return String(Number(w.toPrecision(4)));
}

const SUPMAP = {
    '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
    '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
};

function sup(n) { return String(n).split('').map(c => SUPMAP[c] || c).join(''); }

A.fmtDb = fmtDb;
A.fmtW = fmtW;
A.sup = sup;

})(globalThis.BodeMath = globalThis.BodeMath || {});
