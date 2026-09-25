/* asymbode-math — TeX-style HTML rendering of a transfer function (the G(s) preview). */
(function (A) {
'use strict';

const { normalizeInput, parseAst, sup } = A;

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

/**
 * Build the live G(s) preview HTML from K / numerator / denominator field
 * text. Never throws: unparseable input falls back to the raw text.
 *
 * Only the K field renders as a prefix; numeric factors inside N/D stay
 * in the fraction:  G(s) = K · N(s)/D(s).
 */
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

A.texPreview = texPreview;
A.tfExpr = tfExpr;

})(globalThis.BodeMath = globalThis.BodeMath || {});
