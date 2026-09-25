/* asymbode-app — self-tests for the view/zoom layer (run with `node selftest.js`,
 * or BodeApp.selfTest() from a console).
 *
 * Loads last: everything below is destructured from the shared namespace. */
(function (A) {
'use strict';

const state = A.state;
const { geom, xToPx, pxToX, yToPx, pxToY, wheelTarget, wheelFactor, scaleX, scaleY } = A;

function selfTest() {
    const failures = [];
    let passed = 0;
    function ok(cond, name, detail) {
        if (cond) { passed++; }
        else failures.push(name + (detail ? ' — ' + detail : ''));
    }
    function near(a, b, tol, name, detail) {
        const d = Math.abs(a - b);
        ok(d <= tol, name, 'got ' + a + ', expected ' + b + (detail ? ' (' + detail + ')' : ''));
    }

    const g = geom(600, 400);   // l=56 r=586 t=12 b=370

    // ---- pixel ↔ data transforms (everything below builds on them) ----
    near(pxToX(xToPx(1.25, g), g), 1.25, 1e-9, 'x transforms round-trip');
    near(pxToY(yToPx(-13, g, state.yMag), g, state.yMag), -13, 1e-9, 'y transforms round-trip');

    // ---- which control a wheel event hits ----
    ok(wheelTarget(300, 200, g) === 'view', 'wheelTarget: plot centre → view');
    ok(wheelTarget(g.l, g.t, g) === 'view', 'wheelTarget: plot top-left corner → view');
    ok(wheelTarget(g.r, g.b, g) === 'view', 'wheelTarget: plot bottom-right corner → view');
    ok(wheelTarget(g.l - 1, 200, g) === 'y', 'wheelTarget: left margin → y');
    ok(wheelTarget(g.r + 1, 200, g) === 'y', 'wheelTarget: right margin → y');
    ok(wheelTarget(300, g.b + 1, g) === 'x', 'wheelTarget: bottom margin → x');
    ok(wheelTarget(300, g.t - 1, g) === 'x', 'wheelTarget: top margin → x');
    ok(wheelTarget(10, 390, g) === 'y', 'wheelTarget: bottom-left corner → y');
    ok(wheelTarget(595, 5, g) === 'y', 'wheelTarget: top-right corner → y');
    ok(wheelTarget(300, 399, g) === 'x', 'wheelTarget: under the ω labels → x');

    // ---- one wheel notch ----
    near(wheelFactor(-100), 1 / 1.12, 1e-12, 'wheelFactor: scroll up zooms in');
    near(wheelFactor(100), 1.12, 1e-12, 'wheelFactor: scroll down zooms out');
    ok(wheelFactor(0) === null, 'wheelFactor: horizontal-only scroll ignored');
    ok(wheelFactor(NaN) === null, 'wheelFactor: NaN ignored');
    ok(wheelFactor(-0.5) > 0 && wheelFactor(-0.5) < 1, 'wheelFactor: any negative notch zooms in');

    // ---- ω window scaling ----
    const view0 = { xmin: -3, xmax: 3 };
    const zx = scaleX(view0, 0, 0.5);
    ok(!!zx && zx.xmin === -1.5 && zx.xmax === 1.5, 'scaleX: halves the span about the anchor',
        zx && JSON.stringify(zx));
    ok(view0.xmin === -3 && view0.xmax === 3, 'scaleX: input left untouched');
    const zx2 = scaleX(view0, -1, 1 / 1.12);
    ok(!!zx2, 'scaleX: zoom-in within limits');
    if (zx2)
        near((-1 - zx2.xmin) / (zx2.xmax - zx2.xmin), (-1 - view0.xmin) / (view0.xmax - view0.xmin),
            1e-12, 'scaleX: anchor keeps its relative position');
    ok(scaleX({ xmin: 0, xmax: 0.5 }, 0.2, 0.5) === null, 'scaleX: refuses under 0.4 decade');
    ok(scaleX({ xmin: 0, xmax: 0.5 }, 0.2, 1.12) !== null, 'scaleX: 0.5 decade may zoom out');
    ok(scaleX({ xmin: 0, xmax: 22 }, 12, 1.12) === null, 'scaleX: refuses over 24 decades');
    ok(scaleX({ xmin: 0, xmax: 20 }, 12, 1.12) !== null, 'scaleX: 20 decades may zoom out');
    ok(scaleX(view0, 0, 0) === null, 'scaleX: zero factor rejected');
    ok(scaleX(view0, 0, -1) === null, 'scaleX: negative factor rejected');
    ok(scaleX(view0, NaN, 0.5) === null, 'scaleX: NaN anchor rejected');

    // ---- y window scaling ----
    const yr0 = { min: -40, max: 40 };
    const zy = scaleY(yr0, 0, 0.5);
    ok(!!zy && zy.min === -20 && zy.max === 20, 'scaleY: halves the span about the anchor',
        zy && JSON.stringify(zy));
    ok(yr0.min === -40 && yr0.max === 40, 'scaleY: input left untouched');
    const zy2 = scaleY(yr0, 10, 1.12);
    ok(!!zy2, 'scaleY: zoom-out within limits');
    if (zy2)
        near((10 - zy2.min) / (zy2.max - zy2.min), (10 - yr0.min) / (yr0.max - yr0.min),
            1e-12, 'scaleY: anchor keeps its relative position');
    const zy3 = scaleY(yr0, -40, 0.5);
    ok(!!zy3 && zy3.min === -40 && zy3.max === 0, 'scaleY: anchor on an edge pins that edge');
    ok(scaleY({ min: 0, max: 4 }, 2, 0.5) === null, 'scaleY: refuses under 4');
    ok(scaleY({ min: 0, max: 3600 }, 0, 1.12) === null, 'scaleY: refuses over 3600');
    ok(scaleY({ min: 0, max: 3000 }, 0, 1.12) !== null, 'scaleY: 3000 may zoom out');
    ok(scaleY(yr0, 0, 0) === null, 'scaleY: zero factor rejected');

    // ---- the wheel handler, end to end on a stubbed canvas ----
    const savedState = JSON.stringify({ v: state.view, m: state.yMag, p: state.yPh });
    const savedCanvas = JSON.stringify(A.canvas);
    const savedRender = A.render;
    const savedStatus = A.els.status;
    let renders = 0;
    A.canvas.magW = 600; A.canvas.magH = 400;
    A.canvas.phW = 600; A.canvas.phH = 400;
    A.els.status = { innerHTML: '' };
    A.render = () => { renders++; };

    function restore() {
        const o = JSON.parse(savedState);
        state.view = o.v; state.yMag = o.m; state.yPh = o.p;
        Object.assign(A.canvas, JSON.parse(savedCanvas));
        A.render = savedRender;
        A.els.status = savedStatus;
    }

    function fakeCanvas(w, h) {
        const handlers = {};
        return {
            addEventListener(t, fn) { (handlers[t] || (handlers[t] = [])).push(fn); },
            getBoundingClientRect() { return { left: 0, top: 0, width: w, height: h }; },
            fire(t, ev) { (handlers[t] || []).forEach(fn => fn(ev)); },
        };
    }
    function wheel(c, x, y, deltaY) {
        let prevented = false;
        c.fire('wheel', {
            clientX: x, clientY: y, deltaY,
            preventDefault() { prevented = true; },
        });
        return prevented;
    }
    function fresh() {
        const o = JSON.parse(savedState);
        state.view = o.v; state.yMag = o.m; state.yPh = o.p;
        renders = 0;
        A.els.status.innerHTML = '';
    }
    function spanX() { return state.view.xmax - state.view.xmin; }
    function spanY(yr) { return yr.max - yr.min; }
    function status() { return A.els.status.innerHTML; }

    try {
        const mag = fakeCanvas(600, 400);
        const ph = fakeCanvas(600, 400);
        A.bindWheel(mag, 'mag');
        A.bindWheel(ph, 'ph');

        // left margin: scales this graph's y window only
        fresh();
        ok(wheel(mag, 20, 200, -100) === true, 'wheel: default prevented on the y strip');
        ok(spanX() === 6, 'y strip leaves ω untouched', 'span ' + spanX());
        ok(spanY(state.yMag) < 80, 'y strip zooms the magnitude axis in', 'span ' + spanY(state.yMag));
        ok(status().indexOf('Magnitude axis') === 0, 'y strip reports the magnitude axis', status());
        ok(renders === 1, 'y strip re-renders once', String(renders));

        // right margin: same axis, other side
        fresh();
        ok(wheel(mag, 595, 200, 100) === true, 'wheel: prevented on the right margin');
        ok(spanX() === 6, 'right margin leaves ω untouched');
        ok(spanY(state.yMag) > 80, 'right margin zooms the magnitude axis out', 'span ' + spanY(state.yMag));

        // bottom margin: scales ω only
        fresh();
        wheel(mag, 300, 380, -100);
        ok(spanX() < 6, 'bottom strip zooms ω in', 'span ' + spanX());
        ok(spanY(state.yMag) === 80 && spanY(state.yPh) === 450, 'bottom strip leaves both y axes untouched');
        ok(status().indexOf('ω axis') === 0, 'bottom strip reports the ω axis', status());

        // top margin: same
        fresh();
        wheel(mag, 300, 5, 100);
        ok(spanX() > 6, 'top strip zooms ω out', 'span ' + spanX());
        ok(spanY(state.yMag) === 80, 'top strip leaves y untouched');

        // bottom-left corner counts as the y margin
        fresh();
        wheel(mag, 10, 390, -100);
        ok(spanX() === 6, 'corner leaves ω untouched');
        ok(spanY(state.yMag) < 80, 'corner scales the magnitude axis', 'span ' + spanY(state.yMag));

        // phase graph gets its own y window
        fresh();
        wheel(ph, 20, 200, -100);
        ok(spanY(state.yPh) < 450, 'ph y strip zooms the phase axis', 'span ' + spanY(state.yPh));
        ok(spanY(state.yMag) === 80, 'ph y strip leaves the magnitude axis alone');
        ok(status().indexOf('Phase axis') === 0, 'phase strip reports the phase axis', status());

        // plot body: ω zoom, y untouched (feature 1 — unchanged from before)
        fresh();
        ok(wheel(mag, 300, 200, -100) === true, 'wheel: prevented over the plot');
        ok(spanX() < 6, 'plot wheel zooms ω in', 'span ' + spanX());
        ok(spanY(state.yMag) === 80 && spanY(state.yPh) === 450, 'plot wheel leaves both y axes untouched');
        ok(status().indexOf('Zoom ω') === 0, 'plot wheel reports the ω zoom', status());

        // the data point under the cursor stays put while zooming
        fresh();
        const anchorX = pxToX(400, g);
        const fracBefore = (anchorX - state.view.xmin) / spanX();
        wheel(mag, 400, 200, -100);
        const fracAfter = (anchorX - state.view.xmin) / spanX();
        near(fracAfter, fracBefore, 1e-9, 'plot wheel is anchored on the cursor (ω)');
        fresh();
        const anchorY = pxToY(300, g, state.yMag);
        const yFracBefore = (anchorY - state.yMag.min) / spanY(state.yMag);
        wheel(mag, 20, 300, -100);
        const yFracAfter = (anchorY - state.yMag.min) / spanY(state.yMag);
        near(yFracAfter, yFracBefore, 1e-9, 'strip wheel is anchored on the cursor (y)');

        // horizontal-only scrolls and out-of-plot coordinates do nothing
        fresh();
        ok(wheel(mag, 300, 200, 0) === true, 'wheel: still prevented for a horizontal scroll');
        ok(renders === 0 && spanX() === 6, 'horizontal-only scroll changes nothing', String(renders));

        // span limits hold on every route
        fresh();
        state.view.xmin = 0; state.view.xmax = A.X_SPAN.min;
        wheel(mag, 300, 200, -100);
        ok(spanX() === A.X_SPAN.min, 'ω zoom stops at the minimum span', 'span ' + spanX());
        wheel(mag, 300, 380, -100);
        ok(spanX() === A.X_SPAN.min, 'ω strip zoom stops at the minimum span', 'span ' + spanX());
        fresh();
        state.view.xmin = 0; state.view.xmax = A.X_SPAN.max;
        wheel(mag, 300, 380, 100);
        ok(spanX() === A.X_SPAN.max, 'ω strip zoom stops at the maximum span', 'span ' + spanX());
        fresh();
        state.yMag.min = 0; state.yMag.max = A.Y_SPAN.min;
        wheel(mag, 20, 200, -100);
        ok(spanY(state.yMag) === A.Y_SPAN.min, 'y strip zoom stops at the minimum span',
            'span ' + spanY(state.yMag));
        fresh();
        state.yMag.min = 0; state.yMag.max = A.Y_SPAN.max;
        wheel(mag, 20, 200, 100);
        ok(spanY(state.yMag) === A.Y_SPAN.max, 'y strip zoom stops at the maximum span',
            'span ' + spanY(state.yMag));
    } catch (err) {
        failures.push('wheel handler threw — ' + err.message);
    } finally {
        restore();
    }

    return { passed, failed: failures.length, failures };
}

A.selfTest = selfTest;

})(globalThis.BodeApp = globalThis.BodeApp || {});
