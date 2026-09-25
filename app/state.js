/* asymbode — shared application state, colour palette and DOM element handles.
 *
 * Every other app module reads these through the BodeApp namespace:
 *     const state = A.state;
 * This file must load first. */
(function (A) {
'use strict';

A.state = {
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
    drag: null,                            // active pointer gesture
};

A.MARGINS = { l: 56, r: 14, t: 12, b: 30 };

A.DARK = {
    bg: '#11161d', plot: '#0e131a',
    grid: '#1e2632', gridBold: '#2b3648',
    axis: '#8b98ab', text: '#aab6c6', title: '#d7dee9',
    user: '#4fc3f7', sol: '#c084fc', exact: '#fbbf24',
    zero: '#34d399', pole: '#f87171', cplx: '#7c5cff',
    hover: 'rgba(255,255,255,0.25)',
};

/** Cached DOM nodes, filled in by init(). */
A.els = {};

/** Canvas contexts and their CSS-pixel sizes. */
A.canvas = { magCtx: null, phCtx: null, magW: 0, magH: 0, phW: 0, phH: 0 };

})(globalThis.BodeApp = globalThis.BodeApp || {});
