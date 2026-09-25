/* asymbode — the user's drawing model: element helpers, placing, removing,
 * clearing and hit-testing. */
(function (A) {
'use strict';

const state = A.state;
const els = A.els;
const canvas = A.canvas;
const BM = window.BodeMath;
const { fmtW, setStatus } = A;

/** Is this element drawn on `plot`? (missing `plots` = both, pre-sync format) */
function elemOnPlot(e, plot) {
    return !Array.isArray(e.plots) || e.plots.indexOf(plot) !== -1;
}

/**
 * state.user with only the elems drawn on `plot` — used for curve math so
 * turning mirror off freezes the other graph's asymptote.
 */
function userForPlot(plot) {
    return Object.assign({}, state.user, {
        elems: (state.user.elems || []).filter(e => elemOnPlot(e, plot)),
    });
}

function elemLabel(e) {
    const kind = e.kind === 'complex' ? 'c.' : '';
    const type = e.type === 'zero' ? 'zero' : 'pole';
    return kind + type;
}

function placeAt(xLog, free, plot) {
    const t = state.tool;
    if (t !== 'zero' && t !== 'pole' && t !== 'czero' && t !== 'cpole') return null;
    plot = plot || 'mag';
    const type = (t === 'zero' || t === 'czero') ? 'zero' : 'pole';
    const kind = (t === 'zero' || t === 'pole') ? 'real' : 'complex';
    const snap = free ? xLog : A.snapX(xLog, plot);
    const u = state.user;
    const ex = u.elems.find(e =>
        e.type === type && e.kind === kind &&
        Math.abs(BM.cornerX(e) - snap) <= 0.025 &&
        elemOnPlot(e, plot));

    let elem;
    if (ex) {
        ex.order++;
        elem = ex;
        if (state.syncPlots) elem.plots = ['mag', 'ph'];
    } else {
        elem = kind === 'real'
            ? { id: state.nextId++, type, kind: 'real', w: Math.pow(10, snap), order: 1 }
            : { id: state.nextId++, type, kind: 'complex', wn: Math.pow(10, snap), zeta: 0.5, order: 1 };
        elem.plots = state.syncPlots ? ['mag', 'ph'] : [plot];
        u.elems.push(elem);
    }
    state.selId = elem.id;

    const slope = BM.magSlopeUnit(elem) * elem.order;
    setStatus(
        (ex ? 'Raised ' : 'Placed ') + '<b>' + elemLabel(elem) + '</b> ×' + elem.order +
        ' at ω = <span class="val">' + fmtW(BM.freqOf(elem)) + '</span> rad/s' +
        ' · slope ' + (slope > 0 ? '+' : '−') + Math.abs(slope) + ' dB/dec above the corner' +
        (state.syncPlots ? '' : ' · on the ' + (plot === 'mag' ? 'magnitude' : 'phase') + ' graph only')
    );
    A.recordHistory();
    A.updateSidebar();
    A.render();
    return elem;
}

function removeElem(id, plot) {
    const u = state.user;
    const i = u.elems.findIndex(e => e.id === id);
    if (i < 0) return false;
    const e = u.elems[i];
    // mirroring off + element lives on both graphs + removed from one plot
    // → strip that plot only; the element stays where it is still drawn
    if (plot && !state.syncPlots && Array.isArray(e.plots) && e.plots.length > 1) {
        const j = e.plots.indexOf(plot);
        if (j !== -1) {
            e.plots.splice(j, 1);
            setStatus('Removed <b>' + elemLabel(e) + '</b> from the ' +
                (plot === 'mag' ? 'magnitude' : 'phase') + ' graph only');
            A.recordHistory();
            A.updateSidebar();
            A.render();
            return true;
        }
    }
    u.elems.splice(i, 1);
    if (state.selId === id) state.selId = null;
    setStatus('Removed <b>' + elemLabel(e) + '</b> at ω = <span class="val">' + fmtW(BM.freqOf(e)) + '</span>');
    A.recordHistory();
    A.updateSidebar();
    A.render();
    return true;
}

function removeSelected() {
    if (state.selId == null) { setStatus('Nothing selected — click a marker first'); return; }
    removeElem(state.selId);
}

function clearUser() {
    state.user.gainDB = 0;
    state.user.gainSign = 1;
    state.user.z0 = 0;
    state.user.p0 = 0;
    state.user.elems = [];
    state.selId = null;
    A.resetSolution();
    A.recordHistory();
    setStatus('Cleared your drawing (the loaded transfer function is kept)');
    A.updateSidebar();
    A.render();
}

// ---------------------------------------------------------------------------
// hit-testing
// ---------------------------------------------------------------------------

function hitElem(px, py, plot) {
    const g = plot === 'mag' ? A.geom(canvas.magW, canvas.magH) : A.geom(canvas.phW, canvas.phH);
    const yr = plot === 'mag' ? state.yMag : state.yPh;
    const u = userForPlot(plot);
    let best = null, bestD = 12;
    for (const e of state.user.elems) {
        if (!elemOnPlot(e, plot)) continue;
        const xc = BM.cornerX(e);
        if (xc < state.view.xmin || xc > state.view.xmax) continue;
        const yv = plot === 'mag' ? BM.asymMag(u, xc) : BM.asymPhase(u, xc);
        const ex = A.xToPx(xc, g), ey = A.yToPx(yv, g, yr);
        const d = Math.hypot(ex - px, ey - py);
        if (d <= bestD) { bestD = d; best = e; }
    }
    return best;
}

A.elemOnPlot = elemOnPlot;
A.userForPlot = userForPlot;
A.elemLabel = elemLabel;
A.placeAt = placeAt;
A.removeElem = removeElem;
A.removeSelected = removeSelected;
A.clearUser = clearUser;
A.hitElem = hitElem;

})(globalThis.BodeApp = globalThis.BodeApp || {});
