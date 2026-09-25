/* asymbode — wheel-zoom math: pure range scaling shared by pointer.js and the
 * self-tests. Keep this file free of DOM and of A.state so it can run in node. */
(function (A) {
'use strict';

/** Visible ω window, in decades of log10(ω). */
const X_SPAN = { min: 0.4, max: 24 };
/** Visible y window, in dB (magnitude) or degrees (phase). */
const Y_SPAN = { min: 4, max: 3600 };
/** Span change of one wheel notch (12 % — matches the old ω zoom). */
const STEP = 1.12;

/**
 * Scale [lo, hi] about `anchor` by factor `f`, keeping the anchor fixed.
 * Returns {min, max}, or null when the result would break `limits` (or when
 * any input is unusable) — callers treat null as "gesture rejected".
 */
function scaleAbout(lo, hi, anchor, f, limits) {
    if (!(f > 0) || !isFinite(f)) return null;
    if (!isFinite(lo) || !isFinite(hi) || !isFinite(anchor)) return null;
    const min = anchor + (lo - anchor) * f;
    const max = anchor + (hi - anchor) * f;
    const span = max - min;
    if (!isFinite(span) || span < limits.min || span > limits.max) return null;
    return { min, max };
}

/** ω window {xmin, xmax} (log10 decades) scaled about `anchorX`, or null. */
function scaleX(view, anchorX, f) {
    const r = scaleAbout(view.xmin, view.xmax, anchorX, f, X_SPAN);
    return r ? { xmin: r.min, xmax: r.max } : null;
}

/** y window {min, max} (dB or degrees) scaled about `anchorY`, or null. */
function scaleY(yr, anchorY, f) {
    return scaleAbout(yr.min, yr.max, anchorY, f, Y_SPAN);
}

/**
 * Uniform "zoom the view": the ω window and every y window (`ys`) scale by
 * the same factor about their anchors, so the drawing magnifies like an image
 * and the curve slopes keep their visual angle. All-or-nothing — null when
 * any window would leave its span limits.
 *
 * Returns { view: {xmin,xmax}, ys: [{min,max}, …] }; the caller copies the
 * results back into state.
 */
function scaleView(view, ys, anchorX, anchorsY, f) {
    const x = scaleX(view, anchorX, f);
    if (!x) return null;
    const out = [];
    for (let i = 0; i < ys.length; i++) {
        const y = scaleY(ys[i], anchorsY[i], f);
        if (!y) return null;
        out.push(y);
    }
    return { view: x, ys: out };
}

/** Zoom factor of one wheel notch; null for a horizontal-only scroll. */
function wheelFactor(deltaY) {
    if (!deltaY || !isFinite(deltaY)) return null;
    return deltaY < 0 ? 1 / STEP : STEP;
}

/**
 * What the wheel cursor is over: 'view' inside the plot rectangle, 'x' in the
 * margins above/below it (the ω axis), 'y' in the margins left/right of it
 * (that graph's dB/degree axis).
 */
function wheelTarget(px, py, g) {
    if (px >= g.l && px <= g.r && py >= g.t && py <= g.b) return 'view';
    if (px < g.l || px > g.r) return 'y';
    return 'x';
}

A.X_SPAN = X_SPAN;
A.Y_SPAN = Y_SPAN;
A.ZOOM_STEP = STEP;
A.scaleAbout = scaleAbout;
A.scaleX = scaleX;
A.scaleY = scaleY;
A.scaleView = scaleView;
A.wheelFactor = wheelFactor;
A.wheelTarget = wheelTarget;

})(globalThis.BodeApp = globalThis.BodeApp || {});
