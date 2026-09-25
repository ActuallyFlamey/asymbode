/* asymbode — canvas rendering primitives: axes/grid, clipped polylines,
 * element markers and the hover crosshair. */
(function (A) {
'use strict';

const state = A.state;
const BM = window.BodeMath;
const { DARK } = A;
const { fmtDecade, supStr } = A;
const { geom, xToPx, yToPx, yTickStep } = A;
const { elemOnPlot } = A;

/** Size the canvas to its wrapper at the device pixel ratio. */
function fitCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    const w = Math.max(50, Math.round(rect.width));
    const h = Math.max(50, Math.round(rect.height));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
}

function drawAxes(ctx, w, h, yr, opts) {
    const g = geom(w, h);
    const isPhase = !!opts.isPhase;

    ctx.fillStyle = DARK.plot;
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#0c1118';
    ctx.fillRect(g.l, g.t, g.w, g.h);

    const step = yTickStep(yr.max - yr.min, isPhase);
    const decs = [];
    for (let k = Math.ceil(state.view.xmin); k <= Math.floor(state.view.xmax); k++) decs.push(k);
    const spanDec = state.view.xmax - state.view.xmin;
    const minor = spanDec <= 16 && g.w / spanDec > 46;

    ctx.save();
    ctx.beginPath();
    ctx.rect(g.l, g.t, g.w, g.h);
    ctx.clip();

    if (minor) {
        ctx.strokeStyle = DARK.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let k = Math.floor(state.view.xmin); k <= Math.ceil(state.view.xmax); k++) {
            for (let m = 2; m <= 9; m++) {
                const x = xToPx(k + Math.log10(m), g);
                if (x >= g.l && x <= g.r) { ctx.moveTo(x + .5, g.t); ctx.lineTo(x + .5, g.b); }
            }
        }
        ctx.stroke();
    }

    ctx.strokeStyle = DARK.gridBold;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const k of decs) {
        const x = xToPx(k, g);
        if (x >= g.l - .5 && x <= g.r + .5) { ctx.moveTo(x + .5, g.t); ctx.lineTo(x + .5, g.b); }
    }
    ctx.stroke();

    ctx.strokeStyle = DARK.grid;
    ctx.beginPath();
    for (let y = Math.ceil(yr.min / step) * step; y <= yr.max + 1e-9; y += step) {
        const py = Math.round(yToPx(y, g, yr)) + .5;
        ctx.moveTo(g.l, py); ctx.lineTo(g.r, py);
    }
    ctx.stroke();

    ctx.restore();

    ctx.strokeStyle = DARK.gridBold;
    ctx.lineWidth = 1;
    ctx.strokeRect(g.l + .5, g.t + .5, g.w - 1, g.h - 1);

    ctx.fillStyle = DARK.axis;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let y = Math.ceil(yr.min / step) * step; y <= yr.max + 1e-9; y += step) {
        const py = yToPx(y, g, yr);
        if (py < g.t - 1 || py > g.b + 1) continue;
        let label;
        if (isPhase) label = (Math.round(y) === y ? String(Math.round(y)) : y.toFixed(1)) + '°';
        else label = String(Math.round(y) === y ? Math.round(y) : Number(y.toFixed(2)));
        ctx.fillText(label, g.l - 7, py);
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    // Every label keeps clear of its neighbours and of the unit caption that
    // sits in the right-hand corner of the same row.
    const UNIT_RESERVE = 66;
    const placed = [];
    const put = (t, x) => {
        const w = ctx.measureText(t).width;
        ctx.fillText(t, x, g.b + 7);
        placed.push({ x, w });
    };
    const free = (t, x) => {
        const w = ctx.measureText(t).width;
        if (x + w / 2 > g.r - UNIT_RESERVE) return false;
        return placed.every(p => Math.abs(p.x - x) * 2 >= p.w + w + 12);
    };

    const labelStep = Math.max(1, Math.ceil(decs.length / 14));
    decs.forEach((k, i) => {
        if (i % labelStep !== 0) return;
        const x = xToPx(k, g);
        if (x < g.l - 1 || x > g.r + 1) return;
        const t = fmtDecade(k);
        if (x + ctx.measureText(t).width / 2 <= g.r - UNIT_RESERVE) put(t, x);
    });

    // 2…9 × 10ᵏ get labelled too while zoomed in — "2·10¹", or plain "2" in
    // the 10⁰ decade — once a decade is wide enough to hold one comfortably.
    const MINOR_LABEL_PX = 120;
    if (minor && g.w / spanDec >= MINOR_LABEL_PX) {
        for (let k = Math.floor(state.view.xmin); k <= Math.ceil(state.view.xmax); k++) {
            for (let m = 2; m <= 9; m++) {
                const x = xToPx(k + Math.log10(m), g);
                if (x < g.l || x > g.r) continue;
                const t = k === 0 ? String(m) : m + '·10' + supStr(k);
                if (free(t, x)) put(t, x);
            }
        }
    }

    ctx.fillStyle = DARK.title;
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(opts.yUnit, g.l, 0);
    ctx.textAlign = 'right';
    ctx.fillText(opts.xUnit || 'ω [rad/s]', g.r, g.b + 7);

    return g;
}

/** Liang–Barsky clip of segment a→b against box; returns [p,q] or null. */
function clipSeg(a, b, box) {
    let t0 = 0, t1 = 1;
    const dx = b.x - a.x, dy = b.y - a.y;
    const tests = [
        [-dx, a.x - box.x0],
        [dx, box.x1 - a.x],
        [-dy, a.y - box.y0],
        [dy, box.y1 - a.y],
    ];
    for (let i = 0; i < 4; i++) {
        const p = tests[i][0], q = tests[i][1];
        if (p === 0) { if (q < 0) return null; continue; }
        const r = q / p;
        if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
        else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
    const at = (t) => ({ x: a.x + dx * t, y: a.y + dy * t });
    return [at(t0), at(t1)];
}

function drawPolyline(ctx, pts, g, yr, color, width, dash) {
    if (!pts || pts.length < 2) return;
    // Project unclamped; clip segments geometrically (clamping vertices would
    // distort slopes when zoomed out). x is always inside the plot, only y can
    // explode far off-screen.
    const box = { x0: g.l - 1, y0: g.t - 1, x1: g.r + 1, y1: g.b + 1 };
    const proj = new Array(pts.length);
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (!isFinite(p.x) || !isFinite(p.y)) { proj[i] = null; continue; }
        const x = xToPx(p.x, g), y = yToPx(p.y, g, yr);
        proj[i] = (isFinite(x) && isFinite(y)) ? { x, y } : null;
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(g.l, g.t, g.w, g.h);
    ctx.clip();
    ctx.beginPath();
    let prev = null, any = false;
    for (let i = 0; i < proj.length - 1; i++) {
        const a = proj[i], b = proj[i + 1];
        if (!a || !b) { prev = null; continue; }
        const c = clipSeg(a, b, box);
        if (!c) { prev = null; continue; }
        const p = c[0], q = c[1];
        if (prev && Math.abs(prev.x - p.x) < 0.01 && Math.abs(prev.y - p.y) < 0.01)
            ctx.lineTo(p.x, p.y);
        else
            ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        prev = q;
        any = true;
    }
    if (any) {
        ctx.strokeStyle = color;
        ctx.lineWidth = width || 2;
        ctx.setLineDash(dash || []);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();
    }
    ctx.restore();
}

// ---------------------------------------------------------------------------
// element markers
// ---------------------------------------------------------------------------

function markerPos(e, g, yr, plot) {
    const xc = BM.cornerX(e);
    const u = A.userForPlot(plot);
    const yv = plot === 'mag' ? BM.asymMag(u, xc) : BM.asymPhase(u, xc);
    return { px: xToPx(xc, g), py: yToPx(yv, g, yr), xc };
}

function drawMarker(ctx, px, py, e, opts) {
    const sel = opts.selected, hov = opts.hovered;
    const r = 5.5;
    ctx.save();
    ctx.lineWidth = sel ? 2.5 : 1.8;

    if (e.kind === 'complex') {
        // diamond: outlined = zero, filled = pole
        ctx.beginPath();
        ctx.moveTo(px, py - r - 1);
        ctx.lineTo(px + r + 1, py);
        ctx.lineTo(px, py + r + 1);
        ctx.lineTo(px - r - 1, py);
        ctx.closePath();
        if (e.type === 'pole') { ctx.fillStyle = DARK.cplx; ctx.fill(); }
        else { ctx.fillStyle = '#0c1118'; ctx.fill(); ctx.strokeStyle = DARK.cplx; ctx.stroke(); }
        if (e.type === 'zero') { ctx.strokeStyle = DARK.cplx; ctx.stroke(); }
    } else if (e.type === 'zero') {
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fillStyle = '#0c1118';
        ctx.fill();
        ctx.strokeStyle = DARK.zero;
        ctx.stroke();
        // inner ring for higher orders
        if (e.order > 1) {
            ctx.beginPath();
            ctx.arc(px, py, r - 2.5, 0, Math.PI * 2);
            ctx.stroke();
        }
    } else {
        // pole ×
        const s = r + 1;
        ctx.strokeStyle = DARK.pole;
        ctx.beginPath();
        ctx.moveTo(px - s, py - s); ctx.lineTo(px + s, py + s);
        ctx.moveTo(px + s, py - s); ctx.lineTo(px - s, py + s);
        ctx.stroke();
        if (e.order > 1) {
            ctx.beginPath();
            ctx.arc(px, py, r - 1, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    if (sel) {
        ctx.beginPath();
        ctx.arc(px, py, r + 4, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
    } else if (hov) {
        ctx.beginPath();
        ctx.arc(px, py, r + 3, 0, Math.PI * 2);
        ctx.strokeStyle = DARK.hover;
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    if (e.order > 1) {
        ctx.font = '600 11px system-ui, sans-serif';
        ctx.fillStyle = DARK.text;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText('×' + e.order, px + r + 3, py - r + 1);
    }
    ctx.restore();
}

function drawMarkers(ctx, w, h, yr, plot) {
    const g = geom(w, h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(g.l, g.t, g.w, g.h);
    ctx.clip();
    for (const e of state.user.elems) {
        if (!elemOnPlot(e, plot)) continue;
        const xc = BM.cornerX(e);
        if (xc < state.view.xmin || xc > state.view.xmax) continue;
        const { px, py } = markerPos(e, g, yr, plot);
        if (py < g.t - 20 || py > g.b + 20) continue;
        drawMarker(ctx, px, py, e, {
            selected: e.id === state.selId,
            hovered: state.hover && state.hover.elemId === e.id,
        });
    }
    ctx.restore();
}

function drawCrosshair(ctx, w, h, yr, plot) {
    const hov = state.hover;
    if (!hov || hov.plot !== plot) return;
    const g = geom(w, h);
    const px = xToPx(hov.xLog, g);
    if (px < g.l || px > g.r) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(g.l, g.t, g.w, g.h);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(px + .5, g.t);
    ctx.lineTo(px + .5, g.b);
    ctx.stroke();
    ctx.restore();
}

A.fitCanvas = fitCanvas;
A.drawAxes = drawAxes;
A.drawPolyline = drawPolyline;
A.drawMarker = drawMarker;
A.drawMarkers = drawMarkers;
A.drawCrosshair = drawCrosshair;

})(globalThis.BodeApp = globalThis.BodeApp || {});
