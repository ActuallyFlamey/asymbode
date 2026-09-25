/* asymbode-math — AST → rational function → factored transfer function.
 *
 * Transfer function model:
 *   {
 *     gain: number,          // K (signed real)
 *     z0: int,               // zeros at the origin (s^z0)
 *     p0: int,               // poles at the origin (1/s^p0)
 *     zeros: Elem[],         // finite zeros
 *     poles: Elem[],         // finite poles
 *   }
 * Elem (real):   { kind:'real',    w: >0,  rhp: bool, order: >=1 }
 * Elem (complex):{ kind:'complex', wn: >0, zeta: real, order: >=1 }  (conjugate pair)
 */
(function (A) {
'use strict';

const ParseError = A.ParseError;
const {
    polyTrim, polyIsZero, polyDegree, polyAdd, polyMul, polyScale, polyPow,
    polyStripOrigin, rootsOf, classifyRoots,
} = A;

// ===========================================================================
// AST → rational function
// ===========================================================================

function ratOf(ast) {
    switch (ast.t) {
        case 'num': return { num: [ast.v], den: [1] };
        case 's': return { num: [0, 1], den: [1] };
        case 'neg': { const r = ratOf(ast.a); return { num: polyScale(r.num, -1), den: r.den }; }
        case 'add': case 'sub': {
            const a = ratOf(ast.a), b = ratOf(ast.b);
            const sign = ast.t === 'add' ? 1 : -1;
            // a.num/a.den + sign*b.num/b.den = (a.num*b.den ± b.num*a.den) / (a.den*b.den)
            const num = polyAdd(polyMul(a.num, b.den), polyScale(polyMul(b.num, a.den), sign));
            return { num, den: polyMul(a.den, b.den) };
        }
        case 'mul': {
            const a = ratOf(ast.a), b = ratOf(ast.b);
            return { num: polyMul(a.num, b.num), den: polyMul(a.den, b.den) };
        }
        case 'div': {
            const a = ratOf(ast.a), b = ratOf(ast.b);
            if (polyIsZero(b.num)) throw new ParseError('Division by zero in the transfer function');
            return { num: polyMul(a.num, b.den), den: polyMul(a.den, b.num) };
        }
        case 'pow': {
            const base = ratOf(ast.a);
            const eRat = ratOf(ast.b);
            if (polyDegree(eRat.num) !== 0 || polyDegree(eRat.den) !== 0)
                throw new ParseError('Exponent must be a constant');
            const ev = eRat.num[0] / eRat.den[0];
            if (!isFinite(ev) || Math.abs(ev - Math.round(ev)) > 1e-9)
                throw new ParseError('Exponent must be an integer (got ' + ev + ')');
            const n = Math.round(ev);
            if (Math.abs(n) > 16) throw new ParseError('Exponent too large (|n| ≤ 16)');
            if (n >= 0) return { num: polyPow(base.num, n), den: polyPow(base.den, n) };
            return { num: polyPow(base.den, -n), den: polyPow(base.num, -n) };
        }
        default: throw new ParseError('Internal error: unknown AST node');
    }
}

// ===========================================================================
// Factoring
// ===========================================================================

function pushElem(list, elem) {
    for (const ex of list) {
        const sameW = ex.kind === 'real' && elem.kind === 'real' &&
            Math.abs(ex.w - elem.w) <= 1e-5 * Math.max(ex.w, elem.w);
        const sameWn = ex.kind === 'complex' && elem.kind === 'complex' &&
            Math.abs(ex.wn - elem.wn) <= 1e-5 * Math.max(ex.wn, elem.wn);
        const sameZeta = ex.kind !== 'complex' || Math.abs(ex.zeta - elem.zeta) <= 1e-4;
        if (ex.type === elem.type && ex.kind === elem.kind && (sameW || sameWn) && sameZeta &&
            !!ex.rhp === !!elem.rhp) {
            ex.order += elem.order;
            return;
        }
    }
    list.push(elem);
}

function factorPolyParts(poly) {
    const trimmed = polyTrim(poly);
    if (polyIsZero(trimmed)) throw new ParseError('Numerator/denominator is zero');
    const { k, rest } = polyStripOrigin(trimmed);
    const cls = classifyRoots(rootsOf(rest));
    return { origin: k, reals: cls.reals, pairs: cls.pairs, lead: trimmed[trimmed.length - 1] };
}

/** Remove matching entries of a against b (b entries are consumed). */
function cancelLists(a, b, eq) {
    for (let bi = 0; bi < b.length; bi++) {
        for (let ai = 0; ai < a.length; ai++) {
            if (eq(a[ai], b[bi])) { a.splice(ai, 1); b.splice(bi, 1); bi--; break; }
        }
    }
}

function freqOf(e) { return e.kind === 'real' ? e.w : e.wn; }

// ===========================================================================
// Public entry point
// ===========================================================================

function parseTransferFunction(raw) {
    const normalized = A.normalizeInput(raw);
    const ast = A.parseAst(normalized);
    let { num, den } = ratOf(ast);
    num = polyTrim(num); den = polyTrim(den);
    if (polyIsZero(num)) throw new ParseError('Numerator is zero — not a valid transfer function');
    if (polyIsZero(den)) throw new ParseError('Denominator is zero — not a valid transfer function');

    // NOTE: deg(num) may exceed deg(den) — the factored form N(s)/D(s) = lead·Π/Π
    // is still a valid poles-and-zeros representation (e.g. (1+s/10)³/s²).

    const tf = { gain: 1, z0: 0, p0: 0, zeros: [], poles: [], source: String(raw), normalized };
    const numF = factorPolyParts(num);
    const denF = factorPolyParts(den);

    // cancel common factors (including common powers of s)
    const mOrigin = Math.min(numF.origin, denF.origin);
    tf.z0 = numF.origin - mOrigin;
    tf.p0 = denF.origin - mOrigin;

    numF.reals.sort((a, b) => a - b);
    denF.reals.sort((a, b) => a - b);
    cancelLists(numF.reals, denF.reals, (a, b) =>
        Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b)));

    const wnOf = (p) => Math.hypot(p.re, p.im);
    numF.pairs.sort((a, b) => wnOf(a) - wnOf(b));
    denF.pairs.sort((a, b) => wnOf(a) - wnOf(b));
    cancelLists(numF.pairs, denF.pairs, (a, b) =>
        Math.abs(wnOf(a) - wnOf(b)) <= 1e-6 * Math.max(1, wnOf(a), wnOf(b)) &&
        Math.abs(a.re - b.re) <= 1e-5 * Math.max(1, wnOf(a)));

    tf.gain = numF.lead / denF.lead;
    for (const r of numF.reals) {
        tf.gain *= (-r);
        pushElem(tf.zeros, { type: 'zero', kind: 'real', w: Math.abs(r), rhp: r > 0, order: 1 });
    }
    for (const r of denF.reals) {
        tf.gain /= (-r);
        pushElem(tf.poles, { type: 'pole', kind: 'real', w: Math.abs(r), rhp: r > 0, order: 1 });
    }
    for (const p of numF.pairs) {
        const wn = wnOf(p);
        tf.gain *= wn * wn;
        pushElem(tf.zeros, { type: 'zero', kind: 'complex', wn, zeta: -p.re / wn, order: 1 });
    }
    for (const p of denF.pairs) {
        const wn = wnOf(p);
        tf.gain /= wn * wn;
        pushElem(tf.poles, { type: 'pole', kind: 'complex', wn, zeta: -p.re / wn, order: 1 });
    }

    tf.zeros.sort((a, b) => freqOf(a) - freqOf(b));
    tf.poles.sort((a, b) => freqOf(a) - freqOf(b));
    return tf;
}

A.parseTransferFunction = parseTransferFunction;
A.freqOf = freqOf;

})(globalThis.BodeMath = globalThis.BodeMath || {});
