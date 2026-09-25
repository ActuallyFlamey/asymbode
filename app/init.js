/* asymbode — wiring: cache DOM nodes, bind controls, start the app. */
(function (A) {
'use strict';

const state = A.state;
const els = A.els;
const { fmtNum, supStr, clamp, setStatus } = A;

function init() {
    els.magCanvas = document.getElementById('magCanvas');
    els.phCanvas = document.getElementById('phCanvas');
    els.status = document.getElementById('status');
    els.kInput = document.getElementById('kInput');
    els.numInput = document.getElementById('numInput');
    els.denInput = document.getElementById('denInput');
    els.tfRender = document.getElementById('tfRender');
    els.tfError = document.getElementById('tfError');
    els.elemList = document.getElementById('elemList');
    els.z0Count = document.getElementById('z0Count');
    els.p0Count = document.getElementById('p0Count');
    els.gainInput = document.getElementById('gainInput');
    els.gainSignBtn = document.getElementById('gainSignBtn');
    els.gainLin = document.getElementById('gainLin');
    els.lgSolution = document.getElementById('lgSolution');
    els.lgExact = document.getElementById('lgExact');
    els.lgUser = document.getElementById('lgUser');
    els.checkResults = document.getElementById('checkResults');
    els.dragTip = document.getElementById('dragTip');
    els.plots = document.querySelector('.plots');
    els.btnUndo = document.getElementById('btnUndo');
    els.btnRedo = document.getElementById('btnRedo');
    els.syncToggle = document.getElementById('syncToggle');

    // tools
    document.querySelectorAll('.tool').forEach(btn => {
        btn.addEventListener('click', () => A.setTool(btn.dataset.tool));
    });

    // transfer function fields
    for (const inp of [els.kInput, els.numInput, els.denInput]) {
        inp.addEventListener('input', A.updateTfPreview);
        inp.addEventListener('blur', A.loadTF);
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') A.loadTF(); });
    }
    A.updateTfPreview();
    A.loadTF();

    // toolbar buttons
    document.getElementById('btnClear').addEventListener('click', A.clearUser);
    document.getElementById('btnFit').addEventListener('click', A.fitView);
    document.getElementById('btnCheck').addEventListener('click', A.showSolutionAndCheck);
    document.getElementById('btnExportPng').addEventListener('click', A.exportPng);
    document.getElementById('btnCopyImg').addEventListener('click', A.copyImage);
    els.btnUndo.addEventListener('click', A.undo);
    els.btnRedo.addEventListener('click', A.redo);

    // poles/zeroes at the origin
    document.getElementById('z0Plus').addEventListener('click', () => {
        state.user.z0 = clamp(state.user.z0 + 1, 0, 8);
        setStatus('Zeroes at origin: s' + supStr(state.user.z0) + ' → initial slope +' + (20 * state.user.z0) + ' dB/dec');
        A.recordHistory(); A.updateSidebar(); A.render();
    });
    document.getElementById('z0Minus').addEventListener('click', () => {
        state.user.z0 = clamp(state.user.z0 - 1, 0, 8);
        setStatus('Zeroes at origin: s' + supStr(state.user.z0));
        A.recordHistory(); A.updateSidebar(); A.render();
    });
    document.getElementById('p0Plus').addEventListener('click', () => {
        state.user.p0 = clamp(state.user.p0 + 1, 0, 8);
        setStatus('Poles at origin: 1/s' + supStr(state.user.p0) + ' → initial slope −' + (20 * state.user.p0) + ' dB/dec');
        A.recordHistory(); A.updateSidebar(); A.render();
    });
    document.getElementById('p0Minus').addEventListener('click', () => {
        state.user.p0 = clamp(state.user.p0 - 1, 0, 8);
        setStatus('Poles at origin: 1/s' + supStr(state.user.p0));
        A.recordHistory(); A.updateSidebar(); A.render();
    });

    // gain
    els.gainInput.addEventListener('input', () => {
        const v = parseFloat(els.gainInput.value);
        if (isFinite(v)) {
            state.user.gainDB = clamp(v, -200, 200);
            els.gainLin.textContent = fmtNum(Math.pow(10, state.user.gainDB / 20));
            A.render();
        }
    });
    els.gainInput.addEventListener('change', () => {
        A.recordHistory();
        setStatus('Gain 20 lg|K| = <span class="val">' + fmtNum(state.user.gainDB) + '</span> dB · |K| = <span class="val">' +
            fmtNum(Math.pow(10, state.user.gainDB / 20)) + '</span>');
    });
    els.gainSignBtn.addEventListener('click', () => {
        state.user.gainSign = state.user.gainSign < 0 ? 1 : -1;
        A.recordHistory();
        A.updateGainUI();
        setStatus('Sign of K: <b>' + (state.user.gainSign < 0 ? '− (phase +180°)' : '+') + '</b>');
        A.render();
    });

    // mirror-edits toggle
    if (els.syncToggle) {
        els.syncToggle.checked = state.syncPlots;
        els.syncToggle.addEventListener('change', () => {
            state.syncPlots = els.syncToggle.checked;
            if (state.syncPlots) {
                for (const e of state.user.elems) e.plots = ['mag', 'ph'];
                setStatus('Mirror edits <b>on</b> — poles/zeroes now appear on both graphs at once');
            } else {
                setStatus('Mirror edits <b>off</b> — new poles/zeroes stay on the graph you place them on');
            }
            A.recordHistory();
            A.updateSidebar();
            A.render();
        });
    }

    // plots
    A.bindCanvas(els.magCanvas, 'mag');
    A.bindCanvas(els.phCanvas, 'ph');
    A.bindWheel(els.magCanvas, 'mag');
    A.bindWheel(els.phCanvas, 'ph');

    // keyboard
    document.addEventListener('keydown', A.onKeyDown);
    document.addEventListener('keyup', A.onKeyUp);
    window.addEventListener('blur', () => A.setCtrlHeld(false));

    // keep both canvases sized to their wrappers
    const ro = new ResizeObserver(() => A.resizeAll());
    ro.observe(els.magCanvas.parentElement);
    ro.observe(els.phCanvas.parentElement);
    A.resizeAll();
    A.updateSidebar();
    A.setTool('select');
    A.resetHistory();
}

/** Debug/testing handle (also handy from the browser console). */
window.__bode = {
    state, setTool: A.setTool, render: A.render, resizeAll: A.resizeAll, setStatus,
    loadTF: A.loadTF, placeAt: A.placeAt, removeElem: A.removeElem, clearUser: A.clearUser,
    updateSidebar: A.updateSidebar, fitView: A.fitView,
    showSolutionAndCheck: A.showSolutionAndCheck, setCtrlHeld: A.setCtrlHeld,
    updateLegend: A.updateLegend,
    composeExport: A.composeExport, exportPng: A.exportPng, copyImage: A.copyImage,
    ghostPoints: A.ghostPoints,
    undo: A.undo, redo: A.redo, recordHistory: A.recordHistory, resetHistory: A.resetHistory,
    updateTfPreview: A.updateTfPreview, tfRawExpr: A.tfRawExpr, elemOnPlot: A.elemOnPlot,
    helpers: {
        geom: A.geom, xToPx: A.xToPx, pxToX: A.pxToX, yToPx: A.yToPx, pxToY: A.pxToY,
        fmtNum, fmtDecade: A.fmtDecade, supStr, niceYBounds: A.niceYBounds, clamp,
        hitElem: A.hitElem, snapX: A.snapX,
    },
};

A.init = init;

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

})(globalThis.BodeApp = globalThis.BodeApp || {});
