/* asymbode-math — transfer-function parsing, factoring, exact & asymptotic Bode curves.
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
(function (global) {
'use strict';

class ParseError extends Error {
  constructor(msg) { super(msg); this.name = 'ParseError'; }
}

// ===========================================================================
// String normalization
// ===========================================================================

function readBalanced(s, start) {
  // s[start] must be '{'; returns index just past matching '}'
  if (s[start] !== '{') throw new ParseError('Malformed \\frac: expected "{"');
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  throw new ParseError('Malformed \\frac: unbalanced braces');
}

function expandFracs(s) {
  for (let guard = 0; guard < 64; guard++) {
    const idx = s.indexOf('@FRAC@');
    if (idx === -1) return s;
    let i = idx + 6;
    while (i < s.length && /\s/.test(s[i])) i++;
    const aEnd = readBalanced(s, i);
    const a = s.slice(i + 1, aEnd - 1);
    let j = aEnd;
    while (j < s.length && /\s/.test(s[j])) j++;
    const bEnd = readBalanced(s, j);
    const b = s.slice(j + 1, bEnd - 1);
    s = s.slice(0, idx) + '(' + a + ')/(' + b + ')' + s.slice(bEnd);
  }
  throw new ParseError('Too many nested \\frac');
}

function normalizeInput(raw) {
  let s = String(raw == null ? '' : raw);
  s = s.replace(/^﻿/, '');

  // unicode punctuation
  s = s.replace(/[−–—]/g, '-');
  s = s.replace(/[×⋅∙·]/g, '*');
  s = s.replace(/[‘’]/g, "'");

  // unicode superscripts (s², 10⁻⁴) → ^(…) so they parse
  s = s.replace(/([⁻⁺]?)([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g, (m, sign, digits) => {
    let n = '';
    for (const c of digits) n += '0123456789'['⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(c)];
    if (sign === '⁻') n = '-' + n;
    return '^(' + n + ')';
  });

  // strip "G(s) =" / "G_{(s)} =" / "Y(s):=" style left-hand side
  s = s.replace(/^\s*[A-Za-z][A-Za-z0-9]*\s*[_^]?\s*\{\s*\(\s*[A-Za-z]\s*\)\s*\}\s*[:]?=\s*/, '');
  // …or a bare "Y =" / "K =" style assignment
  s = s.replace(/^\s*[A-Za-z][A-Za-z0-9]*\s*[:]?=\s*/, '');

  // LaTeX cleanup
  s = s.replace(/\\left/g, ' ').replace(/\\right/g, ' ');
  s = s.replace(/\\[,;:]/g, ' ');
  s = s.replace(/\\(?:cdot|times)/g, '*');
  s = s.replace(/\\(?:dfrac|tfrac|frac)/g, '@FRAC@');
  s = s.replace(/\\text\s*\{([^{}]*)\}/g, '$1');
  s = expandFracs(s);
  s = s.replace(/\\[a-zA-Z]+/g, (m) => { throw new ParseError('Unsupported LaTeX command "' + m + '"'); });

  // braces → parentheses, ** → power
  s = s.replace(/\{/g, '(').replace(/\}/g, ')');
  s = s.replace(/\*\*/g, '^');
  s = s.replace(/\s+/g, '');
  return s;
}

// ===========================================================================
// Tokenizer (with implicit multiplication)
// ===========================================================================

function tokenize(s) {
  const toks = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if ((c >= '0' && c <= '9') || c === '.') {
      const start = i;
      while (i < s.length && s[i] >= '0' && s[i] <= '9') i++;
      if (i < s.length && s[i] === '.') {
        i++;
        while (i < s.length && s[i] >= '0' && s[i] <= '9') i++;
      }
      if (i < s.length && (s[i] === 'e' || s[i] === 'E')) {
        let k = i + 1;
        if (k < s.length && (s[k] === '+' || s[k] === '-')) k++;
        if (k < s.length && s[k] >= '0' && s[k] <= '9') {
          while (k < s.length && s[k] >= '0' && s[k] <= '9') k++;
          i = k;
        }
      }
      const text = s.slice(start, i);
      const v = parseFloat(text);
      if (!isFinite(v)) throw new ParseError('Invalid number "' + text + '"');
      toks.push({ t: 'num', v });
      continue;
    }
    if (/[A-Za-z]/.test(c)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9]/.test(s[j])) j++;
      toks.push({ t: 'id', v: s.slice(i, j) });
      i = j;
      continue;
    }
    if (c === '*' && s[i + 1] === '*') { toks.push({ t: 'op', v: '^' }); i += 2; continue; }
    if ('+-*/()^'.indexOf(c) !== -1) { toks.push({ t: 'op', v: c }); i++; continue; }
    throw new ParseError('Unexpected character "' + c + '" in the transfer function');
  }

  // implicit multiplication: 2s, 2(…), s(…), (…)(…), (…)s
  // ident ≠ s directly before "(" is a function call (kept intact for a clear error)
  const out = [];
  const leftOk = (t) => t && (t.t === 'num' || t.t === 'id' || (t.t === 'op' && t.v === ')'));
  const rightOk = (t) => t && (t.t === 'num' || t.t === 'id' || (t.t === 'op' && t.v === '('));
  const fnCall = (a, b) => a && b && a.t === 'id' && a.v !== 's' && b.t === 'op' && b.v === '(';
  for (let k = 0; k < toks.length; k++) {
    if (k > 0 && leftOk(toks[k - 1]) && rightOk(toks[k]) && !fnCall(toks[k - 1], toks[k]))
      out.push({ t: 'op', v: '*' });
    out.push(toks[k]);
  }
  return out;
}

// ===========================================================================
// Recursive-descent parser → AST
// ===========================================================================

function parseExpr(toks, pos) {
  // expr := term (('+'|'-') term)*
  let node, p;
  [node, p] = parseTerm(toks, pos);
  while (p < toks.length && toks[p].t === 'op' && (toks[p].v === '+' || toks[p].v === '-')) {
    const op = toks[p].v;
    let rhs, p2;
    [rhs, p2] = parseTerm(toks, p + 1);
    node = { t: op === '+' ? 'add' : 'sub', a: node, b: rhs };
    p = p2;
  }
  return [node, p];
}

function parseTerm(toks, pos) {
  // term := unary (('*'|'/') unary)*
  let node, p;
  [node, p] = parseUnary(toks, pos);
  while (p < toks.length && toks[p].t === 'op' && (toks[p].v === '*' || toks[p].v === '/')) {
    const op = toks[p].v;
    let rhs, p2;
    [rhs, p2] = parseUnary(toks, p + 1);
    node = { t: op === '*' ? 'mul' : 'div', a: node, b: rhs };
    p = p2;
  }
  return [node, p];
}

function parseUnary(toks, pos) {
  if (pos < toks.length && toks[pos].t === 'op' && (toks[pos].v === '+' || toks[pos].v === '-')) {
    let node, p;
    [node, p] = parseUnary(toks, pos + 1);
    return toks[pos].v === '-' ? [{ t: 'neg', a: node }, p] : [node, p];
  }
  return parsePower(toks, pos);
}

function parsePower(toks, pos) {
  // power := atom ('^' unary)?   — right associative, exponent may be signed
  let base, p;
  [base, p] = parseAtom(toks, pos);
  if (p < toks.length && toks[p].t === 'op' && toks[p].v === '^') {
    let exp, p2;
    [exp, p2] = parseUnary(toks, p + 1);
    return [{ t: 'pow', a: base, b: exp }, p2];
  }
  return [base, p];
}

function parseAtom(toks, pos) {
  if (pos >= toks.length) throw new ParseError('Unexpected end of the transfer function');
  const tk = toks[pos];
  if (tk.t === 'num') return [{ t: 'num', v: tk.v }, pos + 1];
  if (tk.t === 'id') {
    if (tk.v === 's') return [{ t: 's' }, pos + 1];
    const looksFn = pos + 1 < toks.length && toks[pos + 1].t === 'op' && toks[pos + 1].v === '(';
    if (looksFn) throw new ParseError('Unsupported function "' + tk.v + '" — time delays (exp) are not allowed; use poles & zeroes');
    throw new ParseError('Unknown symbol "' + tk.v + '" — only "s" may appear; write a numeric gain instead');
  }
  if (tk.t === 'op' && tk.v === '(') {
    let node, p;
    [node, p] = parseExpr(toks, pos + 1);
    if (p >= toks.length || toks[p].v !== ')') throw new ParseError('Missing closing ")"');
    return [node, p + 1];
  }
  throw new ParseError('Unexpected "' + (tk.v != null ? tk.v : '?') + '" in the transfer function');
}

function parseAst(normalized) {
  if (normalized === '') throw new ParseError('Empty transfer function');
  const toks = tokenize(normalized);
  const [node, end] = parseExpr(toks, 0);
  if (end !== toks.length) {
    const tk = toks[end];
    throw new ParseError('Unexpected "' + (tk.v != null ? tk.v : '?') + '" in the transfer function');
  }
  return node;
}

// ===========================================================================
// Polynomial utilities — coeffs[i] is the coefficient of s^i
// ===========================================================================

function polyTrim(p) {
  const a = p.slice();
  while (a.length > 1 && a[a.length - 1] === 0) a.pop();
  if (a.length === 0) return [0];
  return a;
}
function polyIsZero(p) { return p.every(c => c === 0); }
function polyDegree(p) { const t = polyTrim(p); return polyIsZero(t) ? -1 : t.length - 1; }
function polyAdd(a, b) {
  const n = Math.max(a.length, b.length);
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) out[i] = (a[i] || 0) + (b[i] || 0);
  return polyTrim(out);
}
function polySub(a, b) {
  const n = Math.max(a.length, b.length);
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) out[i] = (a[i] || 0) - (b[i] || 0);
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
function polyDivMod(a, b) {
  a = polyTrim(a); b = polyTrim(b);
  if (polyIsZero(b)) throw new ParseError('Division by zero polynomial');
  const degA = polyDegree(a), degB = polyDegree(b);
  if (degA < degB) return { q: [0], r: a };
  const lead = b[b.length - 1];
  let r = a.slice();
  const q = new Array(degA - degB + 1).fill(0);
  for (let i = degA - degB; i >= 0; i--) {
    const coef = r[i + degB] / lead;
    q[i] = coef;
    if (coef !== 0)
      for (let j = 0; j <= degB; j++) r[i + j] -= coef * b[j];
  }
  const rem = polyTrim(r.map(v => (Math.abs(v) < 1e-300 ? 0 : v)));
  return { q: polyTrim(q), r: rem };
}
function polyRemainderSmall(r, ref) {
  if (polyIsZero(r)) return true;
  const scale = Math.max(1e-300, ...ref.map(c => Math.abs(c)));
  return r.every(c => Math.abs(c) <= 1e-9 * scale);
}
// Strip exact factors of s (zero roots at the origin) from a polynomial.
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

// Group roots into reals and conjugate pairs (for real-coefficient polynomials).
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

// ===========================================================================
// AST → rational function → factored transfer function
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

function cancelLists(a, b, eq) {
  // remove matching entries of a against b (b entries are consumed)
  for (let bi = 0; bi < b.length; bi++) {
    for (let ai = 0; ai < a.length; ai++) {
      if (eq(a[ai], b[bi])) { a.splice(ai, 1); b.splice(bi, 1); bi--; break; }
    }
  }
}

function parseTransferFunction(raw) {
  const normalized = normalizeInput(raw);
  const ast = parseAst(normalized);
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

function freqOf(e) { return e.kind === 'real' ? e.w : e.wn; }

// ===========================================================================
// Exact (real) response
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
    // 1 - s/r with r = -w (LHP) or r = +w (RHP): factor = 1 ∓ jw/w… use (1 + jw/w) for LHP,
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
 * Exact magnitude dB and phase (deg, continuous — branch-aligned to `phaseTargetDeg`
 * at the first sample) sampled uniformly in log10(ω) over [xmin, xmax].
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
function magSlopeUnit(e) { // dB/dec contribution per order
  const base = e.kind === 'complex' ? 40 : 20;
  return e.type === 'zero' ? base : -base;
}
function phaseTotal(e) { // degrees per order
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

// ===========================================================================
// Correctness check (user drawing vs. true transfer function)
// ===========================================================================

function stateFromTF(tf) {
  return {
    gainDB: 20 * Math.log10(Math.abs(tf.gain)),
    gainSign: tf.gain < 0 ? -1 : 1,
    z0: tf.z0, p0: tf.p0,
    elems: [...tf.zeros, ...tf.poles].map(e => Object.assign({}, e)),
  };
}

function clusterElems(elems, gapDec) {
  const sorted = elems.slice().sort((a, b) => freqOf(a) - freqOf(b));
  const out = [];
  let cur = null;
  for (const e of sorted) {
    const x = Math.log10(freqOf(e));
    if (cur && Math.abs(x - cur.x) <= gapDec && cur.type === e.type && cur.kind === e.kind && !!cur.rhp === !!e.rhp) {
      cur.order += e.order;
      cur.x = x;
      cur.n++;
    } else {
      cur = { type: e.type, kind: e.kind, rhp: !!e.rhp, w: freqOf(e), x, order: e.order, n: 1 };
      out.push(cur);
    }
  }
  return out;
}

/**
 * Graphs an element is drawn on. Missing `plots` (pre-sync drawings and the
 * true solution) means "both graphs"; an explicit empty list means "neither".
 */
function elemPlots(e) {
  return Array.isArray(e.plots) ? e.plots : ['mag', 'ph'];
}

/** True when some element lives on exactly one graph — i.e. the two graphs
 *  hold different drawings (mirroring off), so each must be checked alone. */
function splitAcrossPlots(elems) {
  return elems.some(e => elemPlots(e).length === 1);
}

/**
 * With graph mirroring off, the same intended element may be drawn separately
 * on the magnitude and phase graphs (two entries with disjoint `plots`).
 * Fold those into one before clustering so the checker doesn't see a phantom
 * order increase or an extra element. Entries that share a graph are left
 * untouched (near-duplicate orders there are summed by clusterElems as before).
 */
function coalesceMirrored(elems) {
  const out = [];
  for (const e of elems) {
    const pa = elemPlots(e);
    if (pa.length === 0) continue;
    let m = null;
    for (const o of out) {
      if (o.type !== e.type || o.kind !== e.kind || !!o.rhp !== !!e.rhp) continue;
      const wo = freqOf(o), we = freqOf(e);
      if (Math.abs(wo - we) > 1e-9 * Math.max(wo, we)) continue;
      const pb = elemPlots(o);
      if (pa.some(p => pb.indexOf(p) !== -1)) continue;
      m = o;
      break;
    }
    if (m) {
      m.order = Math.max(m.order, e.order);
      m.plots = elemPlots(m).concat(pa.filter(p => elemPlots(m).indexOf(p) === -1));
    } else {
      const copy = Object.assign({}, e);
      copy.plots = pa.slice();
      out.push(copy);
    }
  }
  return out;
}

const PLOT_TITLE = { mag: 'magnitude graph', ph: 'phase graph' };

function clusterLabel(c) {
  const name = c.type === 'zero' ? 'Zero' : 'Pole';
  const kind = c.kind === 'complex' ? ' complex pair' : (c.rhp ? ' (RHP)' : '');
  const ord = c.order > 1 ? ' ×' + c.order : '';
  return name + kind + ' at ω = ' + fmtW(c.w) + ord;
}

/**
 * Match true clusters against drawn clusters (nearest pairs first, so one
 * drawing can't steal a neighbour's match) and turn the outcome into
 * checklist items. `plot` tags every item with the graph it came from —
 * `null` checks the drawing as a whole.
 */
function matchElems(tCl, uCl, tolDec, plot) {
  const where = plot ? ' on the ' + PLOT_TITLE[plot] : '';
  const items = [];

  const pairs = [];
  for (let ti = 0; ti < tCl.length; ti++) {
    for (let ui = 0; ui < uCl.length; ui++) {
      const t = tCl[ti], u = uCl[ui];
      if (u.type !== t.type || u.kind !== t.kind || !!u.rhp !== !!t.rhp) continue;
      const d = Math.abs(Math.log10(u.w / t.w));
      if (d <= tolDec) pairs.push({ ti, ui, d });
    }
  }
  pairs.sort((a, b) => a.d - b.d);

  const mT = new Array(tCl.length).fill(-1);
  const mU = new Array(uCl.length).fill(false);
  for (const p of pairs) {
    if (mT[p.ti] < 0 && !mU[p.ui]) { mT[p.ti] = p.ui; mU[p.ui] = true; }
  }

  for (let ti = 0; ti < tCl.length; ti++) {
    const t = tCl[ti];
    const ui = mT[ti];
    if (ui >= 0) {
      const u = uCl[ui];
      const okOrd = u.order === t.order;
      items.push({
        ok: okOrd, kind: 'elem', plot,
        text: clusterLabel(t) + where +
          (okOrd ? ': ok' : ': expected order ×' + t.order + ', you drew ×' + u.order),
      });
      continue;
    }
    // diagnostics: complex vs. double-real confusion
    let hint = '';
    if (t.kind === 'complex') {
      const dbl = uCl.some((u, i) => !mU[i] && u.type === t.type && u.kind === 'real' &&
        Math.abs(Math.log10(u.w / t.w)) <= tolDec && u.order >= 2 * t.order);
      if (dbl) hint = ' — you drew real poles/zeroes (same magnitude slope, but phase differs)';
    } else if (t.kind === 'real' && t.order >= 2) {
      const cx = uCl.some((u, i) => !mU[i] && u.type === t.type && u.kind === 'complex' &&
        Math.abs(Math.log10(u.w / t.w)) <= tolDec);
      if (cx) hint = ' — you drew a complex pair (phase differs from a double real corner)';
    }
    items.push({ ok: false, kind: 'elem', plot, text: 'Missing' + where + ': ' + clusterLabel(t) + hint });
  }
  for (let ui = 0; ui < uCl.length; ui++) {
    if (!mU[ui]) items.push({
      ok: false, kind: 'extra', plot,
      text: 'Extra' + where + ': ' + clusterLabel(uCl[ui]) + ' (not in G(s))',
    });
  }
  return items;
}

/**
 * Compare a user drawing against the true TF.
 *
 * Gain, K's sign and the origin orders are shared by both graphs, so they are
 * checked once. Finite poles/zeroes are per graph: when the drawing differs
 * between the magnitude and phase graphs (mirroring off) each graph is
 * compared on its own, so a mistake on either one is reported for that graph.
 *
 * Returns { items: [{ok, kind, text, plot}], score: {ok, total} }.
 */
function checkSolution(tf, user, opts) {
  opts = opts || {};
  const tolDec = opts.tolDec != null ? opts.tolDec : 0.1;
  const gainTol = opts.gainTol != null ? opts.gainTol : 1.0;
  const items = [];
  const trueState = stateFromTF(tf);

  // --- gain (magnitude in dB) ---
  const tDB = trueState.gainDB, uDB = user.gainDB;
  const gainOk = Math.abs(tDB - uDB) <= gainTol;
  items.push({
    ok: gainOk, kind: 'gain', plot: null,
    text: 'Gain 20 lg|K|: ' + (gainOk ? 'ok' : 'expected ≈') + ' ' + fmtDb(tDB) + ' dB — you have ' + fmtDb(uDB) + ' dB',
  });

  // --- sign of K (only required when K < 0) ---
  if (tf.gain < 0) {
    const signOk = (user.gainSign == null ? 1 : user.gainSign) < 0;
    items.push({
      ok: signOk, kind: 'sign', plot: null,
      text: signOk ? 'Sign of K: ok (K < 0, phase shifted 180°)' : 'K is negative — set K sign to “−” in the Gain panel',
    });
  }

  // --- origin orders ---
  items.push({
    ok: tf.z0 === user.z0, kind: 'origin', plot: null,
    text: 'Zeroes at origin s' + sup(tf.z0) + ': expected ' + tf.z0 + ', you drew ' + user.z0,
  });
  items.push({
    ok: tf.p0 === user.p0, kind: 'origin', plot: null,
    text: 'Poles at origin 1/s' + sup(tf.p0) + ': expected ' + tf.p0 + ', you drew ' + user.p0,
  });

  // --- finite elements, clustered so split double-poles still match ---
  const tCl = clusterElems(trueState.elems, 0.026);
  const drawn = (user.elems || []).filter(e => elemPlots(e).length > 0);
  if (splitAcrossPlots(drawn)) {
    // mirroring off: the graphs are independent drawings — check each one
    for (const plot of ['mag', 'ph']) {
      const onPlot = drawn.filter(e => elemPlots(e).indexOf(plot) !== -1);
      items.push.apply(items, matchElems(tCl, clusterElems(onPlot, 0.026), tolDec, plot));
    }
  } else {
    // same elements everywhere: one pass over the whole drawing
    const uCl = clusterElems(coalesceMirrored(drawn), 0.026);
    items.push.apply(items, matchElems(tCl, uCl, tolDec, null));
  }

  const total = items.filter(it => it.kind !== 'info').length;
  const ok = items.filter(it => it.ok).length;
  return { items, score: { ok, total } };
}

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
    const ms = Math.abs(m - 1) < 1e-9 ? '10' : (Math.abs(m - Math.round(m)) < 1e-9 ? String(Math.round(m)) : Number(m.toPrecision(3))) + '·10';
    return ms + sup(e);
  }
  return String(Number(w.toPrecision(4)));
}
const SUPMAP = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
function sup(n) { return String(n).split('').map(c => SUPMAP[c] || c).join(''); }

// ===========================================================================
// TeX-style HTML rendering of a transfer function (for the G(s) preview)
// ===========================================================================

function texEscapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function texSupHtml(e) {
  if (Number.isInteger(e)) return sup(e);
  return '<sup>' + (e < 0 ? '−' + Math.abs(e) : String(e)) + '</sup>';
}

/** Numeric pow exponent as an integer value, else null (e.g. s^s, 10^0.5). */
function powExpInt(n) {
  if (n.t === 'num' && Number.isInteger(n.v)) return n.v;
  if (n.t === 'neg' && n.a.t === 'num' && Number.isInteger(n.a.v)) return -n.a.v;
  return null;
}

function texNumHtml(v) {
  if (!isFinite(v)) return texEscapeHtml(String(v));
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (Number.isInteger(v) && a < 1e15) return String(v);
  const e = Math.floor(Math.log10(a));
  const isPow10 = Math.abs(a - Math.pow(10, e)) <= 1e-9 * a &&
    Math.abs(Math.log10(a) - e) < 1e-9;
  if (isPow10 && Math.abs(e) >= 3) return '10' + texSupHtml(e);
  if (a >= 1e15 || a < 1e-4) {
    const m = Number((v / Math.pow(10, e)).toPrecision(6));
    return String(m) + '·10' + texSupHtml(e);
  }
  return String(Number(v.toPrecision(10)));
}

function texPrec(n) {
  switch (n.t) {
    case 'add': case 'sub': return 1;
    case 'neg': return 1.5;
    case 'mul': case 'div': return 2;
    case 'pow': return 4;
    default: return 5; // num, s
  }
}

function texHasAddSub(n) {
  if (!n) return false;
  if (n.t === 'add' || n.t === 'sub') return true;
  if (n.t === 'neg') return texHasAddSub(n.a);
  return false;
}

function texStripTags(html) { return html.replace(/<[^>]*>/g, ''); }

/** Render mul factors: flatten, numeric factors first, · only where needed. */
function texMulHtml(node) {
  const factors = [];
  (function flatten(n) {
    if (n.t === 'mul') { flatten(n.a); flatten(n.b); }
    else factors.push(n);
  })(node);

  const rendered = factors.map((n, i) => texHtml(n, i === 0 ? 1.5 : 3));
  const nums = [], others = [];
  for (const r of rendered) ((r.html.indexOf('<i>') === -1) ? nums : others).push(r);
  const parts = nums.concat(others);

  let out = '';
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) {
      const L = texStripTags(parts[i - 1].html), R = texStripTags(parts[i].html);
      const bothNum = parts[i - 1].numeric && parts[i].numeric;
      const letterRun = /[A-Za-z]$/.test(L) && /^[A-Za-z0-9]/.test(R);
      out += (bothNum || letterRun) ? '·' : '';
    }
    out += parts[i].html;
  }
  return { html: out, numeric: others.length === 0 };
}

/**
 * Render AST node as TeX-document-style HTML.
 * minPrec: parenthesise when the node binds looser than this precedence.
 * opts.root: top level of G(s) → a division becomes a stacked fraction.
 */
function texHtml(node, minPrec, opts) {
  opts = opts || {};
  const wrap = (html, prec) => (prec < minPrec ? '(' + html + ')' : html);
  switch (node.t) {
    case 'num':
      return { html: wrap(texNumHtml(node.v), 5), numeric: true };
    case 's':
      return { html: wrap('<i>s</i>', 5), numeric: false };
    case 'neg': {
      const inner = texHtml(node.a, 1.5);
      return { html: wrap('−' + inner.html, 1.5), numeric: inner.numeric };
    }
    case 'add': case 'sub': {
      const a = texHtml(node.a, 1);
      const b = texHtml(node.b, node.t === 'sub' ? 2 : 1);
      return { html: wrap(a.html + (node.t === 'add' ? ' + ' : ' − ') + b.html, 1), numeric: false };
    }
    case 'mul': {
      const m = texMulHtml(node);
      return { html: wrap(m.html, 2), numeric: m.numeric };
    }
    case 'div': {
      const stack = !!opts.root || texHasAddSub(node.a) || texHasAddSub(node.b);
      if (stack) {
        const a = texHtml(node.a, 1), b = texHtml(node.b, 1);
        return {
          html: '<span class="frac"><span class="fn">' + a.html +
            '</span><span class="fd">' + b.html + '</span></span>',
          numeric: false,
        };
      }
      const a = texHtml(node.a, 2), b = texHtml(node.b, 3);
      return { html: wrap(a.html + '/' + b.html, 2), numeric: false };
    }
    case 'pow': {
      const base = texHtml(node.a, 5);
      const exp = texHtml(node.b, 1.5);
      const ei = powExpInt(node.b);
      const expHtml = ei !== null ? sup(ei) : '<sup>' + exp.html + '</sup>';
      return {
        html: wrap(base.html + expHtml, 4),
        numeric: base.numeric && exp.numeric,
      };
    }
    default:
      return { html: texEscapeHtml('?'), numeric: false };
  }
}

/**
 * Build the live G(s) preview HTML from K / numerator / denominator field
 * text. Never throws: unparseable input falls back to the raw text.
 *
 * Only the K field renders as a prefix; numeric factors inside N/D stay
 * in the fraction:  G(s) = K · N(s)/D(s).
 */
function evalConst(n) {
  switch (n && n.t) {
    case 'num': return n.v;
    case 's': return null;
    case 'neg': { const a = evalConst(n.a); return a == null ? null : -a; }
    case 'add': { const a = evalConst(n.a), b = evalConst(n.b); return (a == null || b == null) ? null : a + b; }
    case 'sub': { const a = evalConst(n.a), b = evalConst(n.b); return (a == null || b == null) ? null : a - b; }
    case 'mul': { const a = evalConst(n.a), b = evalConst(n.b); return (a == null || b == null) ? null : a * b; }
    case 'div': { const a = evalConst(n.a), b = evalConst(n.b); return (a == null || b == null || b === 0) ? null : a / b; }
    case 'pow': { const a = evalConst(n.a), b = evalConst(n.b); return (a == null || b == null) ? null : Math.pow(a, b); }
    default: return null;
  }
}

function mulOf(nodes) {
  let n = nodes[0];
  for (let i = 1; i < nodes.length; i++) n = { t: 'mul', a: n, b: nodes[i] };
  return n;
}

/** Raw expression from K / num / den fields (K folded in only when ≠ 1). */
function tfExpr(kRaw, numRaw, denRaw) {
  const k = String(kRaw == null ? '' : kRaw).trim() || '1';
  const num = String(numRaw == null ? '' : numRaw).trim();
  const den = String(denRaw == null ? '' : denRaw).trim();
  if (!num && !den && k === '1') return '';
  const kPart = k === '1' ? '' : '(' + k + ')*';
  if (!den) {
    if (!num) return k === '1' ? '' : k;
    return k === '1' ? num : kPart + '(' + num + ')';
  }
  return kPart + '(' + (num || '1') + ')/(' + den + ')';
}

/** Pretty prefix for a standalone K-field value: "10 · ", "2·10⁴ · ", … */
function kPrefixHtml(k) {
  try {
    const kAst = parseAst(normalizeInput(k));
    const kv = evalConst(kAst);
    if (kv != null) {
      const sign = kv < 0 ? '−' : '';
      const nodes = [];
      (function flat(n) {
        if (n.t === 'mul') { flat(n.a); flat(n.b); }
        else if (n.t === 'neg') { const a = n.a; if (a && a.t === 'num') return; flat(a); }
        else nodes.push(n);
      })(kAst);
      const abs = nodes.map((n) => {
        if (n.t === 'num') return { t: 'num', v: Math.abs(n.v) };
        return n;
      });
      const body = abs.length
        ? texHtml(abs.length === 1 ? abs[0] : mulOf(abs), 1.5, { root: true }).html
        : texNumHtml(Math.abs(kv));
      return sign + body + '&nbsp;·&nbsp;';
    }
    return texHtml(kAst, 1.5, { root: true }).html + '&nbsp;·&nbsp;';
  } catch (e) {
    return texEscapeHtml(k) + '&nbsp;·&nbsp;';
  }
}

function texPreview(kRaw, numRaw, denRaw) {
  const k = String(kRaw == null ? '' : kRaw).trim() || '1';
  const num = String(numRaw == null ? '' : numRaw).trim();
  const den = String(denRaw == null ? '' : denRaw).trim();
  const head = '<i>G</i>(<i>s</i>)&nbsp;=&nbsp;';
  if (!num && !den && k === '1') return head + '<span class="tex-ph">?</span>';
  const kHtml = (k === '1') ? '' : kPrefixHtml(k);
  const body = num || den ? (den ? '(' + (num || '1') + ')/(' + den + ')' : num) : '1';
  try {
    const ast = parseAst(normalizeInput(body));
    // K multiplies a top-level sum: parenthesize so 5·(1+s) ≠ 5·1+s
    let rhs = texHtml(ast, 1, { root: true }).html;
    if (kHtml && (ast.t === 'add' || ast.t === 'sub')) {
      rhs = '(' + rhs + ')';
    }
    return head + kHtml + rhs;
  } catch (err) {
    return head + kHtml + '<span class="tex-raw">' +
      texEscapeHtml(num || '1') +
      (den ? ' / ' + texEscapeHtml(den) : '') + '</span>';
  }
}

// ===========================================================================
// Self-tests
// ===========================================================================

function selfTest() {
  const failures = [];
  let passed = 0;
  function ok(cond, name, detail) {
    if (cond) { passed++; }
    else failures.push(name + (detail ? ' — ' + detail : ''));
  }
  function near(a, b, tol, name) {
    const d = Math.abs(a - b);
    ok(d <= tol, name, 'got ' + a + ', expected ' + b + ' (Δ=' + d + ')');
  }
  function approx(a, b, tol) { return Math.abs(a - b) <= tol; }

  function find(list, w) {
    return list.find(e => Math.abs(Math.log10(freqOf(e) / w)) < 0.05);
  }

  // ---- parser: the headline example ----
  let tf = parseTransferFunction('1/(1+10^{-4}*s)');
  near(tf.gain, 1, 1e-9, 'ex1 gain');
  ok(tf.poles.length === 1 && tf.poles[0].kind === 'real', 'ex1 one real pole');
  near(tf.poles[0].w, 1e4, 1e-3, 'ex1 pole corner');
  ok(tf.zeros.length === 0 && tf.z0 === 0 && tf.p0 === 0, 'ex1 no other elements');

  // G(s) = \frac {1} {1 + 10^-4 s}  (with unicode minus and spaces)
  tf = parseTransferFunction('G_{(s)} = \\frac {1} {1 + 10^{−4}s}');
  near(tf.gain, 1, 1e-9, 'latex gain');
  near(tf.poles[0].w, 1e4, 1, 'latex pole corner');

  tf = parseTransferFunction('\\dfrac{1}{1+10^{-4}s}');
  near(tf.poles[0].w, 1e4, 1, 'dfrac pole corner');

  // gain + integrator + corner
  tf = parseTransferFunction('10*(1+s/10)/(s*(1+s/1000))');
  near(tf.gain, 10, 1e-9, 'int gain');
  ok(tf.p0 === 1, 'int p0=1');
  near(find(tf.zeros, 10).w, 10, 1e-9, 'int zero@10');
  near(find(tf.poles, 1000).w, 1000, 1e-9, 'int pole@1000');

  tf = parseTransferFunction('\\frac{100 s}{(1+0.1 s)(1+0.01 s)}');
  near(tf.gain, 100, 1e-9, 'frac100 gain');
  ok(tf.z0 === 1, 'frac100 z0=1');
  near(find(tf.poles, 10).w, 10, 1e-6, 'frac100 pole@10');
  near(find(tf.poles, 100).w, 100, 1e-6, 'frac100 pole@100');

  // expanded products & squares
  tf = parseTransferFunction('(s+1)*(s+100)/((s+10)^2)');
  near(tf.gain, 1, 1e-6, 'prod gain (DC=1)');
  near(find(tf.zeros, 1).w, 1, 1e-6, 'prod zero@1');
  near(find(tf.zeros, 100).w, 100, 1e-6, 'prod zero@100');
  const d2 = find(tf.poles, 10);
  ok(d2 && d2.order === 2, 'prod double pole@10', d2 && ('order=' + d2.order));

  tf = parseTransferFunction('(1+s/10)^3/s^2');
  near(tf.gain, 1, 1e-6, 'pow gain');
  const z3 = find(tf.zeros, 10);
  ok(z3 && z3.order === 3, 'pow zero order 3 (numerator power)', z3 ? 'order=' + z3.order : 'missing');
  ok(tf.p0 === 2, 'pow p0=2');

  // quadratics / complex pairs
  tf = parseTransferFunction('2*10^4/(s^2 + 1.4 s + 100)');
  near(tf.gain, 200, 1e-6, 'cplx gain');
  ok(tf.poles.length === 1 && tf.poles[0].kind === 'complex', 'cplx pole pair');
  near(tf.poles[0].wn, 10, 1e-6, 'cplx wn');
  near(tf.poles[0].zeta, 0.07, 1e-6, 'cplx zeta');

  tf = parseTransferFunction('(s^2+4)/(s^2+1)');
  near(find(tf.zeros, 2).wn, 2, 1e-6, 'pair zero wn=2');
  ok(find(tf.zeros, 2).kind === 'complex', 'pair zero complex');
  near(find(tf.poles, 1).wn, 1, 1e-6, 'pair pole wn=1');

  // origin-only
  tf = parseTransferFunction('1/s^2');
  near(tf.gain, 1, 1e-12, '1/s^2 gain');
  ok(tf.p0 === 2 && tf.poles.length === 0, '1/s^2 p0');

  tf = parseTransferFunction('s');
  ok(tf.z0 === 1 && Math.abs(tf.gain - 1) < 1e-12, 's → z0=1 K=1');

  // constants & scientific notation
  tf = parseTransferFunction('5');
  near(tf.gain, 5, 1e-12, 'constant 5');

  tf = parseTransferFunction('1e3*(1+2e-3*s)');
  near(tf.gain, 1000, 1e-9, 'sci gain');
  near(find(tf.zeros, 500).w, 500, 1e-6, 'sci zero@500');

  // RHP
  tf = parseTransferFunction('s-1');
  ok(tf.zeros.length === 1 && tf.zeros[0].rhp, 'RHP zero flagged');
  near(tf.zeros[0].w, 1, 1e-9, 'RHP zero w=1');
  near(tf.gain, -1, 1e-9, 'RHP zero K=-1');

  tf = parseTransferFunction('1/(s-1)');
  ok(tf.poles[0].rhp, 'RHP pole flagged');
  near(tf.gain, -1, 1e-9, 'RHP pole K=-1');

  // negative gain
  tf = parseTransferFunction('-10*(1+s/10)');
  near(tf.gain, -10, 1e-9, 'neg gain');
  near(find(tf.zeros, 10).w, 10, 1e-9, 'neg gain zero');

  // double zero via square
  tf = parseTransferFunction('((1+s)^2)/s^2');
  ok(find(tf.zeros, 1).order === 2, 'double zero order');
  ok(tf.p0 === 2, 'double integrator');

  // implicit multiplication & spaces
  tf = parseTransferFunction('2.5 / ( s * (1 + s/20)^2 )');
  near(tf.gain, 2.5, 1e-9, 'spaces gain');
  ok(find(tf.poles, 20).order === 2, 'spaces double pole');

  // 1/(s+1)(s+2)(s+3): DC = 1/6 → K = 1/6, poles at 1,2,3
  tf = parseTransferFunction('1/(s^3 + 6 s^2 + 11 s + 6)');
  near(find(tf.poles, 1).w, 1, 1e-6, 'cubic pole@1');
  near(find(tf.poles, 2).w, 2, 1e-6, 'cubic pole@2');
  near(find(tf.poles, 3).w, 3, 1e-6, 'cubic pole@3');
  near(tf.gain, 1 / 6, 1e-6, 'cubic gain = 1/6 (DC)');

  // equal-degree ratio → K = lead ratio × Π(−r)/Π(−p) = 1·(1)/(2) = 0.5
  tf = parseTransferFunction('(s+1)/(s+2)');
  near(tf.gain, 0.5, 1e-9, 'ratio K=0.5 (DC 1/2)');
  near(find(tf.zeros, 1).w, 1, 1e-9, 'ratio zero');
  near(find(tf.poles, 2).w, 2, 1e-9, 'ratio pole');

  // (s^2+2s+1)/(s+1) = s+1 → one zero at 1, no poles, K=1
  tf = parseTransferFunction('(s^2+2*s+1)/(s+1)');
  ok(tf.z0 === 0 && tf.p0 === 0, 'cancel origin clean');
  near(tf.gain, 1, 1e-6, 'cancel gain=1');
  ok(tf.zeros.length === 1 && tf.poles.length === 1 - 1, 'cancel leaves s+1 only',
    'zeros=' + tf.zeros.length + ' poles=' + tf.poles.length);
  near(find(tf.zeros, 1).w, 1, 1e-6, 'cancel remaining zero@1');

  // partial cancellation: (s^2+3s+2)/(s+1) = s+2
  tf = parseTransferFunction('(s^2+3*s+2)/(s+1)');
  near(tf.gain, 2, 1e-6, 'partial cancel gain=2');
  near(find(tf.zeros, 2).w, 2, 1e-6, 'partial cancel zero@2');
  ok(tf.poles.length === 0, 'partial cancel pole gone');

  // errors
  let threw = null;
  try { parseTransferFunction('exp(-s)'); } catch (e) { threw = e; }
  ok(threw && /delay/.test(threw.message), 'error: exp delay', threw && threw.message);
  threw = null;
  try { parseTransferFunction(''); } catch (e) { threw = e; }
  ok(threw, 'error: empty');
  threw = null;
  try { parseTransferFunction('(s^2+1)/(s+1)'); } catch (e) { threw = e; }
  ok(!threw, 'improper-in-expanded-form still factors', threw && threw.message);
  threw = null;
  try { parseTransferFunction('1+'); } catch (e) { threw = e; }
  ok(threw, 'error: trailing op');
  threw = null;
  try { parseTransferFunction('K*(1+s/10)'); } catch (e) { threw = e; }
  ok(threw && /Unknown symbol/.test(threw.message), 'error: unknown K', threw && threw.message);
  threw = null;
  try { parseTransferFunction('1/(1+s/10)^0.5'); } catch (e) { threw = e; }
  ok(threw && /integer/.test(threw.message), 'error: fractional exponent', threw && threw.message);
  threw = null;
  try { parseTransferFunction('\\frac{1}{1+s}'); } catch (e) { threw = e; }
  ok(!threw, 'latex frac accepted', threw && threw.message);

  // ---- exact values ----
  tf = parseTransferFunction('1/(1+10^{-4}*s)');
  let p = exactPoint(tf, 1e4);
  near(p.db, -20 * Math.log10(Math.SQRT2), 1e-6, 'exact −3.01 dB at corner');
  near(p.phase, -45, 1e-6, 'exact −45° at corner');
  p = exactPoint(tf, 1e3);
  near(p.db, -10 * Math.log10(1 + 0.01), 1e-6, 'exact ≈0 dB a decade below');
  near(p.phase, -Math.atan(0.1) * 180 / Math.PI, 1e-6, 'exact phase below corner');
  p = exactPoint(tf, 1e7);
  near(p.db, -60.000000434, 1e-4, 'exact −60 dB far above');

  tf = parseTransferFunction('10/(s*(1+s/10))');
  p = exactPoint(tf, 10);
  near(p.db, 0 - 10 * Math.log10(2), 1e-6, '10/(s(1+s/10)) @10 dB');
  near(p.phase, -90 - 45, 1e-6, 'phase @10 = −135°');
  p = exactPoint(tf, 1);
  near(p.db, 20 - 10 * Math.log10(1.01), 1e-6, '@1 dB');
  near(p.phase, -90 - Math.atan(0.1) * 180 / Math.PI, 1e-6, '@1 phase');

  tf = parseTransferFunction('1/(s^2+0.14*s+1)');
  p = exactPoint(tf, 1);
  near(p.db, 20 * Math.log10(1 / 0.14), 1e-6, 'resonant peak @wn');
  // at wn: G = 1/(0 + j0.14) → phase = −atan2(0.14, 0) = −90
  near(p.phase, -90, 1e-6, 'complex pole phase @wn = −90');

  tf = parseTransferFunction('-1');
  p = exactPoint(tf, 1000);
  near(Math.abs(p.phase), 180, 1e-9, 'K=−1 phase ±180');

  // exact curve continuity/unwrap
  tf = parseTransferFunction('1/(s*(1+s/10)*(1+s/100))');
  const curve = exactCurve(tf, -1, 4, 50, null);
  let maxJump = 0;
  for (let i = 1; i < curve.length; i++) maxJump = Math.max(maxJump, Math.abs(curve[i].ph - curve[i - 1].ph));
  ok(maxJump < 30, 'phase unwrap continuity', 'max jump ' + maxJump);
  near(curve[0].ph,
    -90 - Math.atan(0.01) * 180 / Math.PI - Math.atan(0.001) * 180 / Math.PI,
    1e-6, 'unwrap start (−90° − small contributions)');
  ok(curve[curve.length - 1].ph < -250, 'unwrap ends near −270', String(curve[curve.length - 1].ph));

  // ---- asymptotic curves ----
  const mk = (src) => { const t = parseTransferFunction(src); return { tf: t, st: stateFromTF(t) }; };

  let ex = mk('1/(1+10^{-4}*s)');
  near(asymMag(ex.st, 0), 0, 1e-9, 'asym flat 0 dB low freq');
  near(asymMag(ex.st, 4), 0, 1e-9, 'asym 0 dB at corner');
  near(asymMag(ex.st, 5), -20, 1e-9, 'asym −20 one dec after');
  near(asymMag(ex.st, 6), -40, 1e-9, 'asym −40 two dec after');
  // slope check
  const sl = (asymMag(ex.st, 7) - asymMag(ex.st, 5)) / 2;
  near(sl, -20, 1e-9, 'asym slope −20 dB/dec');
  near(asymPhase(ex.st, 2), 0, 1e-9, 'asym phase 0 before');
  near(asymPhase(ex.st, 3), 0, 1e-9, 'asym phase 0 at ωc/10');
  near(asymPhase(ex.st, 4), -45, 1e-9, 'asym phase −45 at ωc');
  near(asymPhase(ex.st, 5), -90, 1e-9, 'asym phase −90 at 10ωc');
  near(asymPhase(ex.st, 6), -90, 1e-9, 'asym phase −90 after');

  ex = mk('10/s');
  near(asymMag(ex.st, 0), 20, 1e-9, '10/s @1 = 20 dB');
  near(asymMag(ex.st, 1), 0, 1e-9, '10/s @10 = 0 dB');
  near(asymPhase(ex.st, 2), -90, 1e-9, '10/s phase −90');

  ex = mk('100*s');
  near(asymMag(ex.st, 0), 40, 1e-9, '100s @1 = 40 dB');
  near(asymMag(ex.st, 2), 80, 1e-9, '100s @100 = 80 dB');
  near(asymPhase(ex.st, 0), 90, 1e-9, '100s phase +90');

  ex = mk('-5*(1+s/20)');
  near(asymPhase(ex.st, 0), 180, 1e-9, 'K<0 phase offset +180');
  near(asymPhase(ex.st, 3), 270, 1e-9, 'K<0 zero → +270');

  ex = mk('1/(s^2+0.14*s+1)');
  near(asymMag(ex.st, -1), 0, 1e-9, 'complex asym before wn = 0 dB');
  near(asymMag(ex.st, 1), -40, 1e-9, 'complex asym −40 after wn');
  const slc = (asymMag(ex.st, 2) - asymMag(ex.st, 0)) / 2;
  near(slc, -40, 1e-9, 'complex slope −40 dB/dec');
  near(asymPhase(ex.st, -1), 0, 1e-9, 'complex phase before');
  near(asymPhase(ex.st, 0), -90, 1e-9, 'complex phase at wn');
  near(asymPhase(ex.st, 1), -180, 1e-9, 'complex phase after');

  // double pole → −40 slope change
  ex = mk('1/(1+s/10)^2');
  near(asymMag(ex.st, 0), 0, 1e-9, 'double pole low');
  const sld = (asymMag(ex.st, 4) - asymMag(ex.st, 2)) / 2;
  near(sld, -40, 1e-9, 'double pole −40 dB/dec');
  near(asymPhase(ex.st, 1), -90, 1e-9, 'double pole phase at corner −90');
  near(asymPhase(ex.st, 2), -180, 1e-9, 'double pole phase after −180');

  // RHP zero: +20 mag slope; K=−1 adds +180°, the corner ramps phase down to −90°
  ex = mk('s-1');
  const slr = (asymMag(ex.st, 2) - asymMag(ex.st, 0)) / 2;
  near(slr, 20, 1e-9, 'RHP zero mag +20');
  near(asymPhase(ex.st, -1), 180, 1e-9, 'RHP zero phase before corner (+180 from K)');
  near(asymPhase(ex.st, 0), 135, 1e-9, 'RHP zero phase at corner (+135)');
  near(asymPhase(ex.st, 3), 90, 1e-9, 'RHP zero after: +180−90=+90');

  // polyline builders
  ex = mk('10*(1+s/10)/(s*(1+s/1000))');
  const mp = asymMagPoints(ex.st, -2, 6);
  ok(mp.length >= 3, 'mag polyline has corners', 'len=' + mp.length);
  ok(mp[0].x === -2 && mp[mp.length - 1].x === 6, 'mag polyline spans view');
  const xs = mp.map(p2 => p2.x);
  ok(xs.some(x => Math.abs(x - 1) < 1e-9) && xs.some(x => Math.abs(x - 3) < 1e-9), 'mag polyline has both corners');
  // phase polyline: kinks at corner∓1 decade
  const pp = asymPhasePoints(ex.st, -2, 6);
  ok(pp[0].x === -2 && pp[pp.length - 1].x === 6, 'phase polyline spans view');
  ok(pp.some(p2 => Math.abs(p2.x - 0) < 1e-9) && pp.some(p2 => Math.abs(p2.x - 4) < 1e-9), 'phase polyline kinks at w/10 & 10w');

  // ---- check algorithm ----
  tf = parseTransferFunction('10*(1+s/10)/(s*(1+s/1000))');
  const truth = stateFromTF(tf);

  // perfect user
  let r = checkSolution(tf, JSON.parse(JSON.stringify(truth)));
  ok(r.items.every(it => it.ok) && r.score.ok === r.score.total,
     'check: perfect score', JSON.stringify(r.items.filter(i => !i.ok)));

  // wrong gain
  let bad = JSON.parse(JSON.stringify(truth));
  bad.gainDB = truth.gainDB + 6;
  r = checkSolution(tf, bad);
  ok(r.items.some(it => it.kind === 'gain' && !it.ok), 'check: flags wrong gain');

  // moved pole (0.5 decade away)
  bad = JSON.parse(JSON.stringify(truth));
  bad.elems.find(e => e.type === 'pole' && Math.abs(Math.log10(e.w / 1000)) < 0.2).w = 3162;
  r = checkSolution(tf, bad);
  ok(r.items.some(it => !it.ok && /Missing/.test(it.text)), 'check: flags moved pole');
  ok(r.items.some(it => !it.ok && /Extra/.test(it.text)), 'check: flags extra pole');

  // order mismatch
  bad = JSON.parse(JSON.stringify(truth));
  bad.elems.find(e => e.type === 'zero').order = 2;
  r = checkSolution(tf, bad);
  ok(r.items.some(it => !it.ok && /order/.test(it.text)), 'check: flags order mismatch');

  // split double pole (two elems) still matches a single ×2 true pole
  tf = parseTransferFunction('1/(1+s/10)^2');
  const truth2 = stateFromTF(tf);
  const split = JSON.parse(JSON.stringify(truth2));
  const dp = split.elems.pop();
  split.elems.push({ type: 'pole', kind: 'real', w: dp.w * 1.02, rhp: false, order: 1 });
  split.elems.push({ type: 'pole', kind: 'real', w: dp.w * 0.98, rhp: false, order: 1 });
  r = checkSolution(tf, split);
  ok(r.items.every(it => it.ok), 'check: split double pole matches ×2', JSON.stringify(r.items.filter(i => !i.ok)));

  // complex pair vs double real diagnostic
  tf = parseTransferFunction('1/(s^2+0.14*s+1)');
  const truth3 = stateFromTF(tf);
  const wrong = JSON.parse(JSON.stringify(truth3));
  wrong.elems = [
    { type: 'pole', kind: 'real', w: 1, rhp: false, order: 1 },
    { type: 'pole', kind: 'real', w: 1, rhp: false, order: 1 },
  ];
  r = checkSolution(tf, wrong);
  ok(r.items.some(it => !it.ok && /complex pair/.test(it.text)), 'check: complex-vs-double-real hint',
     JSON.stringify(r.items));

  // missing origin
  tf = parseTransferFunction('10/(s*(1+s/10))');
  const t4 = stateFromTF(tf);
  const noOrig = JSON.parse(JSON.stringify(t4));
  noOrig.p0 = 0;
  r = checkSolution(tf, noOrig);
  ok(r.items.some(it => it.kind === 'origin' && !it.ok && /Poles at origin/.test(it.text)),
     'check: flags missing integrator');

  // negative K sign check
  tf = parseTransferFunction('-10*(1+s/10)');
  const t5 = stateFromTF(tf);
  ok(t5.gainSign === -1, 'stateFromTF sign');
  const noSign = JSON.parse(JSON.stringify(t5));
  noSign.gainSign = 1;
  r = checkSolution(tf, noSign);
  ok(r.items.some(it => it.kind === 'sign' && !it.ok), 'check: flags missing K sign');
  r = checkSolution(tf, t5);
  ok(r.items.every(it => it.ok), 'check: negative K perfect', JSON.stringify(r.items.filter(i => !i.ok)));

  // ---- graph-mirroring off: each graph is checked on its own ----
  tf = parseTransferFunction('1/(1+s/10)');
  const tMir = stateFromTF(tf);
  const splitPlots = JSON.parse(JSON.stringify(tMir));
  splitPlots.elems = splitPlots.elems.map(e => Object.assign({}, e, { plots: ['mag'] }))
    .concat(tMir.elems.map(e => Object.assign({}, e, { plots: ['ph'] })));
  r = checkSolution(tf, splitPlots);
  ok(r.items.every(it => it.ok), 'check: mirrored split drawing scores perfect',
     JSON.stringify(r.items.filter(i => !i.ok)));
  ok(r.items.filter(it => it.kind === 'elem').length === 2,
     'check: one element item per graph', String(r.items.filter(it => it.kind === 'elem').length));
  ok(r.items.some(it => it.plot === 'mag') && r.items.some(it => it.plot === 'ph'),
     'check: element items carry their graph');
  ok(r.items.filter(it => it.kind === 'gain' || it.kind === 'origin').every(it => !it.plot),
     'check: shared gain/origin stay graph-agnostic');
  // same elements on both graphs (mirroring on) → a single untagged pass
  r = checkSolution(tf, JSON.parse(JSON.stringify(tMir)));
  ok(r.items.every(it => it.ok) && r.items.every(it => !it.plot),
     'check: mirrored drawing checked once, untagged',
     JSON.stringify(r.items.filter(i => !i.ok)));
  const coal = coalesceMirrored(splitPlots.elems);
  ok(coal.length === 1 && coal[0].order === 1, 'coalesce: folds disjoint-plot twins',
     'len=' + coal.length + ' order=' + (coal[0] && coal[0].order));
  ok(coal[0].plots.length === 2, 'coalesce: unions plots');
  // same-graph duplicates must still sum orders (pre-existing behaviour)
  const sameGraph = [
    { type: 'pole', kind: 'real', w: 10, order: 1, plots: ['mag'] },
    { type: 'pole', kind: 'real', w: 10, order: 1, plots: ['mag'] },
  ];
  const cSame = coalesceMirrored(sameGraph);
  ok(cSame.length === 2, 'coalesce: same-graph twins stay separate', 'len=' + cSame.length);
  const clSame = clusterElems(cSame, 0.026);
  ok(clSame.length === 1 && clSame[0].order === 2, 'coalesce: same-graph orders still sum',
     'len=' + clSame.length + ' order=' + (clSame[0] && clSame[0].order));

  // magnitude graph right, phase graph never drawn → phase flagged, mag clean
  const magOnly = JSON.parse(JSON.stringify(tMir));
  magOnly.elems = magOnly.elems.map(e => Object.assign({}, e, { plots: ['mag'] }));
  r = checkSolution(tf, magOnly);
  ok(r.items.filter(it => it.plot === 'mag').every(it => it.ok),
     'check: mag-only drawing is clean on the magnitude graph',
     JSON.stringify(r.items.filter(i => i.plot === 'mag' && !i.ok)));
  ok(r.items.some(it => it.plot === 'ph' && !it.ok && /^Missing on the phase graph/.test(it.text)),
     'check: flags element missing on the phase graph',
     JSON.stringify(r.items.filter(i => !i.ok)));
  ok(r.items.every(it => it.ok || it.plot === 'ph'),
     'check: mag-only drawing reports nothing against the magnitude graph',
     JSON.stringify(r.items.filter(i => !i.ok)));

  // extra element on the phase graph only
  const phExtra = JSON.parse(JSON.stringify(splitPlots));
  phExtra.elems.push({ type: 'zero', kind: 'real', w: 100, rhp: false, order: 1, plots: ['ph'] });
  r = checkSolution(tf, phExtra);
  ok(r.items.filter(it => it.plot === 'mag').every(it => it.ok),
     'check: extra on phase leaves magnitude clean',
     JSON.stringify(r.items.filter(i => i.plot === 'mag' && !i.ok)));
  ok(r.items.some(it => it.plot === 'ph' && it.kind === 'extra' && !it.ok),
     'check: flags extra element drawn on the phase graph',
     JSON.stringify(r.items.filter(i => !i.ok)));

  // corner frequency moved on the phase graph only
  const phMoved = JSON.parse(JSON.stringify(splitPlots));
  phMoved.elems.find(e => e.plots[0] === 'ph').w = 100;
  r = checkSolution(tf, phMoved);
  ok(r.items.filter(it => it.plot === 'mag').every(it => it.ok),
     'check: moved phase corner leaves magnitude clean',
     JSON.stringify(r.items.filter(i => i.plot === 'mag' && !i.ok)));
  ok(r.items.some(it => it.plot === 'ph' && /^Missing on the phase graph/.test(it.text)) &&
     r.items.some(it => it.plot === 'ph' && /^Extra on the phase graph/.test(it.text)),
     'check: moved corner reports missing+extra on the phase graph',
     JSON.stringify(r.items.filter(i => !i.ok)));

  // order short by one on the phase graph only (would slip through a union check)
  tf = parseTransferFunction('1/(1+s/10)^2');
  const tDbl = stateFromTF(tf);
  const dblSplit = JSON.parse(JSON.stringify(tDbl));
  dblSplit.elems = dblSplit.elems.map(e => Object.assign({}, e, { plots: ['mag'] }))
    .concat(tDbl.elems.map(e => Object.assign({}, e, { order: 1, plots: ['ph'] })));
  r = checkSolution(tf, dblSplit);
  ok(r.items.filter(it => it.plot === 'mag').every(it => it.ok),
     'check: ×2 on magnitude still correct',
     JSON.stringify(r.items.filter(i => i.plot === 'mag' && !i.ok)));
  ok(r.items.some(it => it.plot === 'ph' && !it.ok && /expected order ×2, you drew ×1/.test(it.text)),
     'check: flags short order on the phase graph',
     JSON.stringify(r.items.filter(i => !i.ok)));

  // ---- misc helpers ----
  near(Math.log10(1000), 3, 1e-12, 'log10 sanity');
  ok(fmtW(1e4).indexOf('10') === 0, 'fmtW uses power form', fmtW(1e4));

  // ---- TeX preview rendering (k, num, den) ----
  let h = texPreview('1', '1', '1+10^{-4}s');
  ok(h.indexOf('<i>G</i>(<i>s</i>)') === 0, 'tex: G(s) head', h);
  ok(h.indexOf('<span class="frac">') !== -1, 'tex: stacked fraction', h);
  ok(h.indexOf('<i>s</i>') !== -1, 'tex: italic s', h);
  ok(h.indexOf('10⁻⁴') !== -1, 'tex: 10^-4 superscript', h);

  h = texPreview('1', '10*(1+s/10)', 's*(1+s/1000)');
  ok(h.indexOf('10&nbsp;·&nbsp;') === -1, 'tex: no constant peeled from numerator', h);
  ok(h.indexOf('1 + <i>s</i>/10') !== -1, 'tex: numerator factor still present', h);
  ok(h.indexOf('<i>s</i>(1 + <i>s</i>/1000)') !== -1, 'tex: denominator juxtaposition', h);
  ok(h.indexOf('<span class="frac">') !== -1, 'tex: product over product stacks', h);
  ok(h.indexOf('<span class="fn">10(1 + <i>s</i>/10)</span>') !== -1, 'tex: constant stays in numerator', h);

  h = texPreview('1', '2*10^4', 's^2+1.4*s+100');
  ok(h.indexOf('&nbsp;·&nbsp;') === -1, 'tex: no gain prefix beside fraction', h);
  ok(h.indexOf('<span class="fn">2·10⁴</span>') !== -1, 'tex: 2·10⁴ stays in numerator', h);
  ok(h.indexOf('<i>s</i>²') !== -1, 'tex: s^2 superscript', h);
  ok(h.indexOf('1.4<i>s</i>') !== -1, 'tex: 1.4s juxtaposition', h);

  h = texPreview('1', '1', '1+10^{-4}s');
  ok(h.indexOf('&nbsp;·&nbsp;') === -1, 'tex: K=1 omitted', h);

  h = texPreview('1', '(s+1)*(s+2)', '1');
  ok(h.indexOf('(<i>s</i> + 1)(<i>s</i> + 2)') !== -1, 'tex: additive factors parenthesized', h);

  h = texPreview('1', 's', 's+1');
  ok(h.indexOf('<span class="fn"><i>s</i></span>') !== -1, 'tex: root always stacks', h);
  ok(h.indexOf('<span class="fd"><i>s</i> + 1</span>') !== -1, 'tex: denominator add inline', h);

  h = texPreview('1', '1+s', '');
  ok(h.indexOf('frac') === -1, 'tex: no fraction when denominator empty', h);
  ok(h.indexOf('1 + <i>s</i>') !== -1, 'tex: inline add when no denominator', h);

  h = texPreview('1', '\\frac{1}{1+s}', '');
  ok(h.indexOf('<span class="frac">') !== -1, 'tex: LaTeX \\frac inside a field', h);

  h = texPreview('1', 'bad(((', '1+s');
  ok(h.indexOf('tex-raw') !== -1, 'tex: fallback on parse error', h);

  h = texPreview('1', '<img>', '');
  ok(h.indexOf('&lt;img&gt;') !== -1, 'tex: fallback escapes HTML', h);

  h = texPreview('1', '', '');
  ok(h.indexOf('tex-ph') !== -1, 'tex: placeholder when empty', h);

  ok(normalizeInput('10⁻⁴s') === '10^(-4)s', 'norm: unicode superscript 10⁻⁴', normalizeInput('10⁻⁴s'));
  ok(normalizeInput('s²+1') === 's^(2)+1', 'norm: unicode superscript s²', normalizeInput('s²+1'));
  ok(normalizeInput('10⁺³') === '10^(3)', 'norm: unicode superscript 10⁺³', normalizeInput('10⁺³'));
  h = texPreview('1', '1', '1+10⁻⁴s');
  ok(h.indexOf('tex-raw') === -1, 'tex: unicode input parses', h);
  ok(h.indexOf('10⁻⁴') !== -1, 'tex: unicode input renders 10⁻⁴', h);

  h = texPreview('10', '1', '1+s');
  ok(h.indexOf('10&nbsp;·&nbsp;') !== -1 &&
     h.indexOf('<span class="fn">1</span>') !== -1 &&
     h.indexOf('<span class="fd">1 + <i>s</i></span>') !== -1,
    'tex: K field beside fraction parts', h);

  h = texPreview('1', '-2*(1+s)', '1+s');
  ok(h.indexOf('−2') !== -1, 'tex: negative scalar keeps unicode minus', h);

  h = texPreview('1', '(s+1)', '2');
  ok(h.indexOf('<span class="frac">') !== -1 &&
     h.indexOf('<span class="fd">2</span>') !== -1,
    'tex: scalar denominator stays a fraction', h);

  h = texPreview('2', '1+s', 's');
  ok(h.indexOf('2&nbsp;·&nbsp;') !== -1 && h.indexOf('<span class="fd"><i>s</i></span>') !== -1,
    'tex: explicit K field renders beside fraction', h);

  h = texPreview('2*10^4', '1+s', 's');
  ok(h.indexOf('2·10⁴') !== -1, 'tex: K field accepts 2*10^4', h);

  ok(tfExpr('1', '1', '1+s') === '(1)/(1+s)', 'tfExpr: K=1 omitted', tfExpr('1', '1', '1+s'));
  ok(tfExpr('10', '1', '1+s') === '(10)*(1)/(1+s)', 'tfExpr: K folded in', tfExpr('10', '1', '1+s'));
  ok(tfExpr('1', '', '') === '', 'tfExpr: empty → blank', tfExpr('1', '', ''));
  ok(tfExpr('5', '1+s', '') === '(5)*(1+s)', 'tfExpr: no denominator', tfExpr('5', '1+s', ''));

  return { passed, failed: failures.length, failures };
}

// ===========================================================================
// exports
// ===========================================================================

const BodeMath = {
  ParseError,
  normalizeInput, parseAst, tokenize,
  parseTransferFunction,
  exactPoint, exactCurve,
  asymMag, asymPhase, asymMagPoints, asymPhasePoints,
  stateFromTF, checkSolution,
  freqOf, cornerX, magSlopeUnit, phaseTotal,
  polyTrim, polyMul, polyAdd, rootsOf,
  texPreview, tfExpr, coalesceMirrored,
  selfTest,
};

if (typeof module !== 'undefined' && module.exports) module.exports = BodeMath;
if (global) global.BodeMath = BodeMath;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
