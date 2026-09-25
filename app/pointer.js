/* asymbode — pointer interaction: hover, click-to-place/delete, drag start,
 * wheel zoom and per-axis wheel scaling. */
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
            setStatus('Background — drag to pan · wheel zooms ω · scroll on an axis to scale it');
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

function statusX(v, isView) {
    return (isView ? 'Zoom ω ' : 'ω axis ') +
        '<span class="val">' + fmtW(Math.pow(10, v.xmin)) + '</span> … <span class="val">' +
        fmtW(Math.pow(10, v.xmax)) + '</span> rad/s';
}

function statusY(v, plot) {
    if (plot === 'mag')
        return 'Magnitude axis <span class="val">' + fmtNum(v.min, 3) + '</span> … <span class="val">' +
            fmtNum(v.max, 3) + '</span> dB';
    return 'Phase axis <span class="val">' + fmtNum(v.min) + '</span> … <span class="val">' +
        fmtNum(v.max) + '</span>°';
}

/** Scale the ω window about the cursor; no-op when the span limits say no. */
function zoomX(info, f, isView) {
    const xc = A.clamp(info.xLog, state.view.xmin, state.view.xmax);
    const v = A.scaleX(state.view, xc, f);
    if (!v) return false;
    state.view.xmin = v.xmin;
    state.view.xmax = v.xmax;
    A.render();
    setStatus(statusX(v, isView));
    return true;
}

/** Scale this graph's y window about the cursor; no-op at the span limits. */
function zoomY(info, plot, f) {
    const yr = plot === 'mag' ? state.yMag : state.yPh;
    const yc = A.clamp(info.yVal, yr.min, yr.max);
    const v = A.scaleY(yr, yc, f);
    if (!v) return false;
    yr.min = v.min;
    yr.max = v.max;
    A.render();
    setStatus(statusY(v, plot));
    return true;
}

function bindWheel(canvasEl, plot) {
    canvasEl.addEventListener('wheel', (e) => {
        e.preventDefault();
        const info = canvasInfo(canvasEl, plot, e);
        const f = A.wheelFactor(e.deltaY);
        if (!f) return;
        const target = A.wheelTarget(info.px, info.py, info.g);
        if (target === 'y') zoomY(info, plot, f);
        else zoomX(info, f, target === 'view');   // 'x' strip and the plot itself
    }, { passive: false });
}

A.canvasInfo = canvasInfo;
A.updateHover = updateHover;
A.bindCanvas = bindCanvas;
A.bindWheel = bindWheel;

})(globalThis.BodeApp = globalThis.BodeApp || {});
