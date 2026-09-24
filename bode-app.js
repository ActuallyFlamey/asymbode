/* asymbode — app shell: layout, log axes, grid rendering */
(function () {
'use strict';

// ---------------------------------------------------------------------------
// state (extended by later features)
// ---------------------------------------------------------------------------
const state = {
  view: { xmin: -3, xmax: 3 },          // log10(omega) window
  yMag: { min: -40, max: 40 },
  yPh: { min: -225, max: 225 },
  tool: 'select',
  hover: null,                           // {xLog, plot:'mag'|'ph'}
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

  // plot background
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

  // minor vertical (2..9 per decade)
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

  // major vertical (decades)
  ctx.strokeStyle = DARK.gridBold;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const k of decs) {
    const x = xToPx(k, g);
    if (x >= g.l - .5 && x <= g.r + .5) { ctx.moveTo(x + .5, g.t); ctx.lineTo(x + .5, g.b); }
  }
  ctx.stroke();

  // horizontal grid
  ctx.strokeStyle = DARK.grid;
  ctx.beginPath();
  for (let y = Math.ceil(yr.min / step) * step; y <= yr.max + 1e-9; y += step) {
    const py = Math.round(yToPx(y, g, yr)) + .5;
    ctx.moveTo(g.l, py); ctx.lineTo(g.r, py);
  }
  ctx.stroke();

  ctx.restore();

  // frame
  ctx.strokeStyle = DARK.gridBold;
  ctx.lineWidth = 1;
  ctx.strokeRect(g.l + .5, g.t + .5, g.w - 1, g.h - 1);

  // y labels
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

  // x labels (decades)
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const labelStep = Math.max(1, Math.ceil(decs.length / 14));
  decs.forEach((k, i) => {
    if (i % labelStep !== 0) return;
    const x = xToPx(k, g);
    if (x < g.l - 1 || x > g.r + 1) return;
    ctx.fillText(fmtDecade(k), x, g.b + 7);
  });

  // axis titles
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
// render
// ---------------------------------------------------------------------------
function render() {
  if (!magCtx) return;
  const gy = drawAxes(magCtx, magW, magH, state.yMag, { yUnit: 'dB', isPhase: false });
  const gp = drawAxes(phCtx, phW, phH, state.yPh, { yUnit: 'deg', isPhase: true });
  void gy; void gp;
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
// tools UI
// ---------------------------------------------------------------------------
function setTool(tool) {
  state.tool = tool;
  document.querySelectorAll('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------
function init() {
  els.magCanvas = document.getElementById('magCanvas');
  els.phCanvas = document.getElementById('phCanvas');
  els.status = document.getElementById('status');

  document.querySelectorAll('.tool').forEach(btn => {
    btn.addEventListener('click', () => setTool(btn.dataset.tool));
  });

  const ro = new ResizeObserver(() => resizeAll());
  ro.observe(els.magCanvas.parentElement);
  ro.observe(els.phCanvas.parentElement);
  resizeAll();

  setStatus('Ready — load a transfer function, place poles &amp; zeros, then check your work.');
}

window.__bode = { state, setTool, render, resizeAll, setStatus, helpers: { geom, xToPx, pxToX, yToPx, pxToY, fmtNum, fmtDecade, supStr, niceYBounds, clamp } };

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

})();
