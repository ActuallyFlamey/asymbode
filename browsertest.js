/* Browser self-test for the asymbode wheel/zoom behaviour:  node browsertest.js
 *
 * The node self-test (node selftest.js) covers the zoom maths and the wheel
 * handler on a stubbed canvas; this one loads index.html in headless Chromium
 * and fires real WheelEvents at the real, laid-out canvases. Needs chromium
 * (override with CHROME=/path/to/chromium) — it is skipped, not failed, when
 * no browser is found. */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = process.env.CHROME || ['/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome']
    .find(p => fs.existsSync(p));
const PORT = 9333;
const URL = 'file://' + path.resolve(__dirname, 'index.html');

const failures = [];
let passed = 0;
function ok(cond, name, detail) {
    if (cond) passed++;
    else failures.push(name + (detail ? ' — ' + detail : ''));
}
function near(a, b, tol, name) {
    ok(Math.abs(a - b) <= tol, name, 'got ' + a + ', expected ' + b);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForChrome(retries = 60) {
    for (let i = 0; i < retries; i++) {
        try {
            const r = await fetch('http://127.0.0.1:' + PORT + '/json/version');
            if (r.ok) return r.json();
        } catch (_) { /* not up yet */ }
        await sleep(200);
    }
    throw new Error('chromium devtools endpoint never came up');
}

/** Minimal CDP client over Node's built-in WebSocket. */
function cdp(ws) {
    let seq = 0;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
            const { resolve, reject } = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error) reject(new Error(msg.error.message));
            else resolve(msg.result);
        }
    });
    return function send(method, params, sessionId) {
        const id = ++seq;
        return new Promise((resolve, reject) => {
            pending.set(id, { resolve, reject });
            ws.send(JSON.stringify({ id, method, params: params || {}, sessionId }));
        });
    };
}

async function main() {
    if (!CHROME) {
        console.log('browsertest: skipped — no chromium found (set CHROME=…)');
        process.exit(0);
    }

    const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'asymbode-chrome-'));
    const chrome = spawn(CHROME, [
        '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
        '--remote-debugging-port=' + PORT, '--user-data-dir=' + prof,
        '--window-size=1400,1000', 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'ignore'] });

    let ws, sessionId;
    try {
        const ver = await waitForChrome();
        ws = new WebSocket(ver.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
            ws.addEventListener('open', res, { once: true });
            ws.addEventListener('error', rej, { once: true });
        });
        const send = cdp(ws);
        const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
        ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));
        await send('Page.enable', {}, sessionId);
        await send('Page.navigate', { url: URL }, sessionId);

        // wait for the app to boot
        let booted = false;
        for (let i = 0; i < 100 && !booted; i++) {
            const r = await send('Runtime.evaluate', {
                expression: '!!(window.__bode && window.__bode.state && document.getElementById("magCanvas"))',
            }, sessionId);
            booted = r.result.value;
            if (!booted) await sleep(100);
        }
        ok(booted, 'page boots and exposes __bode');
        if (!booted) throw new Error('app never booted');

        /** Run an expression in the page and return its JSON value. */
        async function evalPage(expression) {
            const r = await send('Runtime.evaluate', {
                expression, awaitPromise: true, returnByValue: true,
            }, sessionId);
            if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' +
                (r.exceptionDetails.exception || {}).description);
            return r.result.value;
        }

        const spans = () => evalPage(`(() => { const s = window.__bode.state;
            return { x: s.view.xmax - s.view.xmin,
                     mag: s.yMag.max - s.yMag.min, ph: s.yPh.max - s.yPh.min }; })()`);

        const reset = () => evalPage(`(() => { const s = window.__bode.state;
            s.view.xmin = -3; s.view.xmax = 3;
            s.yMag.min = -40; s.yMag.max = 40;
            s.yPh.min = -225; s.yPh.max = 225;
            window.__bode.render();
            return true; })()`);

        /** Fire a real wheel event at local pixel (lx, ly) of canvas `id`. */
        const wheel = (id, lx, ly, dy) => evalPage(`(() => {
            const el = document.getElementById(${JSON.stringify(id)});
            const r = el.getBoundingClientRect();
            const ev = new WheelEvent('wheel', {
                clientX: r.left + ${lx}, clientY: r.top + ${ly},
                deltaY: ${dy}, deltaMode: 0, bubbles: true, cancelable: true, view: window });
            const delivered = el.dispatchEvent(ev);   // false ⇒ preventDefault ran
            return { delivered, status: document.getElementById('status').textContent,
                     scrollY: window.scrollY, rectW: r.width, rectH: r.height };
        })()`);

        // geometry sanity: the canvases are really laid out
        const geo = await evalPage(`(() => { const r = document.getElementById('magCanvas').getBoundingClientRect();
            return { w: r.width, h: r.height }; })()`);
        ok(geo.w > 300 && geo.h > 150, 'mag canvas is laid out', JSON.stringify(geo));

        let s = await spans();
        ok(Math.abs(s.x - 6) < 1e-9 && Math.abs(s.mag - 80) < 1e-9 && Math.abs(s.ph - 450) < 1e-9,
            'initial view is the default one', JSON.stringify(s));

        // --- plot body: uniform view zoom (ω and both y windows together) ---
        await reset();
        let r = await wheel('magCanvas', geo.w / 2, geo.h / 2, -100);
        ok(r.delivered === false, 'plot wheel calls preventDefault', JSON.stringify(r));
        s = await spans();
        const notch = 1 / 1.12;
        ok(s.x < 6, 'plot wheel zooms ω in', JSON.stringify(s));
        near(s.x / 6, notch, 1e-9, 'plot wheel scales ω by one notch');
        near(s.mag / 80, notch, 1e-9, 'plot wheel scales the magnitude axis with ω');
        near(s.ph / 450, notch, 1e-9, 'plot wheel scales the phase axis with ω');
        ok(/^Zoom view/.test(r.status), 'plot wheel status reads "Zoom view"', r.status);
        ok(r.scrollY === 0, 'the page does not scroll while zooming');

        // --- left margin: scales magnitude only ---
        await reset();
        r = await wheel('magCanvas', 20, geo.h / 2, -100);
        s = await spans();
        ok(s.x === 6, 'y strip leaves ω alone', JSON.stringify(s));
        ok(s.mag < 80 && s.ph === 450, 'y strip zooms the magnitude axis only', JSON.stringify(s));
        ok(/^Magnitude axis/.test(r.status), 'y strip status reads "Magnitude axis"', r.status);

        // --- right margin: same axis ---
        await reset();
        r = await wheel('magCanvas', geo.w - 5, geo.h / 2, 100);
        s = await spans();
        ok(s.x === 6 && s.mag > 80 && s.ph === 450, 'right strip zooms the magnitude axis out',
            JSON.stringify(s));

        // --- bottom margin: scales ω only ---
        await reset();
        r = await wheel('magCanvas', geo.w / 2, geo.h - 5, -100);
        s = await spans();
        ok(s.x < 6, 'bottom strip zooms ω in', JSON.stringify(s));
        ok(s.mag === 80 && s.ph === 450, 'bottom strip leaves both y axes alone', JSON.stringify(s));
        ok(/^ω axis/.test(r.status), 'bottom strip status reads "ω axis"', r.status);

        // --- top margin: same ---
        await reset();
        r = await wheel('magCanvas', geo.w / 2, 4, 100);
        s = await spans();
        ok(s.x > 6 && s.mag === 80, 'top strip zooms ω out and leaves y alone', JSON.stringify(s));

        // --- the phase graph owns its own y window ---
        const phGeo = await evalPage(`(() => { const r = document.getElementById('phCanvas').getBoundingClientRect();
            return { w: r.width, h: r.height, top: r.top }; })()`);
        ok(phGeo.h > 100, 'ph canvas is laid out', JSON.stringify(phGeo));
        await reset();
        r = await wheel('phCanvas', 20, phGeo.h / 2, -100);
        s = await spans();
        ok(s.x === 6 && s.mag === 80 && s.ph < 450, 'ph y strip zooms the phase axis only',
            JSON.stringify(s));
        ok(/^Phase axis/.test(r.status), 'phase strip status reads "Phase axis"', r.status);
        // the phase graph's plot body zooms the whole view too
        await reset();
        await wheel('phCanvas', phGeo.w / 2, phGeo.h / 2, -100);
        s = await spans();
        ok(s.x < 6 && s.mag < 80 && s.ph < 450, 'ph plot wheel zooms the whole view',
            JSON.stringify(s));
        await reset();
        r = await wheel('phCanvas', phGeo.w / 2, phGeo.h - 5, -100);
        s = await spans();
        ok(s.x < 6 && s.mag === 80 && s.ph === 450, 'ph bottom strip still zooms shared ω',
            JSON.stringify(s));

        // --- anchors: the data under the cursor stays fixed ---
        // (Chromium truncates fractional event coordinates, so the probe must
        // use the integer clientX/clientY the handler will actually see)
        await reset();
        const frac = await evalPage(`(() => { const A = window.BodeApp, s = A.state;
            const el = document.getElementById('magCanvas');
            const r = el.getBoundingClientRect();
            const g = A.geom(A.canvas.magW, A.canvas.magH);
            const clientX = Math.round(r.left + g.l + 0.6 * g.w);
            const clientY = Math.round(r.top + g.t + 0.5 * g.h);
            const xLog = A.pxToX(clientX - r.left, g);
            const yMag = A.pxToY(clientY - r.top, g, s.yMag);
            const yPh = A.pxToY(clientY - r.top, g, s.yPh);
            const fx = w => (xLog - w.xmin) / (w.xmax - w.xmin);
            const fy = (v, w) => (v - w.min) / (w.max - w.min);
            const snap = () => [fx(s.view), fy(yMag, s.yMag), fy(yPh, s.yPh)];
            const before = snap();
            el.dispatchEvent(new WheelEvent('wheel', { clientX, clientY, deltaY: -100,
                bubbles: true, cancelable: true, view: window }));
            return { before, after: snap() }; })()`);
        near(frac.after[0], frac.before[0], 1e-9, 'view zoom is anchored under the cursor (ω)');
        near(frac.after[1], frac.before[1], 1e-9, 'view zoom is anchored under the cursor (dB)');
        near(frac.after[2], frac.before[2], 1e-9, 'view zoom is anchored under the cursor (°)');

        await reset();
        const yFrac = await evalPage(`(() => { const A = window.BodeApp, s = A.state;
            const el = document.getElementById('magCanvas');
            const r = el.getBoundingClientRect();
            const g = A.geom(A.canvas.magW, A.canvas.magH);
            const clientX = Math.round(r.left + 20);
            const clientY = Math.round(r.top + g.t + 0.7 * g.h);
            const yVal = A.pxToY(clientY - r.top, g, s.yMag);
            const fy0 = (yVal - s.yMag.min) / (s.yMag.max - s.yMag.min);
            el.dispatchEvent(new WheelEvent('wheel', { clientX, clientY, deltaY: -100,
                bubbles: true, cancelable: true, view: window }));
            const fy1 = (yVal - s.yMag.min) / (s.yMag.max - s.yMag.min);
            return { fy0, fy1 }; })()`);
        near(yFrac.fy1, yFrac.fy0, 1e-9, 'y strip zoom is anchored under the cursor');

        // --- horizontal-only scrolls and span limits ---
        await reset();
        r = await evalPage(`(() => { const el = document.getElementById('magCanvas');
            const rect = el.getBoundingClientRect();
            const ev = new WheelEvent('wheel', { clientX: rect.left + 100, clientY: rect.top + 100,
                deltaX: 40, deltaY: 0, bubbles: true, cancelable: true, view: window });
            el.dispatchEvent(ev);
            return document.getElementById('status').textContent; })()`);
        s = await spans();
        ok(s.x === 6 && s.mag === 80 && s.ph === 450, 'horizontal-only scroll changes nothing',
            JSON.stringify(s) + ' / ' + r);

        await reset();
        await evalPage(`(() => { const s = window.__bode.state;
            s.view.xmin = 0; s.view.xmax = 0.4;
            s.yMag.min = 0; s.yMag.max = 4;
            s.yPh.min = 0; s.yPh.max = 5;
            return true; })()`);
        await wheel('magCanvas', geo.w / 2, geo.h / 2, -100);
        await wheel('magCanvas', 20, geo.h / 2, -100);
        s = await spans();
        ok(Math.abs(s.x - 0.4) < 1e-9 && Math.abs(s.mag - 4) < 1e-9 && Math.abs(s.ph - 5) < 1e-9,
            'zoom-in stops at the minimum spans', JSON.stringify(s));

        await reset();
        await evalPage(`(() => { const s = window.__bode.state;
            s.view.xmin = 0; s.view.xmax = 24;
            s.yMag.min = 0; s.yMag.max = 3600;
            return true; })()`);
        await wheel('magCanvas', geo.w / 2, geo.h - 5, 100);
        await wheel('magCanvas', 20, geo.h / 2, 100);
        s = await spans();
        ok(Math.abs(s.x - 24) < 1e-9 && Math.abs(s.mag - 3600) < 1e-9,
            'zoom-out stops at the maximum spans', JSON.stringify(s));

        // one pinned window halts the whole view zoom (all-or-nothing)
        await reset();
        await evalPage(`(() => { const s = window.__bode.state;
            s.yMag.min = 0; s.yMag.max = 4;
            return true; })()`);
        await wheel('magCanvas', geo.w / 2, geo.h / 2, -100);
        s = await spans();
        ok(s.x === 6 && s.mag === 4 && s.ph === 450,
            'a pinned y window stops the whole view zoom', JSON.stringify(s));

        await reset();
    } finally {
        if (ws) try { ws.close(); } catch (_) { /* ok */ }
        chrome.kill('SIGKILL');
        try { fs.rmSync(prof, { recursive: true, force: true }); } catch (_) { /* ok */ }
    }

    console.log('browser-test: ' + passed + ' passed, ' + failures.length + ' failed');
    for (const f of failures) console.log('  ✗ ' + f);
    process.exit(failures.length ? 1 : 0);
}

main().catch(err => {
    console.error('browser-test: ' + err.message);
    process.exit(1);
});
