/* asymbode — raw-power ghost: the dotted preview line shown while hovering a
 * plot with a placement tool (or Shift over a marker). */
(function (A) {
'use strict';

const state = A.state;
const BM = window.BodeMath;

/**
 * Ghost for `plot`, or null when nothing should be shown:
 *  magnitude → the element's ±20 dB/dec (or ±40) slope line through its corner,
 *              spanning the plot on both sides of the corner;
 *  phase     → the element's phase ramp (0 → ±90°/±180° over corner±1 decade).
 */
function ghostPoints(plot) {
    const u = state.user;
    const hov = state.hover;
    if (!hov || !hov.inPlot || hov.plot !== plot) return null;
    const t = state.tool;
    const placeTool = t === 'zero' || t === 'pole' || t === 'czero' || t === 'cpole';

    let elem = null, xc;
    if (placeTool) {
        const type = (t === 'zero' || t === 'czero') ? 'zero' : 'pole';
        const kind = (t === 'zero' || t === 'pole') ? 'real' : 'complex';
        xc = hov.free ? hov.xLog : A.snapX(hov.xLog, plot);
        const ex = u.elems.find(e =>
            e.type === type && e.kind === kind &&
            Math.abs(BM.cornerX(e) - xc) <= 0.025 &&
            A.elemOnPlot(e, plot));
        const order = ex ? ex.order + 1 : 1;
        elem = kind === 'complex'
            ? { type, kind: 'complex', wn: 1, zeta: 0.5, order }
            : { type, kind: 'real', w: 1, order };
    } else if (hov.shift && hov.elemId != null) {
        const e = u.elems.find(el => el.id === hov.elemId && A.elemOnPlot(el, plot));
        if (!e) return null;
        elem = e;
        xc = BM.cornerX(e);
    } else return null;

    const xmin = state.view.xmin, xmax = state.view.xmax;
    if (xc < xmin || xc > xmax) return null;

    if (plot === 'mag') {
        const y0 = BM.asymMag(A.userForPlot('mag'), xc);
        const slope = BM.magSlopeUnit(elem) * elem.order;
        // one straight slope line through the corner, spanning the whole plot
        return {
            xc,
            pts: [
                { x: xmin, y: y0 + slope * (xmin - xc) },
                { x: xc, y: y0 },
                { x: xmax, y: y0 + slope * (xmax - xc) },
            ],
        };
    }

    // phase: ramp from 0 at the corner − 1 decade to the total at corner + 1 decade,
    // starting from the current phase level where the ramp begins.
    const total = BM.phaseTotal(elem) * elem.order;
    const xa = xc - 1, xb = xc + 1;
    const y0 = BM.asymPhase(A.userForPlot('ph'), xa);
    const rampY = (x) => y0 + total * Math.min(1, Math.max(0, (x - xa) / 2));
    const xs = [Math.max(xmin, xa), xa, xb, xmax]
        .filter(x => x >= xmin && x <= xmax)
        .sort((a, b) => a - b);
    const uniq = [];
    for (const x of xs) if (!uniq.length || x - uniq[uniq.length - 1] > 1e-12) uniq.push(x);
    if (uniq.length < 2) return null;
    return { xc, pts: uniq.map(x => ({ x, y: rampY(x) })) };
}

A.ghostPoints = ghostPoints;

})(globalThis.BodeApp = globalThis.BodeApp || {});
