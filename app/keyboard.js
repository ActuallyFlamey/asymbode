/* asymbode — tool switching and keyboard shortcuts. */
(function (A) {
'use strict';

const state = A.state;
const { setStatus } = A;

const TOOL_HINTS = {
    select: 'Select — drag the <b>line</b> for gain · drag a <b>marker</b> for ω · background drag pans · wheel zooms ω · scroll on an axis to scale it',
    zero: 'Place <b>zero</b> — click a plot (snaps to a grid line, else 0.05 decade · <b>Ctrl</b> = free) · click again to raise order',
    pole: 'Place <b>pole</b> — click a plot (snaps to a grid line, else 0.05 decade · <b>Ctrl</b> = free) · click again to raise order',
    czero: 'Place <b>complex zero pair</b> (+40 dB/dec) — click a plot',
    cpole: 'Place <b>complex pole pair</b> (−40 dB/dec) — click a plot',
    delete: 'Delete — click a marker to remove it',
};

function setTool(tool) {
    state.tool = tool;
    document.querySelectorAll('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
    setStatus(TOOL_HINTS[tool] || tool);
    A.render();
}

function onKeyDown(e) {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
    if (e.key === 'Control') { A.setCtrlHeld(true); return; }
    if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === 'z') { e.preventDefault(); if (e.shiftKey) A.redo(); else A.undo(); }
        else if (k === 'y') { e.preventDefault(); A.redo(); }
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
    else if (k === 'delete' || k === 'backspace') { e.preventDefault(); A.removeSelected(); }
    else if (k === 'f') A.fitView();
    else return;
}

function onKeyUp(e) {
    if (e.key === 'Control') A.setCtrlHeld(false);
}

A.TOOL_HINTS = TOOL_HINTS;
A.setTool = setTool;
A.onKeyDown = onKeyDown;
A.onKeyUp = onKeyUp;

})(globalThis.BodeApp = globalThis.BodeApp || {});
