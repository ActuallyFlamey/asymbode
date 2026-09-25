/* asymbode-math — correctness check: user drawing vs. true transfer function. */
(function (A) {
'use strict';

const { freqOf, stateFromTF, fmtDb, fmtW, sup } = A;

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

A.clusterElems = clusterElems;
A.elemPlots = elemPlots;
A.splitAcrossPlots = splitAcrossPlots;
A.coalesceMirrored = coalesceMirrored;
A.matchElems = matchElems;
A.checkSolution = checkSolution;

})(globalThis.BodeMath = globalThis.BodeMath || {});
