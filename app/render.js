/* asymbode — top-level render: axes, curves, overlays, ghosts and markers. */
(function (A) {
'use strict';

const state = A.state;
const canvas = A.canvas;
const BM = window.BodeMath;
const { DARK } = A;

function render() {
    if (!canvas.magCtx) return;
    const gy = A.drawAxes(canvas.magCtx, canvas.magW, canvas.magH, state.yMag, { yUnit: 'dB', isPhase: false });
    const gp = A.drawAxes(canvas.phCtx, canvas.phW, canvas.phH, state.yPh, { yUnit: 'deg', isPhase: true });

    A.drawCrosshair(canvas.magCtx, canvas.magW, canvas.magH, state.yMag, 'mag');
    A.drawCrosshair(canvas.phCtx, canvas.phW, canvas.phH, state.yPh, 'ph');

    // user asymptotes
    const mpts = BM.asymMagPoints(A.userForPlot('mag'), state.view.xmin, state.view.xmax);
    const ppts = BM.asymPhasePoints(A.userForPlot('ph'), state.view.xmin, state.view.xmax);
    A.drawPolyline(canvas.magCtx, mpts, gy, state.yMag, DARK.user, 2.2);
    A.drawPolyline(canvas.phCtx, ppts, gp, state.yPh, DARK.user, 2.2);

    // solution overlay: dashed asymptote, or the real Bode plot while Ctrl is held
    if (state.showSol && state.tf && state.tfState) {
        if (state.ctrlHeld) {
            const pts = BM.exactCurve(state.tf, state.view.xmin, state.view.xmax, 400,
                BM.asymPhase(state.tfState, state.view.xmin));
            A.drawPolyline(canvas.magCtx, pts.map(p => ({ x: p.x, y: p.db })), gy, state.yMag, DARK.exact, 1.8);
            A.drawPolyline(canvas.phCtx, pts.map(p => ({ x: p.x, y: p.ph })), gp, state.yPh, DARK.exact, 1.8);
        } else {
            const smp = BM.asymMagPoints(state.tfState, state.view.xmin, state.view.xmax);
            const spp = BM.asymPhasePoints(state.tfState, state.view.xmin, state.view.xmax);
            A.drawPolyline(canvas.magCtx, smp, gy, state.yMag, DARK.sol, 1.8, [6, 4]);
            A.drawPolyline(canvas.phCtx, spp, gp, state.yPh, DARK.sol, 1.8, [6, 4]);
        }
    }

    // raw-power ghost (dotted) — only on the plot currently being hovered
    const ghMag = A.ghostPoints('mag');
    if (ghMag) A.drawPolyline(canvas.magCtx, ghMag.pts, gy, state.yMag, 'rgba(255,255,255,0.55)', 1.4, [4, 4]);
    const ghPh = A.ghostPoints('ph');
    if (ghPh) A.drawPolyline(canvas.phCtx, ghPh.pts, gp, state.yPh, 'rgba(255,255,255,0.55)', 1.4, [4, 4]);

    A.drawMarkers(canvas.magCtx, canvas.magW, canvas.magH, state.yMag, 'mag');
    A.drawMarkers(canvas.phCtx, canvas.phW, canvas.phH, state.yPh, 'ph');
}

function resizeAll() {
    const m = A.fitCanvas(A.els.magCanvas);
    canvas.magCtx = m.ctx; canvas.magW = m.w; canvas.magH = m.h;
    const p = A.fitCanvas(A.els.phCanvas);
    canvas.phCtx = p.ctx; canvas.phW = p.w; canvas.phH = p.h;
    render();
}

A.render = render;
A.resizeAll = resizeAll;

})(globalThis.BodeApp = globalThis.BodeApp || {});
