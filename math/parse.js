/* asymbode-math — input normalization, tokenizer and recursive-descent parser.
 *
 * AST nodes:
 *   { t:'num', v }                     numeric literal
 *   { t:'s' }                          the complex variable
 *   { t:'neg', a }                     unary minus
 *   { t:'add'|'sub'|'mul'|'div', a, b } binary operators
 *   { t:'pow', a, b }                  exponentiation (right associative)
 */
(function (A) {
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

A.ParseError = ParseError;
A.normalizeInput = normalizeInput;
A.tokenize = tokenize;
A.parseAst = parseAst;

})(globalThis.BodeMath = globalThis.BodeMath || {});
