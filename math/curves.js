/* asymbode-math — exact (real) response and straight-line (asymptotic) curves.
 *
 * Straight-line magnitude (x = log10(w)):
 *   A(x) = 20lg|K| + 20(z0-p0)x
 *          + sum_z ±20*order*max(0, x - log10(w))        (real; complex uses 40)
 *          ∓ sum_p ...
 *   RHP factors raise/lower magnitude exactly like min-phase ones (phase differs).
 *
 * Straight-line phase (deg):
 *   P(w) = 90(z0-p0) [+180 if K<0]
 *          + sum over real corners: s * 90*order * clamp((x-(xw-1))/2, 0, 1)
 *          + sum over complex pairs: s * 180*order * clamp((x-(xn-1))/2, 0, 1)
 *   where s = +1 for a zero, -1 for a pole, and flipped again for RHP factors.
 */
(function (A) {
'use strict';

const { freqOf } = A;

// ===========================================================================
// Complex arithmetic
// ===========================================================================

function cmul(a, b) { return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re }; }

function cdiv(a, b) {
    const d = b.re * b.re + b.im * b.im;
    return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
}

function cpowk(base, k) { // integer power
    let out = { re: 1, im: 0 };
    let b = base, n = Math.abs(k);
    const neg = k < 0;
    while (n > 0) {
        if (n & 1) out = cmul(out, b);
        b = cmul(b, b);
        n >>= 1;
    }
    return neg ? cdiv({ re: 1, im: 0 }, out) : out;
}

// ===========================================================================
// Exact (real) response
// ===========================================================================

/** Exact G(jω). Returns {re, im, db, phase}. ω > 0. */
function exactPoint(tf, w) {
    let g = { re: tf.gain, im: 0 };
    if (tf.z0) g = cmul(g, cpowk({ re: 0, im: w }, tf.z0));
    if (tf.p0) g = cdiv(g, cpowk({ re: 0, im: w }, tf.p0));
    for (const e of tf.zeros) g = cmul(g, elemFactor(e, w, e.order));
    for (const e of tf.poles) g = cdiv(g, elemFactor(e, w, e.order));
    const mag = Math.hypot(g.re, g.im);
    return {
        re: g.re, im: g.im,
        db: mag > 0 ? 20 * Math.log10(mag) : -Infinity,
        phase: Math.atan2(g.im, g.re) * 180 / Math.PI,
    };
}

function elemFactor(e, w, order) {
    if (e.kind === 'real') {
        // 1 - s/r with r = -w (LHP) or r = +w (RHP): use (1 + jw/w) for LHP,
        // (1 - jw/w) for RHP — both have the same magnitude shape.
        const f = e.rhp ? { re: 1, im: -w / e.w } : { re: 1, im: w / e.w };
        return order === 1 ? f : cpowk(f, order);
    }
    // complex pair: 1 + 2ζ(jw/wn) + (jw/wn)^2
    const t = w / e.wn;
    const f = { re: 1 - t * t, im: 2 * e.zeta * t };
    return order === 1 ? f : cpowk(f, order);
}

/**
 * Exact magnitude dB and phase (deg, continuous — branch-aligned to
 * `phaseTargetAtXmin` at the first sample) sampled uniformly in log10(ω) over
 * [xmin, xmax].
 */
function exactCurve(tf, xmin, xmax, nSamples, phaseTargetAtXmin) {
    const n = Math.max(8, nSamples | 0);
    const pts = new Array(n + 1);
    let prev = null;
    for (let i = 0; i <= n; i++) {
        const x = xmin + (xmax - xmin) * i / n;
        const w = Math.pow(10, x);
        const p = exactPoint(tf, w);
        let phase = p.phase;
        if (prev === null) {
            if (phaseTargetAtXmin != null && isFinite(phaseTargetAtXmin))
                phase += 360 * Math.round((phaseTargetAtXmin - phase) / 360);
        } else {
            phase += 360 * Math.round((prev - phase) / 360);
        }
        prev = phase;
        pts[i] = { x, db: p.db, ph: phase };
    }
    return pts;
}

// ===========================================================================
// Straight-line (asymptotic) curves
// ===========================================================================

function cornerX(e) { return Math.log10(freqOf(e)); }

/** dB/dec contribution of one element per order. */
function magSlopeUnit(e) {
    const base = e.kind === 'complex' ? 40 : 20;
    return e.type === 'zero' ? base : -base;
}

/** Degrees of phase change per order. */
function phaseTotal(e) {
    const base = e.kind === 'complex' ? 180 : 90;
    let s = e.type === 'zero' ? base : -base;
    if (e.rhp || (e.kind === 'complex' && e.zeta < 0)) s = -s;
    return s;
}

/** Asymptotic magnitude in dB at x = log10(ω). state: {gainDB, z0, p0, elems} */
function asymMag(state, x) {
    let y = state.gainDB + 20 * (state.z0 - state.p0) * x;
    for (const e of state.elems) {
        y += magSlopeUnit(e) * e.order * Math.max(0, x - cornerX(e));
    }
    return y;
}

/** Asymptotic phase in degrees at ω = 10^x. */
function asymPhase(state, x) {
    let y = 90 * (state.z0 - state.p0);
    if (state.gainSign != null && state.gainSign < 0) y += 180;
    for (const e of state.elems) {
        const xc = cornerX(e);
        const t = Math.min(1, Math.max(0, (x - (xc - 1)) / 2));
        y += phaseTotal(e) * e.order * t;
    }
    return y;
}

/** Build polyline vertices for the magnitude asymptote over [xmin,xmax]. */
function asymMagPoints(state, xmin, xmax) {
    const xs = [xmin, xmax];
    for (const e of state.elems) {
        const xc = cornerX(e);
        if (xc > xmin && xc < xmax) xs.push(xc);
    }
    xs.sort((a, b) => a - b);
    const uniq = [];
    for (const x of xs) if (!uniq.length || x - uniq[uniq.length - 1] > 1e-12) uniq.push(x);
    return uniq.map(x => ({ x, y: asymMag(state, x) }));
}

/** Build polyline vertices for the phase asymptote over [xmin,xmax]. */
function asymPhasePoints(state, xmin, xmax) {
    const breaks = [xmin, xmax];
    for (const e of state.elems) {
        const xc = cornerX(e);
        breaks.push(Math.max(xmin, xc - 1), Math.min(xmax, xc + 1));
    }
    breaks.sort((a, b) => a - b);
    const uniq = [];
    for (const x of breaks) if (!uniq.length || x - uniq[uniq.length - 1] > 1e-12) uniq.push(x);
    return uniq.map(x => ({ x, y: asymPhase(state, x) }));
}

/** Mutable "drawing" state describing a transfer function as an asymptote. */
function stateFromTF(tf) {
    return {
        gainDB: 20 * Math.log10(Math.abs(tf.gain)),
        gainSign: tf.gain < 0 ? -1 : 1,
        z0: tf.z0, p0: tf.p0,
        elems: [...tf.zeros, ...tf.poles].map(e => Object.assign({}, e)),
    };
}

A.exactPoint = exactPoint;
A.exactCurve = exactCurve;
A.cornerX = cornerX;
A.magSlopeUnit = magSlopeUnit;
A.phaseTotal = phaseTotal;
A.asymMag = asymMag;
A.asymPhase = asymPhase;
A.asymMagPoints = asymMagPoints;
A.asymPhasePoints = asymPhasePoints;
A.stateFromTF = stateFromTF;

})(globalThis.BodeMath = globalThis.BodeMath || {});
