/* asymbode — export: composed PNG (header + magnitude + phase), download or
 * clipboard (paste straight into AFFiNE). */
(function (A) {
'use strict';

const els = A.els;
const { setStatus } = A;

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
    const expr = 'G(s) = ' + (A.tfRawExpr() || '—');
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

A.composeExport = composeExport;
A.exportPng = exportPng;
A.copyImage = copyImage;

})(globalThis.BodeApp = globalThis.BodeApp || {});
