/* asymbode — app: rendering, placement tools, sidebar */
(function () {
'use strict';

const BM = window.BodeMath;

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------
const state = {
  view: { xmin: -3, xmax: 3 },          // log10(omega) window
  yMag: { min: -40, max: 40 },
  yPh: { min: -225, max: 225 },
  tool: 'select',
  hover: null,                           // {plot, px, py, xLog, yVal, elemId, shift, free}
  user: { gainDB: 0, gainSign: 1, z0: 0, p0: 0, elems: [] },
  syncPlots: true,                       // mirror placements/edits between graphs
  selId: null,
  nextId: 1,
  tf: null,                              // parsed truth TF
  tfState: null,                         // stateFromTF(tf)
  showSol: false,                        // solution overlay visible
  ctrlHeld: false,                       // Ctrl → real (exact) Bode instead of solution asymptote
  drag: null,                            // active pointer gesture (feature 4)
};

const MARGINS = { l: 56, r: 14, t: 12, b: 30 };

const DARK = {
  bg: '#11161d', plot: '#0e131a',
  grid: '#1e2632', gridBold: '#2b3648',
  axis: '#8b98ab', text: '#aab6c6', title: '#d7dee9',
  user: '#4fc3f7', sol: '#c084fc', exact: '#fbbf24',
  zero: '#34d399', pole: '#f87171', cplx: '#7c5cff',
  hover: 'rgba(255,255,255,0.25)',
};

const els = {};
let magCtx = null, phCtx = null;
let magW = 0, magH = 0, phW = 0, phH = 0;

// ---------------------------------------------------------------------------
// undo / redo — snapshots of the drawing state (the user model only; view,
// selection and tool are UI state and intentionally not part of history)
// ---------------------------------------------------------------------------
const HIST_MAX = 200;
let hist = [], hIdx = -1;

function histSnap() {
  return JSON.stringify({ u: state.user, s: state.syncPlots });
}
function recordHistory() {
  const s = histSnap();
  if (hIdx >= 0 && hist[hIdx] === s) return false;
  hist.length = hIdx + 1;
  hist.push(s);
  if (hist.length > HIST_MAX) { hist.shift(); }
  hIdx = hist.length - 1;
  updateHistoryButtons();
  return true;
}
function resetHistory() {
  hist = [histSnap()];
  hIdx = 0;
  updateHistoryButtons();
}
function restoreHist(s) {
  const o = JSON.parse(s);
  state.user = o.u;
  state.syncPlots = o.s !== false;
  if (els.syncToggle) els.syncToggle.checked = state.syncPlots;
  if (state.selId != null && !state.user.elems.some(e => e.id === state.selId))
    state.selId = null;
  updateSidebar();
  render();
}
function undo() {
  if (hIdx <= 0) { setStatus('Nothing to undo'); return false; }
  hIdx--;
  restoreHist(hist[hIdx]);
  updateHistoryButtons();
  setStatus('Undid last change — <b>Ctrl+Z</b> steps further back · <b>Ctrl+Y</b> redoes');
  return true;
}
function redo() {
  if (hIdx >= hist.length - 1) { setStatus('Nothing to redo'); return false; }
  hIdx++;
  restoreHist(hist[hIdx]);
  updateHistoryButtons();
  setStatus('Redid last change — <b>Ctrl+Z</b> undoes again');
  return true;
}
function updateHistoryButtons() {
  if (els.btnUndo) els.btnUndo.disabled = hIdx <= 0;
  if (els.btnRedo) els.btnRedo.disabled = hIdx >= hist.length - 1;
}

// ---------------------------------------------------------------------------
// formatting helpers
// ---------------------------------------------------------------------------
const SUP = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
function supStr(n) { return String(n).split('').map(c => SUP[c] || c).join(''); }
function fmtDecade(k) {
  if (Number.isInteger(k) && Math.abs(k) <= 12) return '10' + supStr(k);
  const w = Math.pow(10, k);
  return fmtNum(w);
}
function fmtNum(v, sig) {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e5 || a < 1e-3) {
    const e = Math.floor(Math.log10(a));
    const m = v / Math.pow(10, e);
    const ms = (Math.abs(m - Math.round(m)) < 1e-9) ? String(Math.round(m)) : m.toFixed(1);
    return ms + 'e' + (e >= 0 ? '+' : '') + e;
  }
  return String(Number(v.toPrecision(sig || 4)));
}
function fmtW(w) { return fmtNum(w); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

// ---------------------------------------------------------------------------
// geometry / transforms
// ---------------------------------------------------------------------------
function geom(canvasW, canvasH) {
  return {
    l: MARGINS.l, r: canvasW - MARGINS.r,
    t: MARGINS.t, b: canvasH - MARGINS.b,
    w: canvasW - MARGINS.l - MARGINS.r,
    h: canvasH - MARGINS.t - MARGINS.b,
  };
}
function xToPx(xLog, g) { return g.l + (xLog - state.view.xmin) / (state.view.xmax - state.view.xmin) * g.w; }
function pxToX(px, g) { return state.view.xmin + (px - g.l) / g.w * (state.view.xmax - state.view.xmin); }
function yToPx(y, g, yr) { return g.t + (yr.max - y) / (yr.max - yr.min) * g.h; }
function pxToY(px, g, yr) { return yr.max - (px - g.t) / g.h * (yr.max - yr.min); }

// ---------------------------------------------------------------------------
// axis ticks
// ---------------------------------------------------------------------------
function yTickStep(span, isPhase) {
  const target = span / 6;
  const cands = isPhase
    ? [1, 2, 5, 10, 15, 30, 45, 90, 180, 360]
    : [1, 2, 5, 10, 20, 25, 50, 100, 200];
  for (const c of cands) if (c >= target) return c;
  return cands[cands.length - 1];
}
function niceYBounds(min, max, isPhase) {
  if (!isFinite(min) || !isFinite(max)) { min = -1; max = 1; }
  if (max - min < 1e-9) { min -= 1; max += 1; }
  const pad = (max - min) * 0.08;
  min -= pad; max += pad;
  const step = yTickStep(max - min, isPhase);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  return { min: lo, max: hi, step };
}

// ---------------------------------------------------------------------------
// canvas setup
// ---------------------------------------------------------------------------
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

  const step = yr.step || yTickStep(yr.max - yr.min, isPhase);
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
    for (const k of decs) {
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
  const labelStep = Math.max(1, Math.ceil(decs.length / 14));
  decs.forEach((k, i) => {
    if (i % labelStep !== 0) return;
    const x = xToPx(k, g);
    if (x < g.l - 1 || x > g.r + 1) return;
    ctx.fillText(fmtDecade(k), x, g.b + 7);
  });

  ctx.fillStyle = DARK.title;
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(opts.yUnit, g.l, 0);
  ctx.textAlign = 'right';
  ctx.fillText(opts.xUnit || 'ω [rad/s]', g.r, g.b + 7);

  return g;
}

// ---------------------------------------------------------------------------
// curve drawing
// ---------------------------------------------------------------------------
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

/** Raw-power ghost for `plot`: dotted preview shown only while hovering that plot.
 *  magnitude → the element's ±20 dB/dec (or ±40) slope from its corner;
 *  phase     → the element's phase ramp (0 → ±90°/±180° over corner±1 decade). */
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
    xc = hov.free ? hov.xLog : Math.round(hov.xLog / 0.05) * 0.05;
    const ex = u.elems.find(e =>
      e.type === type && e.kind === kind &&
      Math.abs(BM.cornerX(e) - xc) <= 0.025 &&
      elemOnPlot(e, plot));
    const order = ex ? ex.order + 1 : 1;
    elem = kind === 'complex'
      ? { type, kind: 'complex', wn: 1, zeta: 0.5, order }
      : { type, kind: 'real', w: 1, order };
  } else if (hov.shift && hov.elemId != null) {
    const e = u.elems.find(el => el.id === hov.elemId && elemOnPlot(el, plot));
    if (!e) return null;
    elem = e;
    xc = BM.cornerX(e);
  } else return null;

  const xmin = state.view.xmin, xmax = state.view.xmax;
  if (xc < xmin || xc > xmax) return null;

  if (plot === 'mag') {
    const y0 = BM.asymMag(u, xc);
    const slope = BM.magSlopeUnit(elem) * elem.order;
    return {
      xc,
      pts: [{ x: xc, y: y0 }, { x: xmax, y: y0 + slope * (xmax - xc) }],
    };
  }

  // phase: ramp from 0 at the corner − 1 decade to the total at corner + 1 decade,
  // starting from the current phase level where the ramp begins.
  const total = BM.phaseTotal(elem) * elem.order;
  const xa = xc - 1, xb = xc + 1;
  const y0 = BM.asymPhase(u, xa);
  const rampY = (x) => y0 + total * Math.min(1, Math.max(0, (x - xa) / 2));
  const xs = [Math.max(xmin, xa), xa, xb, xmax]
    .filter(x => x >= xmin && x <= xmax)
    .sort((a, b) => a - b);
  const uniq = [];
  for (const x of xs) if (!uniq.length || x - uniq[uniq.length - 1] > 1e-12) uniq.push(x);
  if (uniq.length < 2) return null;
  return { xc, pts: uniq.map(x => ({ x, y: rampY(x) })) };
}

function elemColor(e) { return e.type === 'zero' ? DARK.zero : DARK.pole; }
function elemLabel(e) {
  const kind = e.kind === 'complex' ? 'c.' : '';
  const type = e.type === 'zero' ? 'zero' : 'pole';
  return kind + type;
}

function markerPos(e, g, yr, plot) {
  const xc = BM.cornerX(e);
  const yv = plot === 'mag' ? BM.asymMag(state.user, xc) : BM.asymPhase(state.user, xc);
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
    // inner dot (double ring for order>1 shown via label anyway)
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

// ---------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------
function render() {
  if (!magCtx) return;
  const gy = drawAxes(magCtx, magW, magH, state.yMag, { yUnit: 'dB', isPhase: false });
  const gp = drawAxes(phCtx, phW, phH, state.yPh, { yUnit: 'deg', isPhase: true });

  drawCrosshair(magCtx, magW, magH, state.yMag, 'mag');
  drawCrosshair(phCtx, phW, phH, state.yPh, 'ph');

  // user asymptotes
  const mpts = BM.asymMagPoints(state.user, state.view.xmin, state.view.xmax);
  const ppts = BM.asymPhasePoints(state.user, state.view.xmin, state.view.xmax);
  drawPolyline(magCtx, mpts, gy, state.yMag, DARK.user, 2.2);
  drawPolyline(phCtx, ppts, gp, state.yPh, DARK.user, 2.2);

  // solution overlay: dashed asymptote, or the real Bode plot while Ctrl is held
  if (state.showSol && state.tf && state.tfState) {
    if (state.ctrlHeld) {
      const pts = BM.exactCurve(state.tf, state.view.xmin, state.view.xmax, 400,
        BM.asymPhase(state.tfState, state.view.xmin));
      drawPolyline(magCtx, pts.map(p => ({ x: p.x, y: p.db })), gy, state.yMag, DARK.exact, 1.8);
      drawPolyline(phCtx, pts.map(p => ({ x: p.x, y: p.ph })), gp, state.yPh, DARK.exact, 1.8);
    } else {
      const smp = BM.asymMagPoints(state.tfState, state.view.xmin, state.view.xmax);
      const spp = BM.asymPhasePoints(state.tfState, state.view.xmin, state.view.xmax);
      drawPolyline(magCtx, smp, gy, state.yMag, DARK.sol, 1.8, [6, 4]);
      drawPolyline(phCtx, spp, gp, state.yPh, DARK.sol, 1.8, [6, 4]);
    }
  }

  // raw-power ghost (dotted) — only on the plot currently being hovered
  const ghMag = ghostPoints('mag');
  if (ghMag) drawPolyline(magCtx, ghMag.pts, gy, state.yMag, 'rgba(255,255,255,0.55)', 1.4, [4, 4]);
  const ghPh = ghostPoints('ph');
  if (ghPh) drawPolyline(phCtx, ghPh.pts, gp, state.yPh, 'rgba(255,255,255,0.55)', 1.4, [4, 4]);

  drawMarkers(magCtx, magW, magH, state.yMag, 'mag');
  drawMarkers(phCtx, phW, phH, state.yPh, 'ph');
}

function resizeAll() {
  const m = fitCanvas(els.magCanvas);
  magCtx = m.ctx; magW = m.w; magH = m.h;
  const p = fitCanvas(els.phCanvas);
  phCtx = p.ctx; phW = p.w; phH = p.h;
  render();
}

// ---------------------------------------------------------------------------
// status bar
// ---------------------------------------------------------------------------
function setStatus(html) { els.status.innerHTML = html; }

// ---------------------------------------------------------------------------
// tools
// ---------------------------------------------------------------------------
const TOOL_HINTS = {
  select: 'Select — drag the <b>line</b> for gain · drag a <b>marker</b> for ω · background drag pans · wheel zooms ω',
  zero: 'Place <b>zero</b> — click a plot (snap 0.05 decade, <b>Ctrl</b> = free) · click again to raise order',
  pole: 'Place <b>pole</b> — click a plot (snap 0.05 decade, <b>Ctrl</b> = free) · click again to raise order',
  czero: 'Place <b>complex zero pair</b> (+40 dB/dec) — click a plot',
  cpole: 'Place <b>complex pole pair</b> (−40 dB/dec) — click a plot',
  delete: 'Delete — click a marker to remove it',
};

function setTool(tool) {
  state.tool = tool;
  document.querySelectorAll('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
  setStatus(TOOL_HINTS[tool] || tool);
  render();
}

// ---------------------------------------------------------------------------
// user model actions
// ---------------------------------------------------------------------------
/** Is this element drawn on `plot`? (missing `plots` = both, pre-sync format) */
function elemOnPlot(e, plot) {
  return !Array.isArray(e.plots) || e.plots.indexOf(plot) !== -1;
}

function placeAt(xLog, free, plot) {
  const t = state.tool;
  if (t !== 'zero' && t !== 'pole' && t !== 'czero' && t !== 'cpole') return null;
  plot = plot || 'mag';
  const type = (t === 'zero' || t === 'czero') ? 'zero' : 'pole';
  const kind = (t === 'zero' || t === 'pole') ? 'real' : 'complex';
  const snap = free ? xLog : Math.round(xLog / 0.05) * 0.05;
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
  recordHistory();
  updateSidebar();
  render();
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
      recordHistory();
      updateSidebar();
      render();
      return true;
    }
  }
  u.elems.splice(i, 1);
  if (state.selId === id) state.selId = null;
  setStatus('Removed <b>' + elemLabel(e) + '</b> at ω = <span class="val">' + fmtW(BM.freqOf(e)) + '</span>');
  recordHistory();
  updateSidebar();
  render();
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
  state.showSol = false;
  if (els.lgSolution) els.lgSolution.hidden = true;
  if (els.lgExact) els.lgExact.hidden = true;
  if (els.checkResults)
    els.checkResults.innerHTML = '<div class="empty-hint">Load a transfer function, draw your asymptote, then press <b>Show solution &amp; Check</b>.</div>';
  recordHistory();
  setStatus('Cleared your drawing (the loaded transfer function is kept)');
  updateSidebar();
  render();
}

// ---------------------------------------------------------------------------
// hit-testing
// ---------------------------------------------------------------------------
function hitElem(px, py, plot) {
  const g = plot === 'mag' ? geom(magW, magH) : geom(phW, phH);
  const yr = plot === 'mag' ? state.yMag : state.yPh;
  let best = null, bestD = 12;
  for (const e of state.user.elems) {
    if (!elemOnPlot(e, plot)) continue;
    const xc = BM.cornerX(e);
    if (xc < state.view.xmin || xc > state.view.xmax) continue;
    const yv = plot === 'mag' ? BM.asymMag(state.user, xc) : BM.asymPhase(state.user, xc);
    const ex = xToPx(xc, g), ey = yToPx(yv, g, yr);
    const d = Math.hypot(ex - px, ey - py);
    if (d <= bestD) { bestD = d; best = e; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// drag gestures (pan / gain line / marker) + drag tip
// ---------------------------------------------------------------------------
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
    const yStartVal = pxToY(d.startY, g, d.view0.yMag);
    const yNow = pxToY(info.py, g, d.view0.yMag);
    const gain = Math.round(clamp(d.gain0 + (yNow - yStartVal), -200, 200) * 10) / 10;
    state.user.gainDB = gain;
    updateGainUI();
    showDragTip(e,
      '20 lg|K| = <span class="val">' + fmtNum(gain) + '</span> dB · |K| = <span class="val">' +
      fmtNum(Math.pow(10, gain / 20)) + '</span>');
  } else if (d.mode === 'marker') {
    const el = state.user.elems.find(x => x.id === d.id);
    if (!el) return;
    const free = e.ctrlKey || e.metaKey;
    let xLog = free ? info.xLog : Math.round(info.xLog / 0.05) * 0.05;
    xLog = clamp(xLog, state.view.xmin, state.view.xmax);
    const w = Math.pow(10, xLog);
    if (el.kind === 'real') el.w = w; else el.wn = w;
    updateElemList();
    showDragTip(e,
      elemLabel(el) + ' → ω = <span class="val">' + fmtW(w) + '</span>' +
      (free ? ' <span class="val">free</span>' : ' <span class="val">snap 0.05</span>'));
  }
  render();
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
        setStatus('Moved <b>' + elemLabel(el) + '</b> to ω = <span class="val">' + fmtW(BM.freqOf(el)) + '</span>');
    }
    if (d.mode === 'line' || d.mode === 'marker') recordHistory();
    updateSidebar();
  }
  render();
}

// ---------------------------------------------------------------------------
// fit view
// ---------------------------------------------------------------------------
function fitView() {
  const xs = [];
  const collect = (st) => { if (st) for (const e of st.elems) xs.push(BM.cornerX(e)); };
  collect(state.user);
  if (state.tfState) collect(state.tfState);
  let xmin, xmax;
  if (xs.length) { xmin = Math.min.apply(null, xs); xmax = Math.max.apply(null, xs); }
  else { xmin = -1; xmax = 1; }
  if (xmax - xmin < 2) { const m = (xmin + xmax) / 2; xmin = m - 1; xmax = m + 1; }
  xmin -= 0.5; xmax += 0.5;
  state.view.xmin = xmin;
  state.view.xmax = xmax;

  let ymin = Infinity, ymax = -Infinity, pmin = Infinity, pmax = -Infinity;
  const consider = (st) => {
    if (!st) return;
    for (const p of BM.asymMagPoints(st, xmin, xmax)) {
      if (p.y < ymin) ymin = p.y;
      if (p.y > ymax) ymax = p.y;
    }
    for (const p of BM.asymPhasePoints(st, xmin, xmax)) {
      if (p.y < pmin) pmin = p.y;
      if (p.y > pmax) pmax = p.y;
    }
  };
  consider(state.user);
  if (state.showSol) consider(state.tfState);
  state.yMag = niceYBounds(isFinite(ymin) ? ymin : -40, isFinite(ymax) ? ymax : 40, false);
  state.yPh = niceYBounds(isFinite(pmin) ? pmin : -225, isFinite(pmax) ? pmax : 225, true);
  setStatus('Fitted view to ω <span class="val">' + fmtW(Math.pow(10, xmin)) + '</span> … <span class="val">' +
    fmtW(Math.pow(10, xmax)) + '</span> rad/s');
  render();
}

// ---------------------------------------------------------------------------
// pointer interaction
// ---------------------------------------------------------------------------
function canvasInfo(canvas, plot, e) {
  const rect = canvas.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  const g = plot === 'mag' ? geom(magW, magH) : geom(phW, phH);
  const yr = plot === 'mag' ? state.yMag : state.yPh;
  const xLog = pxToX(px, g);
  const yVal = pxToY(py, g, yr);
  const inPlot = px >= g.l && px <= g.r && py >= g.t && py <= g.b;
  return { px, py, xLog, yVal, inPlot, g, yr, plot };
}

function updateHover(canvas, plot, e) {
  const info = canvasInfo(canvas, plot, e);
  const hit = info.inPlot ? hitElem(info.px, info.py, plot) : null;
  state.hover = {
    plot, px: info.px, py: info.py, xLog: info.xLog, yVal: info.yVal,
    inPlot: info.inPlot, elemId: hit ? hit.id : null,
    shift: e.shiftKey, free: e.ctrlKey || e.metaKey,
  };
  if (info.inPlot) {
    const w = Math.pow(10, info.xLog);
    let extra = '';
    if (hit) extra = ' · hovered <b>' + elemLabel(hit) + '</b> at ω = <span class="val">' + fmtW(BM.freqOf(hit)) + '</span>';
    if (plot === 'mag')
      setStatus('ω = <span class="val">' + fmtW(w) + '</span> · <span class="val">' +
        fmtNum(info.yVal) + '</span> dB' + extra);
    else
      setStatus('ω = <span class="val">' + fmtW(w) + '</span> · <span class="val">' +
        fmtNum(info.yVal) + '</span>°' + extra);
  }
  render();
}

function bindCanvas(canvas, plot) {
  canvas.addEventListener('pointermove', (e) => {
    const info = canvasInfo(canvas, plot, e);
    if (state.drag && state.drag.pointerId === e.pointerId) {
      if (info.inPlot) onDragMove(info, e);
      return;
    }
    updateHover(canvas, plot, e);
  });
  canvas.addEventListener('pointerleave', () => {
    if (state.drag) return;
    state.hover = null;
    render();
  });
  canvas.addEventListener('pointerup', (e) => {
    if (state.drag && state.drag.pointerId === e.pointerId) endDrag();
  });
  canvas.addEventListener('pointercancel', () => endDrag());
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const info = canvasInfo(canvas, plot, e);
    if (!info.inPlot) return;
    const t = state.tool;

    if (t === 'zero' || t === 'pole' || t === 'czero' || t === 'cpole') {
      placeAt(info.xLog, e.ctrlKey || e.metaKey, plot);
      updateHover(canvas, plot, e);
      return;
    }
    if (t === 'delete') {
      const hitD = hitElem(info.px, info.py, plot);
      if (hitD) removeElem(hitD.id, plot);
      else setStatus('Nothing to delete there');
      updateHover(canvas, plot, e);
      return;
    }

    // select tool: click selects, then possibly start a drag gesture
    const hit = hitElem(info.px, info.py, plot);
    state.selId = hit ? hit.id : null;
    if (hit)
      setStatus('Selected <b>' + elemLabel(hit) + '</b> ×' + hit.order +
        ' at ω = <span class="val">' + fmtW(BM.freqOf(hit)) + '</span> — drag to move, <b>Del</b> to remove');
    else
      setStatus('Background — drag to pan, wheel to zoom ω');
    updateSidebar();

    let mode = 'pan';
    if (hit) mode = 'marker';
    else if (plot === 'mag') {
      const yAt = BM.asymMag(state.user, info.xLog);
      const yPx = yToPx(yAt, info.g, state.yMag);
      if (Math.abs(info.py - yPx) <= 7) mode = 'line';
    }
    state.drag = {
      mode, pointerId: e.pointerId, plot, canvas,
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
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ok */ }
    updateHover(canvas, plot, e);
  });
}

function bindWheel(canvas, plot) {
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const info = canvasInfo(canvas, plot, e);
    if (!info.inPlot) return;
    const span = state.view.xmax - state.view.xmin;
    if (span <= 0.5 && e.deltaY > 0) return;
    if (span >= 24 && e.deltaY < 0) return;
    const f = e.deltaY < 0 ? 1 / 1.12 : 1.12;
    const xc = clamp(info.xLog, state.view.xmin, state.view.xmax);
    const xmin = xc + (state.view.xmin - xc) * f;
    const xmax = xc + (state.view.xmax - xc) * f;
    if (xmax - xmin < 0.4 || xmax - xmin > 24) return;
    state.view.xmin = xmin;
    state.view.xmax = xmax;
    render();
    setStatus('Zoom ω <span class="val">' + fmtW(Math.pow(10, xmin)) + '</span> … <span class="val">' +
      fmtW(Math.pow(10, xmax)) + '</span> rad/s');
  }, { passive: false });
}

// ---------------------------------------------------------------------------
// load TF
// ---------------------------------------------------------------------------
function showMsg(el, text, show) {
  if (!el) return;
  if (show) { el.textContent = text; el.hidden = false; }
  else { el.hidden = true; el.textContent = ''; }
}

/** Raw combined expression from the numerator/denominator fields. */
function tfRawExpr() {
  const num = (els.numInput ? els.numInput.value : '').trim();
  const den = (els.denInput ? els.denInput.value : '').trim();
  if (!den) return num;
  return '(' + (num || '1') + ')/(' + den + ')';
}

function updateTfPreview() {
  if (!els.tfRender || !els.numInput || !els.denInput) return;
  els.tfRender.innerHTML = BM.texPreview(els.numInput.value, els.denInput.value);
}

function tfSummary(tf) {
  const parts = [];
  parts.push('K = ' + fmtNum(tf.gain));
  if (tf.z0) parts.push('s' + supStr(tf.z0));
  if (tf.p0) parts.push('1/s' + supStr(tf.p0));
  for (const z of tf.zeros)
    parts.push((z.kind === 'complex' ? 'zero pair' : 'zero') + '@' + fmtW(BM.freqOf(z)) + (z.order > 1 ? ' ×' + z.order : ''));
  for (const p of tf.poles)
    parts.push((p.kind === 'complex' ? 'pole pair' : 'pole') + '@' + fmtW(BM.freqOf(p)) + (p.order > 1 ? ' ×' + p.order : ''));
  return parts.join(' · ');
}

function loadTF() {
  const raw = tfRawExpr();
  try {
    const tf = BM.parseTransferFunction(raw);
    state.tf = tf;
    state.tfState = BM.stateFromTF(tf);
    state.showSol = false;
    state.ctrlHeld = false;
    if (els.lgSolution) els.lgSolution.hidden = true;
    if (els.lgExact) els.lgExact.hidden = true;
    if (els.checkResults)
      els.checkResults.innerHTML = '<div class="empty-hint">Load a transfer function, draw your asymptote, then press <b>Show solution &amp; Check</b>.</div>';
    showMsg(els.tfOk, 'G(s) loaded — ' + tfSummary(tf), true);
    showMsg(els.tfError, '', false);
    setStatus('Transfer function loaded — place poles &amp; zeros to match its Bode plot, then <b>Show solution &amp; Check</b>');
    return tf;
  } catch (err) {
    state.tf = null;
    state.tfState = null;
    showMsg(els.tfError, 'G(s) error: ' + err.message, true);
    showMsg(els.tfOk, '', false);
    setStatus('Could not parse the transfer function');
    return null;
  }
}

// ---------------------------------------------------------------------------
// sidebar
// ---------------------------------------------------------------------------
function updateOriginCounts() {
  els.z0Count.textContent = String(state.user.z0);
  els.p0Count.textContent = String(state.user.p0);
  els.z0Count.classList.toggle('nonzero', state.user.z0 !== 0);
  els.p0Count.classList.toggle('nonzero', state.user.p0 !== 0);
}

function updateGainUI() {
  els.gainInput.value = String(Number(state.user.gainDB.toFixed(2)));
  els.gainSignBtn.textContent = state.user.gainSign < 0 ? 'K: −' : 'K: +';
  els.gainSignBtn.classList.toggle('neg', state.user.gainSign < 0);
  els.gainLin.textContent = fmtNum(Math.pow(10, state.user.gainDB / 20));
}

function badgeClass(e) {
  if (e.kind === 'complex') return e.type === 'zero' ? 'czero' : 'cpole';
  return e.type;
}

function updateElemList() {
  const list = els.elemList;
  const u = state.user;
  if (!u.elems.length) {
    list.innerHTML = '<div class="empty-hint">Nothing placed yet — pick a Zero/Pole tool and click on a plot.</div>';
    return;
  }
  list.innerHTML = '';
  const sorted = u.elems.slice().sort((a, b) => BM.cornerX(a) - BM.cornerX(b));
  for (const e of sorted) {
    const row = document.createElement('div');
    row.className = 'elem-row' + (e.id === state.selId ? ' selected' : '');
    row.dataset.id = String(e.id);

    const badge = document.createElement('span');
    badge.className = 'elem-badge ' + badgeClass(e);

    const type = document.createElement('span');
    type.className = 'elem-type';
    type.textContent = (e.kind === 'complex' ? 'c.' : '') + (e.type === 'zero' ? 'zero' : 'pole');
    if (Array.isArray(e.plots) && e.plots.length < 2) {
      const only = e.plots[0];
      const tag = document.createElement('span');
      tag.className = 'plot-tag ' + (only === 'mag' ? 'mag' : 'ph');
      tag.textContent = only === 'mag' ? 'mag' : 'φ';
      tag.title = 'Only on the ' + (only === 'mag' ? 'magnitude' : 'phase') + ' graph';
      type.appendChild(tag);
      row.title = 'Drawn on the ' + (only === 'mag' ? 'magnitude' : 'phase') + ' graph only';
    }

    const wInput = document.createElement('input');
    wInput.className = 'elem-w';
    wInput.type = 'text';
    wInput.spellcheck = false;
    wInput.value = fmtW(BM.freqOf(e));
    wInput.title = 'Corner frequency ω [rad/s]';
    wInput.addEventListener('change', () => {
      const v = parseFloat(wInput.value);
      if (!isFinite(v) || v <= 0) { wInput.value = fmtW(BM.freqOf(e)); return; }
      if (e.kind === 'real') e.w = v; else e.wn = v;
      setStatus('Moved <b>' + elemLabel(e) + '</b> to ω = <span class="val">' + fmtW(v) + '</span>');
      recordHistory();
      updateElemList();
      render();
    });
    wInput.addEventListener('pointerdown', ev => ev.stopPropagation());

    const order = document.createElement('span');
    order.className = 'order-ctl';
    const dec = document.createElement('button');
    dec.className = 'mini'; dec.type = 'button'; dec.textContent = '−';
    dec.title = 'Lower order (removes when ×1)';
    dec.addEventListener('click', ev => {
      ev.stopPropagation();
      if (e.order > 1) { e.order--; setStatus(elemLabel(e) + ' order ×' + e.order); }
      else { removeElem(e.id); return; }
      recordHistory();
      updateElemList(); render();
    });
    const n = document.createElement('span');
    n.className = 'order-n'; n.textContent = '×' + e.order;
    const inc = document.createElement('button');
    inc.className = 'mini'; inc.type = 'button'; inc.textContent = '+';
    inc.title = 'Raise order';
    inc.addEventListener('click', ev => {
      ev.stopPropagation();
      e.order++;
      setStatus(elemLabel(e) + ' order ×' + e.order + ' · slope ' +
        (BM.magSlopeUnit(e) * e.order > 0 ? '+' : '−') + Math.abs(BM.magSlopeUnit(e) * e.order) + ' dB/dec');
      recordHistory();
      updateElemList(); render();
    });
    order.append(dec, n, inc);

    const del = document.createElement('button');
    del.className = 'elem-del'; del.type = 'button'; del.textContent = '✕';
    del.title = 'Remove';
    del.addEventListener('click', ev => { ev.stopPropagation(); removeElem(e.id); });

    row.append(badge, type, wInput, order, del);
    row.addEventListener('click', () => {
      state.selId = e.id;
      setStatus('Selected <b>' + elemLabel(e) + '</b> at ω = <span class="val">' + fmtW(BM.freqOf(e)) + '</span>');
      updateElemList();
      render();
    });
    list.appendChild(row);
  }
}

function updateSidebar() {
  updateOriginCounts();
  updateGainUI();
  updateElemList();
}

// ---------------------------------------------------------------------------
// solution overlay + check
// ---------------------------------------------------------------------------
function updateLegend() {
  if (els.lgSolution) els.lgSolution.hidden = !(state.showSol && !state.ctrlHeld);
  if (els.lgExact) els.lgExact.hidden = !(state.showSol && state.ctrlHeld);
}

function setCtrlHeld(v) {
  if (state.ctrlHeld === v) return;
  state.ctrlHeld = v;
  updateLegend();
  if (state.showSol) {
    setStatus(v
      ? 'Real Bode plot (exact G(jω)) — release <b>Ctrl</b> for the asymptotic solution'
      : 'Asymptotic solution shown — hold <b>Ctrl</b> for the real Bode plot');
    render();
  }
}

function renderCheck(res) {
  const box = els.checkResults;
  box.innerHTML = '';
  const allOk = res.score.ok === res.score.total;
  const score = document.createElement('div');
  score.className = 'check-score ' + (allOk ? 'good' : 'bad');
  score.textContent = res.score.ok + ' / ' + res.score.total + ' correct' + (allOk ? ' — perfect!' : '');
  box.appendChild(score);
  for (const it of res.items) {
    const row = document.createElement('div');
    row.className = 'check-item ' + (it.ok ? 'ok' : 'fail');
    const mark = document.createElement('span');
    mark.className = 'mark';
    mark.textContent = it.ok ? '✓' : '✗';
    const txt = document.createElement('span');
    txt.textContent = it.text;
    row.append(mark, txt);
    box.appendChild(row);
  }
  const hint = document.createElement('div');
  hint.className = 'ctrl-hint';
  hint.innerHTML = 'hold <kbd>Ctrl</kbd> to see the real Bode plot';
  box.appendChild(hint);
}

function showSolutionAndCheck() {
  if (!state.tf) {
    setStatus('Load a transfer function first — enter the numerator &amp; denominator in the sidebar and press <b>Load</b>');
    return;
  }
  const res = BM.checkSolution(state.tf, state.user);
  state.showSol = true;
  renderCheck(res);
  updateLegend();
  setStatus('Solution shown — score <b>' + res.score.ok + '/' + res.score.total + '</b>' +
    (res.score.ok === res.score.total ? ' — perfect!' : '') +
    ' · hold <b>Ctrl</b> for the real Bode plot · <b>F</b> fits the view');
  render();
  return res;
}

// ---------------------------------------------------------------------------
// export: composed PNG (header + mag + phase) — download or clipboard (AFFiNE)
// ---------------------------------------------------------------------------
function composeExport() {
  const dpr = window.devicePixelRatio || 1;
  const pad = Math.round(14 * dpr);
  const gap = Math.round(10 * dpr);
  const headH = Math.round(46 * dpr);
  const mw = els.magCanvas.width, mh = els.magCanvas.height;
  const pw = els.phCanvas.width, ph = els.phCanvas.height;
  const w = Math.max(mw, pw);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = headH + mh + gap + ph + pad;
  const c = out.getContext('2d');

  c.fillStyle = '#11161d';
  c.fillRect(0, 0, out.width, out.height);

  // header
  c.textBaseline = 'middle';
  c.textAlign = 'left';
  c.fillStyle = '#4fc3f7';
  c.font = '700 ' + Math.round(16 * dpr) + 'px system-ui, sans-serif';
  c.fillText('asymbode', pad, headH * 0.42);
  const brandW = c.measureText('asymbode').width;
  c.fillStyle = '#d7dee9';
  c.font = Math.round(13 * dpr) + 'px ui-monospace, monospace';
  const expr = 'G(s) = ' + (tfRawExpr() || '—');
  c.fillText(expr, pad + brandW + 16 * dpr, headH * 0.42);
  c.fillStyle = '#8b98ab';
  c.font = Math.round(11 * dpr) + 'px system-ui, sans-serif';
  c.textAlign = 'right';
  c.fillText(new Date().toISOString().slice(0, 10), w - pad, headH * 0.42);
  c.textAlign = 'left';
  c.strokeStyle = '#263042';
  c.lineWidth = Math.max(1, dpr);
  c.beginPath();
  c.moveTo(pad, headH - 6 * dpr);
  c.lineTo(w - pad, headH - 6 * dpr);
  c.stroke();

  c.drawImage(els.magCanvas, 0, headH, mw, mh);
  c.drawImage(els.phCanvas, 0, headH + mh + gap, pw, ph);

  c.strokeStyle = '#263042';
  c.strokeRect(0.5, 0.5, out.width - 1, out.height - 1);
  return out;
}

function exportPng() {
  const out = composeExport();
  out.toBlob((blob) => {
    if (!blob) { setStatus('PNG export failed'); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bode-diagram-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    setStatus('Downloaded <b>' + a.download + '</b>');
  }, 'image/png');
}

function copyImage() {
  const doCopy = async () => {
    const out = composeExport();
    const blob = await new Promise((resolve, reject) =>
      out.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png'));
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined')
      throw new Error('clipboard images unsupported here');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    setStatus('Image copied to clipboard — paste straight into AFFiNE (Ctrl/Cmd+V)');
  };
  doCopy().catch(err => {
    setStatus('Copy failed (' + err.message + ') — use <b>Export PNG</b> instead');
  });
}

// ---------------------------------------------------------------------------
// keyboard
// ---------------------------------------------------------------------------
function onKeyDown(e) {
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
  if (e.key === 'Control') { setCtrlHeld(true); return; }
  if (e.ctrlKey || e.metaKey) {
    const k = e.key.toLowerCase();
    if (k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (k === 'y') { e.preventDefault(); redo(); }
    return;
  }
  const k = e.key.toLowerCase();
  if (k === 'v') setTool('select');
  else if (k === 'z') setTool('zero');
  else if (k === 'p') setTool('pole');
  else if (k === 'c') setTool('czero');
  else if (k === 'x') setTool('cpole');
  else if (k === 'd') setTool('delete');
  else if (k === 'escape') setTool('select');
  else if (k === 'delete' || k === 'backspace') { e.preventDefault(); removeSelected(); }
  else if (k === 'f') fitView();
  else return;
}

function onKeyUp(e) {
  if (e.key === 'Control') setCtrlHeld(false);
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------
function init() {
  els.magCanvas = document.getElementById('magCanvas');
  els.phCanvas = document.getElementById('phCanvas');
  els.status = document.getElementById('status');
  els.numInput = document.getElementById('numInput');
  els.denInput = document.getElementById('denInput');
  els.tfRender = document.getElementById('tfRender');
  els.tfError = document.getElementById('tfError');
  els.tfOk = document.getElementById('tfOk');
  els.elemList = document.getElementById('elemList');
  els.z0Count = document.getElementById('z0Count');
  els.p0Count = document.getElementById('p0Count');
  els.gainInput = document.getElementById('gainInput');
  els.gainSignBtn = document.getElementById('gainSignBtn');
  els.gainLin = document.getElementById('gainLin');
  els.lgSolution = document.getElementById('lgSolution');
  els.lgExact = document.getElementById('lgExact');
  els.checkResults = document.getElementById('checkResults');
  els.dragTip = document.getElementById('dragTip');
  els.plots = document.querySelector('.plots');
  els.btnUndo = document.getElementById('btnUndo');
  els.btnRedo = document.getElementById('btnRedo');
  els.syncToggle = document.getElementById('syncToggle');

  document.querySelectorAll('.tool').forEach(btn => {
    btn.addEventListener('click', () => setTool(btn.dataset.tool));
  });

  document.getElementById('btnLoad').addEventListener('click', loadTF);
  for (const inp of [els.numInput, els.denInput]) {
    inp.addEventListener('input', updateTfPreview);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadTF(); });
  }
  updateTfPreview();

  document.getElementById('btnClear').addEventListener('click', clearUser);
  document.getElementById('btnFit').addEventListener('click', fitView);
  document.getElementById('btnCheck').addEventListener('click', showSolutionAndCheck);
  document.getElementById('btnExportPng').addEventListener('click', exportPng);
  document.getElementById('btnCopyImg').addEventListener('click', copyImage);

  document.getElementById('z0Plus').addEventListener('click', () => {
    state.user.z0 = clamp(state.user.z0 + 1, 0, 8);
    setStatus('Zeros at origin: s' + supStr(state.user.z0) + ' → initial slope +' + (20 * state.user.z0) + ' dB/dec');
    recordHistory(); updateSidebar(); render();
  });
  document.getElementById('z0Minus').addEventListener('click', () => {
    state.user.z0 = clamp(state.user.z0 - 1, 0, 8);
    setStatus('Zeros at origin: s' + supStr(state.user.z0));
    recordHistory(); updateSidebar(); render();
  });
  document.getElementById('p0Plus').addEventListener('click', () => {
    state.user.p0 = clamp(state.user.p0 + 1, 0, 8);
    setStatus('Poles at origin: 1/s' + supStr(state.user.p0) + ' → initial slope −' + (20 * state.user.p0) + ' dB/dec');
    recordHistory(); updateSidebar(); render();
  });
  document.getElementById('p0Minus').addEventListener('click', () => {
    state.user.p0 = clamp(state.user.p0 - 1, 0, 8);
    setStatus('Poles at origin: 1/s' + supStr(state.user.p0));
    recordHistory(); updateSidebar(); render();
  });

  els.gainInput.addEventListener('input', () => {
    const v = parseFloat(els.gainInput.value);
    if (isFinite(v)) {
      state.user.gainDB = clamp(v, -200, 200);
      els.gainLin.textContent = fmtNum(Math.pow(10, state.user.gainDB / 20));
      render();
    }
  });
  els.gainInput.addEventListener('change', () => {
    recordHistory();
    setStatus('Gain 20 lg|K| = <span class="val">' + fmtNum(state.user.gainDB) + '</span> dB · |K| = <span class="val">' +
      fmtNum(Math.pow(10, state.user.gainDB / 20)) + '</span>');
  });
  els.gainSignBtn.addEventListener('click', () => {
    state.user.gainSign = state.user.gainSign < 0 ? 1 : -1;
    recordHistory();
    updateGainUI();
    setStatus('Sign of K: <b>' + (state.user.gainSign < 0 ? '− (phase +180°)' : '+') + '</b>');
    render();
  });

  els.btnUndo.addEventListener('click', undo);
  els.btnRedo.addEventListener('click', redo);

  if (els.syncToggle) {
    els.syncToggle.checked = state.syncPlots;
    els.syncToggle.addEventListener('change', () => {
      state.syncPlots = els.syncToggle.checked;
      if (state.syncPlots) {
        for (const e of state.user.elems) e.plots = ['mag', 'ph'];
        setStatus('Mirror edits <b>on</b> — poles/zeros now appear on both graphs at once');
      } else {
        setStatus('Mirror edits <b>off</b> — new poles/zeros stay on the graph you place them on');
      }
      recordHistory();
      updateSidebar();
      render();
    });
  }

  bindCanvas(els.magCanvas, 'mag');
  bindCanvas(els.phCanvas, 'ph');
  bindWheel(els.magCanvas, 'mag');
  bindWheel(els.phCanvas, 'ph');
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => setCtrlHeld(false));

  const ro = new ResizeObserver(() => resizeAll());
  ro.observe(els.magCanvas.parentElement);
  ro.observe(els.phCanvas.parentElement);
  resizeAll();
  updateSidebar();
  setTool('select');
  resetHistory();
}

window.__bode = {
  state, setTool, render, resizeAll, setStatus,
  loadTF, placeAt, removeElem, clearUser, updateSidebar, fitView,
  showSolutionAndCheck, setCtrlHeld, updateLegend,
  composeExport, exportPng, copyImage, ghostPoints,
  undo, redo, recordHistory, resetHistory,
  updateTfPreview, tfRawExpr, elemOnPlot,
  helpers: { geom, xToPx, pxToX, yToPx, pxToY, fmtNum, fmtDecade, supStr, niceYBounds, clamp, hitElem },
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

})();
