/* asymbode-math — polynomial utilities and root finding.
 *
 * A polynomial is an array of coefficients where coeffs[i] is the coefficient
 * of s^i (i.e. coeffs[0] is the constant term).
 */
(function (A) {
'use strict';

// ===========================================================================
// Polynomial arithmetic
// ===========================================================================

function polyTrim(p) {
    const a = p.slice();
    while (a.length > 1 && a[a.length - 1] === 0) a.pop();
    if (a.length === 0) return [0];
    return a;
}

function polyIsZero(p) { return p.every(c => c === 0); }

function polyDegree(p) {
    const t = polyTrim(p);
    return polyIsZero(t) ? -1 : t.length - 1;
}

function polyAdd(a, b) {
    const n = Math.max(a.length, b.length);
    const out = new Array(n).fill(0);
    for (let i = 0; i < n; i++) out[i] = (a[i] || 0) + (b[i] || 0);
    return polyTrim(out);
}

function polyMul(a, b) {
    if (polyIsZero(a) || polyIsZero(b)) return [0];
    const out = new Array(a.length + b.length - 1).fill(0);
    for (let i = 0; i < a.length; i++)
        for (let j = 0; j < b.length; j++)
            out[i + j] += a[i] * b[j];
    return polyTrim(out);
}

function polyScale(a, k) { return polyTrim(a.map(c => c * k)); }

function polyPow(a, n) {
    let out = [1];
    let base = a;
    let e = n;
    while (e > 0) {
        if (e & 1) out = polyMul(out, base);
        base = polyMul(base, base);
        e >>= 1;
    }
    return out;
}

/** Strip exact factors of s (zero roots at the origin) from a polynomial. */
function polyStripOrigin(p) {
    p = polyTrim(p);
    let k = 0;
    const scale = Math.max(...p.map(c => Math.abs(c)));
    while (p.length > 1 && Math.abs(p[0]) <= 1e-14 * scale) {
        p = p.slice(1);
        k++;
        // recompute scale from remaining (highest stays)
    }
    // after stripping, also catch remaining exact-zero constants
    while (p.length > 1 && p[0] === 0) { p = p.slice(1); k++; }
    return { k, rest: polyTrim(p) };
}

// ===========================================================================
// Root finding
// ===========================================================================

function rootsOf(poly) {
    const p = polyTrim(poly);
    const n = polyDegree(p);
    if (n <= 0) return [];
    if (n === 1) return [{ re: -p[0] / p[1], im: 0 }];

    const lead = p[p.length - 1];
    const m = p.map(c => c / lead); // monic

    if (n === 2) {
        const b = m[1], c = m[0];
        const disc = b * b - 4 * c;
        if (disc >= 0) {
            const sq = Math.sqrt(disc);
            const q = -0.5 * (b + (b >= 0 ? sq : -sq));
            if (q === 0) return [{ re: 0, im: 0 }, { re: -b, im: 0 }];
            return [{ re: q, im: 0 }, { re: c / q, im: 0 }];
        }
        const re = -b / 2, im = Math.sqrt(-disc) / 2;
        return [{ re, im }, { re, im: -im }];
    }

    // Durand–Kerner on the monic polynomial
    const evalP = (x) => {
        let r = { re: 0, im: 0 };
        for (let i = n; i >= 0; i--) {
            const nr = r.re * x.re - r.im * x.im + m[i];
            const ni = r.re * x.im + r.im * x.re;
            r = { re: nr, im: ni };
        }
        return r;
    };
    const evalD = (x) => { // derivative via Horner
        let r = { re: 0, im: 0 };
        for (let i = n; i >= 1; i--) {
            const nr = r.re * x.re - r.im * x.im + m[i];
            const ni = r.re * x.im + r.im * x.re;
            r = { re: nr, im: ni };
        }
        return r;
    };
    const maxAbs = Math.max(...m.slice(0, n).map(Math.abs));
    const scale = Math.pow(1 + maxAbs, 1 / n);
    const seed = { re: 0.4, im: 0.9 };
    const z = [];
    let pw = { re: 1, im: 0 };
    for (let k = 0; k < n; k++) {
        z.push({ re: pw.re * scale, im: pw.im * scale });
        const nr = pw.re * seed.re - pw.im * seed.im;
        const ni = pw.re * seed.im + pw.im * seed.re;
        pw = { re: nr, im: ni };
    }
    for (let iter = 0; iter < 300; iter++) {
        let maxDelta = 0;
        for (let i = 0; i < n; i++) {
            let den = { re: 1, im: 0 };
            for (let j = 0; j < n; j++) {
                if (i === j) continue;
                const dr = z[i].re - z[j].re, di = z[i].im - z[j].im;
                const nr = den.re * dr - den.im * di;
                const ni = den.re * di + den.im * dr;
                den = { re: nr, im: ni };
            }
            const d2 = den.re * den.re + den.im * den.im;
            if (d2 < 1e-300) continue;
            const pv = evalP(z[i]);
            const dre = (pv.re * den.re + pv.im * den.im) / d2;
            const dim = (pv.im * den.re - pv.re * den.im) / d2;
            z[i] = { re: z[i].re - dre, im: z[i].im - dim };
            maxDelta = Math.max(maxDelta, Math.hypot(dre, dim));
        }
        if (maxDelta < 1e-15) break;
    }

    // Multiple roots converge slowly under plain Newton — cluster the DK results
    // and polish each cluster with multiplicity-aware Newton (r ← r − m·p/p′).
    // Each cluster yields `mult` copies of one high-precision root.
    let refined = z;
    for (let pass = 0; pass < 2; pass++) {
        const groups = [];
        for (const root of refined) {
            let best = null, bestD = Infinity;
            for (const g of groups) {
                const d = Math.hypot(root.re - g.re, root.im - g.im);
                const sc = Math.max(1, Math.hypot(root.re, root.im), Math.hypot(g.re, g.im));
                if (d <= 1e-4 * sc && d < bestD) { best = g; bestD = d; }
            }
            if (best) { best.members.push(root); best.re = 0; best.im = 0; }
            else groups.push({ members: [root], re: root.re, im: root.im });
        }
        refined = [];
        for (const g of groups) {
            const mult = g.members.length;
            let rr = {
                re: g.members.reduce((s, u) => s + u.re, 0) / mult,
                im: g.members.reduce((s, u) => s + u.im, 0) / mult,
            };
            const allReal = g.members.every(u =>
                Math.abs(u.im) <= 1e-4 * Math.max(1, Math.hypot(u.re, u.im)));
            if (allReal) rr.im = 0;
            for (let t = 0; t < 40; t++) {
                const pv = evalP(rr);
                const dv = evalD(rr);
                if (allReal) {
                    if (Math.abs(dv.re) < 1e-300) break;
                    const delta = mult * pv.re / dv.re;
                    rr.re -= delta;
                    rr.im = 0;
                    if (Math.abs(delta) <= 1e-15 * Math.max(1, Math.abs(rr.re))) break;
                } else {
                    const d2 = dv.re * dv.re + dv.im * dv.im;
                    if (d2 < 1e-300) break;
                    const qr = (pv.re * dv.re + pv.im * dv.im) / d2;
                    const qi = (pv.im * dv.re - pv.re * dv.im) / d2;
                    rr.re -= mult * qr;
                    rr.im -= mult * qi;
                    if (Math.hypot(mult * qr, mult * qi) <= 1e-15 * Math.max(1, Math.hypot(rr.re, rr.im))) break;
                }
            }
            if (!isFinite(rr.re) || !isFinite(rr.im)) continue;
            for (let k = 0; k < mult; k++) refined.push({ re: rr.re, im: rr.im });
        }
    }
    return refined;
}

/** Group roots into reals and conjugate pairs (for real-coefficient polynomials). */
function classifyRoots(rs) {
    const reals = [], pairs = [];
    const used = new Array(rs.length).fill(false);
    const items = rs.map(z => {
        const mag = Math.max(1, Math.hypot(z.re, z.im));
        return Math.abs(z.im) <= 1e-6 * mag ? { re: z.re, im: 0 } : z;
    });
    for (let i = 0; i < items.length; i++) {
        if (used[i]) continue;
        const z = items[i];
        if (z.im === 0) { reals.push(z.re); used[i] = true; continue; }
        let best = -1, bestD = Infinity;
        for (let j = 0; j < items.length; j++) {
            if (i === j || used[j] || items[j].im === 0) continue;
            const d = Math.hypot(z.re - items[j].re, z.im + items[j].im);
            if (d < bestD) { bestD = d; best = j; }
        }
        const mag = Math.max(1, Math.hypot(z.re, z.im));
        used[i] = true;
        if (best >= 0 && bestD <= 1e-4 * mag) used[best] = true;
        pairs.push({ re: z.re, im: Math.abs(z.im) });
    }
    return { reals, pairs };
}

A.polyTrim = polyTrim;
A.polyIsZero = polyIsZero;
A.polyDegree = polyDegree;
A.polyAdd = polyAdd;
A.polyMul = polyMul;
A.polyScale = polyScale;
A.polyPow = polyPow;
A.polyStripOrigin = polyStripOrigin;
A.rootsOf = rootsOf;
A.classifyRoots = classifyRoots;

})(globalThis.BodeMath = globalThis.BodeMath || {});
