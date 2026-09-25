/* asymbode — plot geometry: pixel ↔ data transforms, grid snapping, axis
 * ticks and "fit view". */
(function (A) {
'use strict';

const state = A.state;
const canvas = A.canvas;
const BM = window.BodeMath;
const { MARGINS } = A;
const { fmtW } = A;

function geom(canvasW, canvasH) {
    return {
        l: MARGINS.l, r: canvasW - MARGINS.r,
        t: MARGINS.t, b: canvasH - MARGINS.b,
        w: canvasW - MARGINS.l - MARGINS.r,
        h: canvasH - MARGINS.t - MARGINS.b,
    };
}

function xToPx(xLog, g) {
    return g.l + (xLog - state.view.xmin) / (state.view.xmax - state.view.xmin) * g.w;
}

function pxToX(px, g) {
    return state.view.xmin + (px - g.l) / g.w * (state.view.xmax - state.view.xmin);
}

function yToPx(y, g, yr) { return g.t + (yr.max - y) / (yr.max - yr.min) * g.h; }

function pxToY(px, g, yr) { return yr.max - (px - g.t) / g.h * (yr.max - yr.min); }

// Vertical grid lines: bold decades + minor log10(2..9) lines (see drawAxes).
const GRID_OFFS = [0, Math.log10(2), Math.log10(3), Math.log10(4), Math.log10(5),
    Math.log10(6), Math.log10(7), Math.log10(8), Math.log10(9)];
const GRID_TOL = 0.02; // decades — this close to a grid line snaps onto it

function minorGridVisible(plot) {
    const g = plot === 'ph' ? geom(canvas.phW, canvas.phH) : geom(canvas.magW, canvas.magH);
    const span = state.view.xmax - state.view.xmin;
    return span <= 16 && g.w / span > 46;
}

/**
 * Snap a log-frequency to the drawing grid: exactly onto a vertical grid line
 * when the click lands on one (the 0.05-decade lattice misses minor lines
 * like log10(3) = 0.477…), otherwise onto the 0.05-decade lattice.
 */
function snapX(xLog, plot) {
    if (!isFinite(xLog)) return xLog;
    const offs = minorGridVisible(plot) ? GRID_OFFS : [0];
    const k = Math.floor(xLog);
    let best = null, bestD = GRID_TOL;
    for (const o of offs) {
        for (const cand of [k + o, k + 1 + o]) {
            const d = Math.abs(xLog - cand);
            if (d < bestD) { bestD = d; best = cand; }
        }
    }
    if (best != null) return best;
    return Math.round(xLog / 0.05) * 0.05;
}

// ---------------------------------------------------------------------------
// axis ticks
// ---------------------------------------------------------------------------

function yTickStep(span, isPhase) {
    const target = span / 6;
    const cands = isPhase
        ? [1, 2, 5, 10, 15, 30, 45, 90, 180, 360]
        : [1, 2, 5, 10, 20, 25, 50, 100, 200];
    for (const c of cands) if (c >= target) return c;
    return cands[cands.length - 1];
}

function niceYBounds(min, max, isPhase) {
    if (!isFinite(min) || !isFinite(max)) { min = -1; max = 1; }
    if (max - min < 1e-9) { min -= 1; max += 1; }
    const pad = (max - min) * 0.08;
    min -= pad; max += pad;
    const step = yTickStep(max - min, isPhase);
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    return { min: lo, max: hi, step };
}

// ---------------------------------------------------------------------------
// fit view
// ---------------------------------------------------------------------------

function fitView() {
    const xs = [];
    const collect = (st) => { if (st) for (const e of st.elems) xs.push(BM.cornerX(e)); };
    collect(state.user);
    if (state.tfState) collect(state.tfState);
    let xmin, xmax;
    if (xs.length) { xmin = Math.min.apply(null, xs); xmax = Math.max.apply(null, xs); }
    else { xmin = -1; xmax = 1; }
    if (xmax - xmin < 2) { const m = (xmin + xmax) / 2; xmin = m - 1; xmax = m + 1; }
    xmin -= 0.5; xmax += 0.5;
    state.view.xmin = xmin;
    state.view.xmax = xmax;

    let ymin = Infinity, ymax = -Infinity, pmin = Infinity, pmax = -Infinity;
    const scanMag = (st) => {
        if (!st) return;
        for (const p of BM.asymMagPoints(st, xmin, xmax)) {
            if (p.y < ymin) ymin = p.y;
            if (p.y > ymax) ymax = p.y;
        }
    };
    const scanPh = (st) => {
        if (!st) return;
        for (const p of BM.asymPhasePoints(st, xmin, xmax)) {
            if (p.y < pmin) pmin = p.y;
            if (p.y > pmax) pmax = p.y;
        }
    };
    scanMag(A.userForPlot('mag'));
    scanPh(A.userForPlot('ph'));
    if (state.showSol) { scanMag(state.tfState); scanPh(state.tfState); }
    // Nothing placed yet (or only a flat curve) → the fit would collapse to a
    // zero-height window, sending the placement preview line off the chart.
    if (ymax - ymin < 40) { const m = (ymin + ymax) / 2; ymin = m - 20; ymax = m + 20; }
    if (pmax - pmin < 180) { const m = (pmin + pmax) / 2; pmin = m - 90; pmax = m + 90; }
    state.yMag = niceYBounds(isFinite(ymin) ? ymin : -40, isFinite(ymax) ? ymax : 40, false);
    state.yPh = niceYBounds(isFinite(pmin) ? pmin : -225, isFinite(pmax) ? pmax : 225, true);
    A.setStatus('Fitted view to ω <span class="val">' + fmtW(Math.pow(10, xmin)) + '</span> … <span class="val">' +
        fmtW(Math.pow(10, xmax)) + '</span> rad/s');
    A.render();
}

A.geom = geom;
A.xToPx = xToPx;
A.pxToX = pxToX;
A.yToPx = yToPx;
A.pxToY = pxToY;
A.minorGridVisible = minorGridVisible;
A.snapX = snapX;
A.yTickStep = yTickStep;
A.niceYBounds = niceYBounds;
A.fitView = fitView;

})(globalThis.BodeApp = globalThis.BodeApp || {});
