/* asymbode — sidebar: origin counters, gain fields and the element list. */
(function (A) {
'use strict';

const state = A.state;
const els = A.els;
const BM = window.BodeMath;
const { fmtW, fmtNum, setStatus } = A;

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

// set while the element list is being rebuilt — drops the re-entrant `change`
// event the browser fires when a focused, edited input is pulled from the DOM
let elemListBusy = false;

function updateElemList() {
    if (elemListBusy) return;
    const list = els.elemList;
    const u = state.user;
    // dropping a focused, half-typed ω field from the DOM fires a `change` event,
    // so remember what is being edited and put it back after the rebuild
    const act = document.activeElement;
    let keepId = null, keepVal = null, caret = null, selEnd = null;
    if (act && act.classList && act.classList.contains('elem-w') && list.contains(act)) {
        const host = act.closest('.elem-row');
        if (host) {
            keepId = host.dataset.id;
            // only text the user has actually typed is worth keeping
            if (act.dataset.dirty === '1') keepVal = act.value;
            try { caret = act.selectionStart; selEnd = act.selectionEnd; } catch (_) { /* not selectable */ }
        }
    }
    elemListBusy = true;
    try {
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
            wInput.addEventListener('input', () => { wInput.dataset.dirty = '1'; });
            wInput.addEventListener('change', () => {
                if (elemListBusy) return; // fired by removing this field mid-rebuild
                const v = parseFloat(wInput.value);
                delete wInput.dataset.dirty;
                if (!isFinite(v) || v <= 0) { wInput.value = fmtW(BM.freqOf(e)); return; }
                if (v === BM.freqOf(e)) { wInput.value = fmtW(v); return; } // blur with nothing to commit
                if (e.kind === 'real') e.w = v; else e.wn = v;
                wInput.value = fmtW(v);
                setStatus('Moved <b>' + A.elemLabel(e) + '</b> to ω = <span class="val">' + fmtW(v) + '</span>');
                A.recordHistory();
                updateElemList();
                A.render();
            });
            wInput.addEventListener('pointerdown', ev => ev.stopPropagation());

            const order = document.createElement('span');
            order.className = 'order-ctl';
            const dec = document.createElement('button');
            dec.className = 'mini'; dec.type = 'button'; dec.textContent = '−';
            dec.title = 'Lower order (removes when ×1)';
            dec.addEventListener('click', ev => {
                ev.stopPropagation();
                if (e.order > 1) { e.order--; setStatus(A.elemLabel(e) + ' order ×' + e.order); }
                else { A.removeElem(e.id); return; }
                A.recordHistory();
                updateElemList(); A.render();
            });
            const n = document.createElement('span');
            n.className = 'order-n'; n.textContent = '×' + e.order;
            const inc = document.createElement('button');
            inc.className = 'mini'; inc.type = 'button'; inc.textContent = '+';
            inc.title = 'Raise order';
            inc.addEventListener('click', ev => {
                ev.stopPropagation();
                e.order++;
                setStatus(A.elemLabel(e) + ' order ×' + e.order + ' · slope ' +
                    (BM.magSlopeUnit(e) * e.order > 0 ? '+' : '−') + Math.abs(BM.magSlopeUnit(e) * e.order) + ' dB/dec');
                A.recordHistory();
                updateElemList(); A.render();
            });
            order.append(dec, n, inc);

            const del = document.createElement('button');
            del.className = 'elem-del'; del.type = 'button'; del.textContent = '✕';
            del.title = 'Remove';
            del.addEventListener('click', ev => { ev.stopPropagation(); A.removeElem(e.id); });

            row.append(badge, type, wInput, order, del);
            row.addEventListener('click', (ev) => {
                if (ev.target.closest('input, button')) return;
                const changed = state.selId !== e.id;
                state.selId = e.id;
                setStatus('Selected <b>' + A.elemLabel(e) + '</b> at ω = <span class="val">' + fmtW(BM.freqOf(e)) + '</span>');
                if (changed) { updateElemList(); A.render(); }
            });
            list.appendChild(row);
        }
    } finally {
        elemListBusy = false;
    }
    if (keepId != null) {
        const host = list.querySelector('.elem-row[data-id="' + keepId + '"]');
        const inp = host && host.querySelector('.elem-w');
        if (inp) {
            if (keepVal != null) {
                inp.value = keepVal;
                inp.dataset.dirty = '1';
            }
            inp.focus();
            try { if (caret != null) inp.setSelectionRange(caret, selEnd); } catch (_) { /* not selectable */ }
        }
    }
}

function updateSidebar() {
    updateOriginCounts();
    updateGainUI();
    updateElemList();
}

A.updateOriginCounts = updateOriginCounts;
A.updateGainUI = updateGainUI;
A.updateElemList = updateElemList;
A.updateSidebar = updateSidebar;

})(globalThis.BodeApp = globalThis.BodeApp || {});
