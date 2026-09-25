/* asymbode — drag gestures (pan / gain line / marker) and the floating tip. */
(function (A) {
'use strict';

const state = A.state;
const els = A.els;
const BM = window.BodeMath;
const { fmtW, fmtNum, clamp, setStatus } = A;

function showDragTip(e, html) {
    const tip = els.dragTip;
    const rect = els.plots.getBoundingClientRect();
    tip.innerHTML = html;
    tip.hidden = false;
    tip.style.left = (e.clientX - rect.left) + 'px';
    tip.style.top = (e.clientY - rect.top) + 'px';
}

function hideDragTip() { if (els.dragTip) els.dragTip.hidden = true; }

function onDragMove(info, e) {
    const d = state.drag;
    if (!d) return;
    const dx = info.px - d.startX, dy = info.py - d.startY;
    if (!d.moved && Math.hypot(dx, dy) <= 3) return;
    if (!d.moved) d.moved = true;

    if (d.mode === 'pan') {
        const g = info.g;
        const spanX = d.view0.xmax - d.view0.xmin;
        const dxData = dx / g.w * spanX;
        state.view.xmin = d.view0.xmin - dxData;
        state.view.xmax = d.view0.xmax - dxData;
        const yr0 = info.plot === 'mag' ? d.view0.yMag : d.view0.yPh;
        const spanY = yr0.max - yr0.min;
        const dyData = dy / g.h * spanY;
        const yr = info.plot === 'mag' ? state.yMag : state.yPh;
        yr.min = yr0.min + dyData;
        yr.max = yr0.max + dyData;
        showDragTip(e,
            'ω <span class="val">' + fmtW(Math.pow(10, state.view.xmin)) + '</span> … ' +
            '<span class="val">' + fmtW(Math.pow(10, state.view.xmax)) + '</span>' +
            (info.plot === 'mag'
                ? ' · y <span class="val">' + fmtNum(yr.min, 3) + '</span>…<span class="val">' + fmtNum(yr.max, 3) + '</span> dB'
                : ' · y <span class="val">' + fmtNum(yr.min) + '</span>…<span class="val">' + fmtNum(yr.max) + '</span>°'));
    } else if (d.mode === 'line') {
        const g = info.g;
        const yStartVal = A.pxToY(d.startY, g, d.view0.yMag);
        const yNow = A.pxToY(info.py, g, d.view0.yMag);
        const gain = Math.round(clamp(d.gain0 + (yNow - yStartVal), -200, 200) * 10) / 10;
        state.user.gainDB = gain;
        A.updateGainUI();
        showDragTip(e,
            '20 lg|K| = <span class="val">' + fmtNum(gain) + '</span> dB · |K| = <span class="val">' +
            fmtNum(Math.pow(10, gain / 20)) + '</span>');
    } else if (d.mode === 'marker') {
        const el = state.user.elems.find(x => x.id === d.id);
        if (!el) return;
        const free = e.ctrlKey || e.metaKey;
        let xLog = free ? info.xLog : A.snapX(info.xLog, d.plot);
        xLog = clamp(xLog, state.view.xmin, state.view.xmax);
        const w = Math.pow(10, xLog);
        if (el.kind === 'real') el.w = w; else el.wn = w;
        A.updateElemList();
        showDragTip(e,
            A.elemLabel(el) + ' → ω = <span class="val">' + fmtW(w) + '</span>' +
            (free ? ' <span class="val">free</span>' : ' <span class="val">snap grid</span>'));
    }
    A.render();
}

function endDrag() {
    const d = state.drag;
    if (!d) return;
    state.drag = null;
    hideDragTip();
    if (d.canvas && d.pointerId != null) {
        try { d.canvas.releasePointerCapture(d.pointerId); } catch (_) { /* already released */ }
    }
    if (d.moved) {
        if (d.mode === 'line')
            setStatus('Gain 20 lg|K| = <span class="val">' + fmtNum(state.user.gainDB) +
                '</span> dB · |K| = <span class="val">' + fmtNum(Math.pow(10, state.user.gainDB / 20)) + '</span>');
        else if (d.mode === 'pan')
            setStatus('View ω <span class="val">' + fmtW(Math.pow(10, state.view.xmin)) + '</span> … <span class="val">' +
                fmtW(Math.pow(10, state.view.xmax)) + '</span> rad/s');
        else if (d.mode === 'marker') {
            const el = state.user.elems.find(x => x.id === d.id);
            if (el)
                setStatus('Moved <b>' + A.elemLabel(el) + '</b> to ω = <span class="val">' + fmtW(BM.freqOf(el)) + '</span>');
        }
        if (d.mode === 'line' || d.mode === 'marker') A.recordHistory();
        A.updateSidebar();
    }
    A.render();
}

A.showDragTip = showDragTip;
A.hideDragTip = hideDragTip;
A.onDragMove = onDragMove;
A.endDrag = endDrag;

})(globalThis.BodeApp = globalThis.BodeApp || {});
