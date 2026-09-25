/* asymbode — pointer interaction: hover, click-to-place/delete, drag start,
 * wheel zoom. */
(function (A) {
'use strict';

const state = A.state;
const canvas = A.canvas;
const BM = window.BodeMath;
const { fmtW, fmtNum, setStatus } = A;

function canvasInfo(canvasEl, plot, e) {
    const rect = canvasEl.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const g = plot === 'mag' ? A.geom(canvas.magW, canvas.magH) : A.geom(canvas.phW, canvas.phH);
    const yr = plot === 'mag' ? state.yMag : state.yPh;
    const xLog = A.pxToX(px, g);
    const yVal = A.pxToY(py, g, yr);
    const inPlot = px >= g.l && px <= g.r && py >= g.t && py <= g.b;
    return { px, py, xLog, yVal, inPlot, g, yr, plot };
}

function updateHover(canvasEl, plot, e) {
    const info = canvasInfo(canvasEl, plot, e);
    const hit = info.inPlot ? A.hitElem(info.px, info.py, plot) : null;
    state.hover = {
        plot, px: info.px, py: info.py, xLog: info.xLog, yVal: info.yVal,
        inPlot: info.inPlot, elemId: hit ? hit.id : null,
        shift: e.shiftKey, free: e.ctrlKey || e.metaKey,
    };
    if (info.inPlot) {
        const w = Math.pow(10, info.xLog);
        let extra = '';
        if (hit) extra = ' · hovered <b>' + A.elemLabel(hit) + '</b> at ω = <span class="val">' + fmtW(BM.freqOf(hit)) + '</span>';
        if (plot === 'mag')
            setStatus('ω = <span class="val">' + fmtW(w) + '</span> · <span class="val">' +
                fmtNum(info.yVal) + '</span> dB' + extra);
        else
            setStatus('ω = <span class="val">' + fmtW(w) + '</span> · <span class="val">' +
                fmtNum(info.yVal) + '</span>°' + extra);
    }
    A.render();
}

function bindCanvas(canvasEl, plot) {
    canvasEl.addEventListener('pointermove', (e) => {
        const info = canvasInfo(canvasEl, plot, e);
        if (state.drag && state.drag.pointerId === e.pointerId) {
            if (info.inPlot) A.onDragMove(info, e);
            return;
        }
        updateHover(canvasEl, plot, e);
    });
    canvasEl.addEventListener('pointerleave', () => {
        if (state.drag) return;
        state.hover = null;
        A.render();
    });
    canvasEl.addEventListener('pointerup', (e) => {
        if (state.drag && state.drag.pointerId === e.pointerId) A.endDrag();
    });
    canvasEl.addEventListener('pointercancel', () => A.endDrag());
    canvasEl.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const info = canvasInfo(canvasEl, plot, e);
        if (!info.inPlot) return;
        const t = state.tool;

        if (t === 'zero' || t === 'pole' || t === 'czero' || t === 'cpole') {
            A.placeAt(info.xLog, e.ctrlKey || e.metaKey, plot);
            updateHover(canvasEl, plot, e);
            return;
        }
        if (t === 'delete') {
            const hitD = A.hitElem(info.px, info.py, plot);
            if (hitD) A.removeElem(hitD.id, plot);
            else setStatus('Nothing to delete there');
            updateHover(canvasEl, plot, e);
            return;
        }

        // select tool: click selects, then possibly start a drag gesture
        const hit = A.hitElem(info.px, info.py, plot);
        state.selId = hit ? hit.id : null;
        if (hit)
            setStatus('Selected <b>' + A.elemLabel(hit) + '</b> ×' + hit.order +
                ' at ω = <span class="val">' + fmtW(BM.freqOf(hit)) + '</span> — drag to move, <b>Del</b> to remove');
        else
            setStatus('Background — drag to pan, wheel to zoom ω');
        A.updateSidebar();

        let mode = 'pan';
        if (hit) mode = 'marker';
        else if (plot === 'mag') {
            const yAt = BM.asymMag(A.userForPlot('mag'), info.xLog);
            const yPx = A.yToPx(yAt, info.g, state.yMag);
            if (Math.abs(info.py - yPx) <= 7) mode = 'line';
        }
        state.drag = {
            mode, pointerId: e.pointerId, plot, canvas: canvasEl,
            id: hit ? hit.id : null,
            startX: info.px, startY: info.py,
            view0: {
                xmin: state.view.xmin, xmax: state.view.xmax,
                yMag: { min: state.yMag.min, max: state.yMag.max },
                yPh: { min: state.yPh.min, max: state.yPh.max },
            },
            gain0: state.user.gainDB,
            moved: false,
        };
        try { canvasEl.setPointerCapture(e.pointerId); } catch (_) { /* ok */ }
        updateHover(canvasEl, plot, e);
    });
}

function bindWheel(canvasEl, plot) {
    canvasEl.addEventListener('wheel', (e) => {
        e.preventDefault();
        const info = canvasInfo(canvasEl, plot, e);
        if (!info.inPlot) return;
        const span = state.view.xmax - state.view.xmin;
        if (span <= 0.5 && e.deltaY > 0) return;
        if (span >= 24 && e.deltaY < 0) return;
        const f = e.deltaY < 0 ? 1 / 1.12 : 1.12;
        const xc = A.clamp(info.xLog, state.view.xmin, state.view.xmax);
        const xmin = xc + (state.view.xmin - xc) * f;
        const xmax = xc + (state.view.xmax - xc) * f;
        if (xmax - xmin < 0.4 || xmax - xmin > 24) return;
        state.view.xmin = xmin;
        state.view.xmax = xmax;
        A.render();
        setStatus('Zoom ω <span class="val">' + fmtW(Math.pow(10, xmin)) + '</span> … <span class="val">' +
            fmtW(Math.pow(10, xmax)) + '</span> rad/s');
    }, { passive: false });
}

A.canvasInfo = canvasInfo;
A.updateHover = updateHover;
A.bindCanvas = bindCanvas;
A.bindWheel = bindWheel;

})(globalThis.BodeApp = globalThis.BodeApp || {});
