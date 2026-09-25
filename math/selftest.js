/* asymbode-math — self-tests (run with `node selftest.js`, or BodeMath.selfTest()).
 *
 * Loads last: everything below is destructured from the shared namespace. */
(function (A) {
'use strict';

const {
    normalizeInput, parseTransferFunction, exactPoint, exactCurve,
    asymMag, asymPhase, asymMagPoints, asymPhasePoints,
    stateFromTF, checkSolution, clusterElems, coalesceMirrored,
    texPreview, tfExpr, freqOf, fmtW,
} = A;

function selfTest() {
    const failures = [];
    let passed = 0;
    function ok(cond, name, detail) {
        if (cond) { passed++; }
        else failures.push(name + (detail ? ' — ' + detail : ''));
    }
    function near(a, b, tol, name) {
        const d = Math.abs(a - b);
        ok(d <= tol, name, 'got ' + a + ', expected ' + b + ' (Δ=' + d + ')');
    }

    function find(list, w) {
        return list.find(e => Math.abs(Math.log10(freqOf(e) / w)) < 0.05);
    }

    // ---- parser: the headline example ----
    let tf = parseTransferFunction('1/(1+10^{-4}*s)');
    near(tf.gain, 1, 1e-9, 'ex1 gain');
    ok(tf.poles.length === 1 && tf.poles[0].kind === 'real', 'ex1 one real pole');
    near(tf.poles[0].w, 1e4, 1e-3, 'ex1 pole corner');
    ok(tf.zeros.length === 0 && tf.z0 === 0 && tf.p0 === 0, 'ex1 no other elements');

    // G(s) = \frac {1} {1 + 10^-4 s}  (with unicode minus and spaces)
    tf = parseTransferFunction('G_{(s)} = \\frac {1} {1 + 10^{−4}s}');
    near(tf.gain, 1, 1e-9, 'latex gain');
    near(tf.poles[0].w, 1e4, 1, 'latex pole corner');

    tf = parseTransferFunction('\\dfrac{1}{1+10^{-4}s}');
    near(tf.poles[0].w, 1e4, 1, 'dfrac pole corner');

    // gain + integrator + corner
    tf = parseTransferFunction('10*(1+s/10)/(s*(1+s/1000))');
    near(tf.gain, 10, 1e-9, 'int gain');
    ok(tf.p0 === 1, 'int p0=1');
    near(find(tf.zeros, 10).w, 10, 1e-9, 'int zero@10');
    near(find(tf.poles, 1000).w, 1000, 1e-9, 'int pole@1000');

    tf = parseTransferFunction('\\frac{100 s}{(1+0.1 s)(1+0.01 s)}');
    near(tf.gain, 100, 1e-9, 'frac100 gain');
    ok(tf.z0 === 1, 'frac100 z0=1');
    near(find(tf.poles, 10).w, 10, 1e-6, 'frac100 pole@10');
    near(find(tf.poles, 100).w, 100, 1e-6, 'frac100 pole@100');

    // expanded products & squares
    tf = parseTransferFunction('(s+1)*(s+100)/((s+10)^2)');
    near(tf.gain, 1, 1e-6, 'prod gain (DC=1)');
    near(find(tf.zeros, 1).w, 1, 1e-6, 'prod zero@1');
    near(find(tf.zeros, 100).w, 100, 1e-6, 'prod zero@100');
    const d2 = find(tf.poles, 10);
    ok(d2 && d2.order === 2, 'prod double pole@10', d2 && ('order=' + d2.order));

    tf = parseTransferFunction('(1+s/10)^3/s^2');
    near(tf.gain, 1, 1e-6, 'pow gain');
    const z3 = find(tf.zeros, 10);
    ok(z3 && z3.order === 3, 'pow zero order 3 (numerator power)', z3 ? 'order=' + z3.order : 'missing');
    ok(tf.p0 === 2, 'pow p0=2');

    // quadratics / complex pairs
    tf = parseTransferFunction('2*10^4/(s^2 + 1.4 s + 100)');
    near(tf.gain, 200, 1e-6, 'cplx gain');
    ok(tf.poles.length === 1 && tf.poles[0].kind === 'complex', 'cplx pole pair');
    near(tf.poles[0].wn, 10, 1e-6, 'cplx wn');
    near(tf.poles[0].zeta, 0.07, 1e-6, 'cplx zeta');

    tf = parseTransferFunction('(s^2+4)/(s^2+1)');
    near(find(tf.zeros, 2).wn, 2, 1e-6, 'pair zero wn=2');
    ok(find(tf.zeros, 2).kind === 'complex', 'pair zero complex');
    near(find(tf.poles, 1).wn, 1, 1e-6, 'pair pole wn=1');

    // origin-only
    tf = parseTransferFunction('1/s^2');
    near(tf.gain, 1, 1e-12, '1/s^2 gain');
    ok(tf.p0 === 2 && tf.poles.length === 0, '1/s^2 p0');

    tf = parseTransferFunction('s');
    ok(tf.z0 === 1 && Math.abs(tf.gain - 1) < 1e-12, 's → z0=1 K=1');

    // constants & scientific notation
    tf = parseTransferFunction('5');
    near(tf.gain, 5, 1e-12, 'constant 5');

    tf = parseTransferFunction('1e3*(1+2e-3*s)');
    near(tf.gain, 1000, 1e-9, 'sci gain');
    near(find(tf.zeros, 500).w, 500, 1e-6, 'sci zero@500');

    // RHP
    tf = parseTransferFunction('s-1');
    ok(tf.zeros.length === 1 && tf.zeros[0].rhp, 'RHP zero flagged');
    near(tf.zeros[0].w, 1, 1e-9, 'RHP zero w=1');
    near(tf.gain, -1, 1e-9, 'RHP zero K=-1');

    tf = parseTransferFunction('1/(s-1)');
    ok(tf.poles[0].rhp, 'RHP pole flagged');
    near(tf.gain, -1, 1e-9, 'RHP pole K=-1');

    // negative gain
    tf = parseTransferFunction('-10*(1+s/10)');
    near(tf.gain, -10, 1e-9, 'neg gain');
    near(find(tf.zeros, 10).w, 10, 1e-9, 'neg gain zero');

    // double zero via square
    tf = parseTransferFunction('((1+s)^2)/s^2');
    ok(find(tf.zeros, 1).order === 2, 'double zero order');
    ok(tf.p0 === 2, 'double integrator');

    // implicit multiplication & spaces
    tf = parseTransferFunction('2.5 / ( s * (1 + s/20)^2 )');
    near(tf.gain, 2.5, 1e-9, 'spaces gain');
    ok(find(tf.poles, 20).order === 2, 'spaces double pole');

    // 1/(s+1)(s+2)(s+3): DC = 1/6 → K = 1/6, poles at 1,2,3
    tf = parseTransferFunction('1/(s^3 + 6 s^2 + 11 s + 6)');
    near(find(tf.poles, 1).w, 1, 1e-6, 'cubic pole@1');
    near(find(tf.poles, 2).w, 2, 1e-6, 'cubic pole@2');
    near(find(tf.poles, 3).w, 3, 1e-6, 'cubic pole@3');
    near(tf.gain, 1 / 6, 1e-6, 'cubic gain = 1/6 (DC)');

    // equal-degree ratio → K = lead ratio × Π(−r)/Π(−p) = 1·(1)/(2) = 0.5
    tf = parseTransferFunction('(s+1)/(s+2)');
    near(tf.gain, 0.5, 1e-9, 'ratio K=0.5 (DC 1/2)');
    near(find(tf.zeros, 1).w, 1, 1e-9, 'ratio zero');
    near(find(tf.poles, 2).w, 2, 1e-9, 'ratio pole');

    // (s^2+2s+1)/(s+1) = s+1 → one zero at 1, no poles, K=1
    tf = parseTransferFunction('(s^2+2*s+1)/(s+1)');
    ok(tf.z0 === 0 && tf.p0 === 0, 'cancel origin clean');
    near(tf.gain, 1, 1e-6, 'cancel gain=1');
    ok(tf.zeros.length === 1 && tf.poles.length === 1 - 1, 'cancel leaves s+1 only',
        'zeros=' + tf.zeros.length + ' poles=' + tf.poles.length);
    near(find(tf.zeros, 1).w, 1, 1e-6, 'cancel remaining zero@1');

    // partial cancellation: (s^2+3s+2)/(s+1) = s+2
    tf = parseTransferFunction('(s^2+3*s+2)/(s+1)');
    near(tf.gain, 2, 1e-6, 'partial cancel gain=2');
    near(find(tf.zeros, 2).w, 2, 1e-6, 'partial cancel zero@2');
    ok(tf.poles.length === 0, 'partial cancel pole gone');

    // errors
    let threw = null;
    try { parseTransferFunction('exp(-s)'); } catch (e) { threw = e; }
    ok(threw && /delay/.test(threw.message), 'error: exp delay', threw && threw.message);
    threw = null;
    try { parseTransferFunction(''); } catch (e) { threw = e; }
    ok(threw, 'error: empty');
    threw = null;
    try { parseTransferFunction('(s^2+1)/(s+1)'); } catch (e) { threw = e; }
    ok(!threw, 'improper-in-expanded-form still factors', threw && threw.message);
    threw = null;
    try { parseTransferFunction('1+'); } catch (e) { threw = e; }
    ok(threw, 'error: trailing op');
    threw = null;
    try { parseTransferFunction('K*(1+s/10)'); } catch (e) { threw = e; }
    ok(threw && /Unknown symbol/.test(threw.message), 'error: unknown K', threw && threw.message);
    threw = null;
    try { parseTransferFunction('1/(1+s/10)^0.5'); } catch (e) { threw = e; }
    ok(threw && /integer/.test(threw.message), 'error: fractional exponent', threw && threw.message);
    threw = null;
    try { parseTransferFunction('\\frac{1}{1+s}'); } catch (e) { threw = e; }
    ok(!threw, 'latex frac accepted', threw && threw.message);

    // ---- exact values ----
    tf = parseTransferFunction('1/(1+10^{-4}*s)');
    let p = exactPoint(tf, 1e4);
    near(p.db, -20 * Math.log10(Math.SQRT2), 1e-6, 'exact −3.01 dB at corner');
    near(p.phase, -45, 1e-6, 'exact −45° at corner');
    p = exactPoint(tf, 1e3);
    near(p.db, -10 * Math.log10(1 + 0.01), 1e-6, 'exact ≈0 dB a decade below');
    near(p.phase, -Math.atan(0.1) * 180 / Math.PI, 1e-6, 'exact phase below corner');
    p = exactPoint(tf, 1e7);
    near(p.db, -60.000000434, 1e-4, 'exact −60 dB far above');

    tf = parseTransferFunction('10/(s*(1+s/10))');
    p = exactPoint(tf, 10);
    near(p.db, 0 - 10 * Math.log10(2), 1e-6, '10/(s(1+s/10)) @10 dB');
    near(p.phase, -90 - 45, 1e-6, 'phase @10 = −135°');
    p = exactPoint(tf, 1);
    near(p.db, 20 - 10 * Math.log10(1.01), 1e-6, '@1 dB');
    near(p.phase, -90 - Math.atan(0.1) * 180 / Math.PI, 1e-6, '@1 phase');

    tf = parseTransferFunction('1/(s^2+0.14*s+1)');
    p = exactPoint(tf, 1);
    near(p.db, 20 * Math.log10(1 / 0.14), 1e-6, 'resonant peak @wn');
    // at wn: G = 1/(0 + j0.14) → phase = −atan2(0.14, 0) = −90
    near(p.phase, -90, 1e-6, 'complex pole phase @wn = −90');

    tf = parseTransferFunction('-1');
    p = exactPoint(tf, 1000);
    near(Math.abs(p.phase), 180, 1e-9, 'K=−1 phase ±180');

    // exact curve continuity/unwrap
    tf = parseTransferFunction('1/(s*(1+s/10)*(1+s/100))');
    const curve = exactCurve(tf, -1, 4, 50, null);
    let maxJump = 0;
    for (let i = 1; i < curve.length; i++) maxJump = Math.max(maxJump, Math.abs(curve[i].ph - curve[i - 1].ph));
    ok(maxJump < 30, 'phase unwrap continuity', 'max jump ' + maxJump);
    near(curve[0].ph,
        -90 - Math.atan(0.01) * 180 / Math.PI - Math.atan(0.001) * 180 / Math.PI,
        1e-6, 'unwrap start (−90° − small contributions)');
    ok(curve[curve.length - 1].ph < -250, 'unwrap ends near −270', String(curve[curve.length - 1].ph));

    // ---- asymptotic curves ----
    const mk = (src) => { const t = parseTransferFunction(src); return { tf: t, st: stateFromTF(t) }; };

    let ex = mk('1/(1+10^{-4}*s)');
    near(asymMag(ex.st, 0), 0, 1e-9, 'asym flat 0 dB low freq');
    near(asymMag(ex.st, 4), 0, 1e-9, 'asym 0 dB at corner');
    near(asymMag(ex.st, 5), -20, 1e-9, 'asym −20 one dec after');
    near(asymMag(ex.st, 6), -40, 1e-9, 'asym −40 two dec after');
    // slope check
    const sl = (asymMag(ex.st, 7) - asymMag(ex.st, 5)) / 2;
    near(sl, -20, 1e-9, 'asym slope −20 dB/dec');
    near(asymPhase(ex.st, 2), 0, 1e-9, 'asym phase 0 before');
    near(asymPhase(ex.st, 3), 0, 1e-9, 'asym phase 0 at ωc/10');
    near(asymPhase(ex.st, 4), -45, 1e-9, 'asym phase −45 at ωc');
    near(asymPhase(ex.st, 5), -90, 1e-9, 'asym phase −90 at 10ωc');
    near(asymPhase(ex.st, 6), -90, 1e-9, 'asym phase −90 after');

    ex = mk('10/s');
    near(asymMag(ex.st, 0), 20, 1e-9, '10/s @1 = 20 dB');
    near(asymMag(ex.st, 1), 0, 1e-9, '10/s @10 = 0 dB');
    near(asymPhase(ex.st, 2), -90, 1e-9, '10/s phase −90');

    ex = mk('100*s');
    near(asymMag(ex.st, 0), 40, 1e-9, '100s @1 = 40 dB');
    near(asymMag(ex.st, 2), 80, 1e-9, '100s @100 = 80 dB');
    near(asymPhase(ex.st, 0), 90, 1e-9, '100s phase +90');

    ex = mk('-5*(1+s/20)');
    near(asymPhase(ex.st, 0), 180, 1e-9, 'K<0 phase offset +180');
    near(asymPhase(ex.st, 3), 270, 1e-9, 'K<0 zero → +270');

    ex = mk('1/(s^2+0.14*s+1)');
    near(asymMag(ex.st, -1), 0, 1e-9, 'complex asym before wn = 0 dB');
    near(asymMag(ex.st, 1), -40, 1e-9, 'complex asym −40 after wn');
    const slc = (asymMag(ex.st, 2) - asymMag(ex.st, 0)) / 2;
    near(slc, -40, 1e-9, 'complex slope −40 dB/dec');
    near(asymPhase(ex.st, -1), 0, 1e-9, 'complex phase before');
    near(asymPhase(ex.st, 0), -90, 1e-9, 'complex phase at wn');
    near(asymPhase(ex.st, 1), -180, 1e-9, 'complex phase after');

    // double pole → −40 slope change
    ex = mk('1/(1+s/10)^2');
    near(asymMag(ex.st, 0), 0, 1e-9, 'double pole low');
    const sld = (asymMag(ex.st, 4) - asymMag(ex.st, 2)) / 2;
    near(sld, -40, 1e-9, 'double pole −40 dB/dec');
    near(asymPhase(ex.st, 1), -90, 1e-9, 'double pole phase at corner −90');
    near(asymPhase(ex.st, 2), -180, 1e-9, 'double pole phase after −180');

    // RHP zero: +20 mag slope; K=−1 adds +180°, the corner ramps phase down to −90°
    ex = mk('s-1');
    const slr = (asymMag(ex.st, 2) - asymMag(ex.st, 0)) / 2;
    near(slr, 20, 1e-9, 'RHP zero mag +20');
    near(asymPhase(ex.st, -1), 180, 1e-9, 'RHP zero phase before corner (+180 from K)');
    near(asymPhase(ex.st, 0), 135, 1e-9, 'RHP zero phase at corner (+135)');
    near(asymPhase(ex.st, 3), 90, 1e-9, 'RHP zero after: +180−90=+90');

    // polyline builders
    ex = mk('10*(1+s/10)/(s*(1+s/1000))');
    const mp = asymMagPoints(ex.st, -2, 6);
    ok(mp.length >= 3, 'mag polyline has corners', 'len=' + mp.length);
    ok(mp[0].x === -2 && mp[mp.length - 1].x === 6, 'mag polyline spans view');
    const xs = mp.map(p2 => p2.x);
    ok(xs.some(x => Math.abs(x - 1) < 1e-9) && xs.some(x => Math.abs(x - 3) < 1e-9), 'mag polyline has both corners');
    // phase polyline: kinks at corner∓1 decade
    const pp = asymPhasePoints(ex.st, -2, 6);
    ok(pp[0].x === -2 && pp[pp.length - 1].x === 6, 'phase polyline spans view');
    ok(pp.some(p2 => Math.abs(p2.x - 0) < 1e-9) && pp.some(p2 => Math.abs(p2.x - 4) < 1e-9), 'phase polyline kinks at w/10 & 10w');

    // ---- check algorithm ----
    tf = parseTransferFunction('10*(1+s/10)/(s*(1+s/1000))');
    const truth = stateFromTF(tf);

    // perfect user
    let r = checkSolution(tf, JSON.parse(JSON.stringify(truth)));
    ok(r.items.every(it => it.ok) && r.score.ok === r.score.total,
        'check: perfect score', JSON.stringify(r.items.filter(i => !i.ok)));

    // wrong gain
    let bad = JSON.parse(JSON.stringify(truth));
    bad.gainDB = truth.gainDB + 6;
    r = checkSolution(tf, bad);
    ok(r.items.some(it => it.kind === 'gain' && !it.ok), 'check: flags wrong gain');

    // moved pole (0.5 decade away)
    bad = JSON.parse(JSON.stringify(truth));
    bad.elems.find(e => e.type === 'pole' && Math.abs(Math.log10(e.w / 1000)) < 0.2).w = 3162;
    r = checkSolution(tf, bad);
    ok(r.items.some(it => !it.ok && /Missing/.test(it.text)), 'check: flags moved pole');
    ok(r.items.some(it => !it.ok && /Extra/.test(it.text)), 'check: flags extra pole');

    // order mismatch
    bad = JSON.parse(JSON.stringify(truth));
    bad.elems.find(e => e.type === 'zero').order = 2;
    r = checkSolution(tf, bad);
    ok(r.items.some(it => !it.ok && /order/.test(it.text)), 'check: flags order mismatch');

    // split double pole (two elems) still matches a single ×2 true pole
    tf = parseTransferFunction('1/(1+s/10)^2');
    const truth2 = stateFromTF(tf);
    const split = JSON.parse(JSON.stringify(truth2));
    const dp = split.elems.pop();
    split.elems.push({ type: 'pole', kind: 'real', w: dp.w * 1.02, rhp: false, order: 1 });
    split.elems.push({ type: 'pole', kind: 'real', w: dp.w * 0.98, rhp: false, order: 1 });
    r = checkSolution(tf, split);
    ok(r.items.every(it => it.ok), 'check: split double pole matches ×2', JSON.stringify(r.items.filter(i => !i.ok)));

    // complex pair vs double real diagnostic
    tf = parseTransferFunction('1/(s^2+0.14*s+1)');
    const truth3 = stateFromTF(tf);
    const wrong = JSON.parse(JSON.stringify(truth3));
    wrong.elems = [
        { type: 'pole', kind: 'real', w: 1, rhp: false, order: 1 },
        { type: 'pole', kind: 'real', w: 1, rhp: false, order: 1 },
    ];
    r = checkSolution(tf, wrong);
    ok(r.items.some(it => !it.ok && /complex pair/.test(it.text)), 'check: complex-vs-double-real hint',
        JSON.stringify(r.items));

    // missing origin
    tf = parseTransferFunction('10/(s*(1+s/10))');
    const t4 = stateFromTF(tf);
    const noOrig = JSON.parse(JSON.stringify(t4));
    noOrig.p0 = 0;
    r = checkSolution(tf, noOrig);
    ok(r.items.some(it => it.kind === 'origin' && !it.ok && /Poles at origin/.test(it.text)),
        'check: flags missing integrator');

    // negative K sign check
    tf = parseTransferFunction('-10*(1+s/10)');
    const t5 = stateFromTF(tf);
    ok(t5.gainSign === -1, 'stateFromTF sign');
    const noSign = JSON.parse(JSON.stringify(t5));
    noSign.gainSign = 1;
    r = checkSolution(tf, noSign);
    ok(r.items.some(it => it.kind === 'sign' && !it.ok), 'check: flags missing K sign');
    r = checkSolution(tf, t5);
    ok(r.items.every(it => it.ok), 'check: negative K perfect', JSON.stringify(r.items.filter(i => !i.ok)));

    // ---- graph-mirroring off: each graph is checked on its own ----
    tf = parseTransferFunction('1/(1+s/10)');
    const tMir = stateFromTF(tf);
    const splitPlots = JSON.parse(JSON.stringify(tMir));
    splitPlots.elems = splitPlots.elems.map(e => Object.assign({}, e, { plots: ['mag'] }))
        .concat(tMir.elems.map(e => Object.assign({}, e, { plots: ['ph'] })));
    r = checkSolution(tf, splitPlots);
    ok(r.items.every(it => it.ok), 'check: mirrored split drawing scores perfect',
        JSON.stringify(r.items.filter(i => !i.ok)));
    ok(r.items.filter(it => it.kind === 'elem').length === 2,
        'check: one element item per graph', String(r.items.filter(it => it.kind === 'elem').length));
    ok(r.items.some(it => it.plot === 'mag') && r.items.some(it => it.plot === 'ph'),
        'check: element items carry their graph');
    ok(r.items.filter(it => it.kind === 'gain' || it.kind === 'origin').every(it => !it.plot),
        'check: shared gain/origin stay graph-agnostic');
    // same elements on both graphs (mirroring on) → a single untagged pass
    r = checkSolution(tf, JSON.parse(JSON.stringify(tMir)));
    ok(r.items.every(it => it.ok) && r.items.every(it => !it.plot),
        'check: mirrored drawing checked once, untagged',
        JSON.stringify(r.items.filter(i => !i.ok)));
    const coal = coalesceMirrored(splitPlots.elems);
    ok(coal.length === 1 && coal[0].order === 1, 'coalesce: folds disjoint-plot twins',
        'len=' + coal.length + ' order=' + (coal[0] && coal[0].order));
    ok(coal[0].plots.length === 2, 'coalesce: unions plots');
    // same-graph duplicates must still sum orders (pre-existing behaviour)
    const sameGraph = [
        { type: 'pole', kind: 'real', w: 10, order: 1, plots: ['mag'] },
        { type: 'pole', kind: 'real', w: 10, order: 1, plots: ['mag'] },
    ];
    const cSame = coalesceMirrored(sameGraph);
    ok(cSame.length === 2, 'coalesce: same-graph twins stay separate', 'len=' + cSame.length);
    const clSame = clusterElems(cSame, 0.026);
    ok(clSame.length === 1 && clSame[0].order === 2, 'coalesce: same-graph orders still sum',
        'len=' + clSame.length + ' order=' + (clSame[0] && clSame[0].order));

    // magnitude graph right, phase graph never drawn → phase flagged, mag clean
    const magOnly = JSON.parse(JSON.stringify(tMir));
    magOnly.elems = magOnly.elems.map(e => Object.assign({}, e, { plots: ['mag'] }));
    r = checkSolution(tf, magOnly);
    ok(r.items.filter(it => it.plot === 'mag').every(it => it.ok),
        'check: mag-only drawing is clean on the magnitude graph',
        JSON.stringify(r.items.filter(i => i.plot === 'mag' && !i.ok)));
    ok(r.items.some(it => it.plot === 'ph' && !it.ok && /^Missing on the phase graph/.test(it.text)),
        'check: flags element missing on the phase graph',
        JSON.stringify(r.items.filter(i => !i.ok)));
    ok(r.items.every(it => it.ok || it.plot === 'ph'),
        'check: mag-only drawing reports nothing against the magnitude graph',
        JSON.stringify(r.items.filter(i => !i.ok)));

    // extra element on the phase graph only
    const phExtra = JSON.parse(JSON.stringify(splitPlots));
    phExtra.elems.push({ type: 'zero', kind: 'real', w: 100, rhp: false, order: 1, plots: ['ph'] });
    r = checkSolution(tf, phExtra);
    ok(r.items.filter(it => it.plot === 'mag').every(it => it.ok),
        'check: extra on phase leaves magnitude clean',
        JSON.stringify(r.items.filter(i => i.plot === 'mag' && !i.ok)));
    ok(r.items.some(it => it.plot === 'ph' && it.kind === 'extra' && !it.ok),
        'check: flags extra element drawn on the phase graph',
        JSON.stringify(r.items.filter(i => !i.ok)));

    // corner frequency moved on the phase graph only
    const phMoved = JSON.parse(JSON.stringify(splitPlots));
    phMoved.elems.find(e => e.plots[0] === 'ph').w = 100;
    r = checkSolution(tf, phMoved);
    ok(r.items.filter(it => it.plot === 'mag').every(it => it.ok),
        'check: moved phase corner leaves magnitude clean',
        JSON.stringify(r.items.filter(i => i.plot === 'mag' && !i.ok)));
    ok(r.items.some(it => it.plot === 'ph' && /^Missing on the phase graph/.test(it.text)) &&
        r.items.some(it => it.plot === 'ph' && /^Extra on the phase graph/.test(it.text)),
        'check: moved corner reports missing+extra on the phase graph',
        JSON.stringify(r.items.filter(i => !i.ok)));

    // order short by one on the phase graph only (would slip through a union check)
    tf = parseTransferFunction('1/(1+s/10)^2');
    const tDbl = stateFromTF(tf);
    const dblSplit = JSON.parse(JSON.stringify(tDbl));
    dblSplit.elems = dblSplit.elems.map(e => Object.assign({}, e, { plots: ['mag'] }))
        .concat(tDbl.elems.map(e => Object.assign({}, e, { order: 1, plots: ['ph'] })));
    r = checkSolution(tf, dblSplit);
    ok(r.items.filter(it => it.plot === 'mag').every(it => it.ok),
        'check: ×2 on magnitude still correct',
        JSON.stringify(r.items.filter(i => i.plot === 'mag' && !i.ok)));
    ok(r.items.some(it => it.plot === 'ph' && !it.ok && /expected order ×2, you drew ×1/.test(it.text)),
        'check: flags short order on the phase graph',
        JSON.stringify(r.items.filter(i => !i.ok)));

    // ---- misc helpers ----
    near(Math.log10(1000), 3, 1e-12, 'log10 sanity');
    ok(fmtW(1e4).indexOf('10') === 0, 'fmtW uses power form', fmtW(1e4));

    // ---- TeX preview rendering (k, num, den) ----
    let h = texPreview('1', '1', '1+10^{-4}s');
    ok(h.indexOf('<i>G</i>(<i>s</i>)') === 0, 'tex: G(s) head', h);
    ok(h.indexOf('<span class="frac">') !== -1, 'tex: stacked fraction', h);
    ok(h.indexOf('<i>s</i>') !== -1, 'tex: italic s', h);
    ok(h.indexOf('10⁻⁴') !== -1, 'tex: 10^-4 superscript', h);

    h = texPreview('1', '10*(1+s/10)', 's*(1+s/1000)');
    ok(h.indexOf('10&nbsp;·&nbsp;') === -1, 'tex: no constant peeled from numerator', h);
    ok(h.indexOf('1 + <i>s</i>/10') !== -1, 'tex: numerator factor still present', h);
    ok(h.indexOf('<i>s</i>(1 + <i>s</i>/1000)') !== -1, 'tex: denominator juxtaposition', h);
    ok(h.indexOf('<span class="frac">') !== -1, 'tex: product over product stacks', h);
    ok(h.indexOf('<span class="fn">10(1 + <i>s</i>/10)</span>') !== -1, 'tex: constant stays in numerator', h);

    h = texPreview('1', '2*10^4', 's^2+1.4*s+100');
    ok(h.indexOf('&nbsp;·&nbsp;') === -1, 'tex: no gain prefix beside fraction', h);
    ok(h.indexOf('<span class="fn">2·10⁴</span>') !== -1, 'tex: 2·10⁴ stays in numerator', h);
    ok(h.indexOf('<i>s</i>²') !== -1, 'tex: s^2 superscript', h);
    ok(h.indexOf('1.4<i>s</i>') !== -1, 'tex: 1.4s juxtaposition', h);

    h = texPreview('1', '1', '1+10^{-4}s');
    ok(h.indexOf('&nbsp;·&nbsp;') === -1, 'tex: K=1 omitted', h);

    h = texPreview('1', '(s+1)*(s+2)', '1');
    ok(h.indexOf('(<i>s</i> + 1)(<i>s</i> + 2)') !== -1, 'tex: additive factors parenthesized', h);

    h = texPreview('1', 's', 's+1');
    ok(h.indexOf('<span class="fn"><i>s</i></span>') !== -1, 'tex: root always stacks', h);
    ok(h.indexOf('<span class="fd"><i>s</i> + 1</span>') !== -1, 'tex: denominator add inline', h);

    h = texPreview('1', '1+s', '');
    ok(h.indexOf('frac') === -1, 'tex: no fraction when denominator empty', h);
    ok(h.indexOf('1 + <i>s</i>') !== -1, 'tex: inline add when no denominator', h);

    h = texPreview('1', '\\frac{1}{1+s}', '');
    ok(h.indexOf('<span class="frac">') !== -1, 'tex: LaTeX \\frac inside a field', h);

    h = texPreview('1', 'bad(((', '1+s');
    ok(h.indexOf('tex-raw') !== -1, 'tex: fallback on parse error', h);

    h = texPreview('1', '<img>', '');
    ok(h.indexOf('&lt;img&gt;') !== -1, 'tex: fallback escapes HTML', h);

    h = texPreview('1', '', '');
    ok(h.indexOf('tex-ph') !== -1, 'tex: placeholder when empty', h);

    ok(normalizeInput('10⁻⁴s') === '10^(-4)s', 'norm: unicode superscript 10⁻⁴', normalizeInput('10⁻⁴s'));
    ok(normalizeInput('s²+1') === 's^(2)+1', 'norm: unicode superscript s²', normalizeInput('s²+1'));
    ok(normalizeInput('10⁺³') === '10^(3)', 'norm: unicode superscript 10⁺³', normalizeInput('10⁺³'));
    h = texPreview('1', '1', '1+10⁻⁴s');
    ok(h.indexOf('tex-raw') === -1, 'tex: unicode input parses', h);
    ok(h.indexOf('10⁻⁴') !== -1, 'tex: unicode input renders 10⁻⁴', h);

    h = texPreview('10', '1', '1+s');
    ok(h.indexOf('10&nbsp;·&nbsp;') !== -1 &&
        h.indexOf('<span class="fn">1</span>') !== -1 &&
        h.indexOf('<span class="fd">1 + <i>s</i></span>') !== -1,
        'tex: K field beside fraction parts', h);

    h = texPreview('1', '-2*(1+s)', '1+s');
    ok(h.indexOf('−2') !== -1, 'tex: negative scalar keeps unicode minus', h);

    h = texPreview('1', '(s+1)', '2');
    ok(h.indexOf('<span class="frac">') !== -1 &&
        h.indexOf('<span class="fd">2</span>') !== -1,
        'tex: scalar denominator stays a fraction', h);

    h = texPreview('2', '1+s', 's');
    ok(h.indexOf('2&nbsp;·&nbsp;') !== -1 && h.indexOf('<span class="fd"><i>s</i></span>') !== -1,
        'tex: explicit K field renders beside fraction', h);

    h = texPreview('2*10^4', '1+s', 's');
    ok(h.indexOf('2·10⁴') !== -1, 'tex: K field accepts 2*10^4', h);

    ok(tfExpr('1', '1', '1+s') === '(1)/(1+s)', 'tfExpr: K=1 omitted', tfExpr('1', '1', '1+s'));
    ok(tfExpr('10', '1', '1+s') === '(10)*(1)/(1+s)', 'tfExpr: K folded in', tfExpr('10', '1', '1+s'));
    ok(tfExpr('1', '', '') === '', 'tfExpr: empty → blank', tfExpr('1', '', ''));
    ok(tfExpr('5', '1+s', '') === '(5)*(1+s)', 'tfExpr: no denominator', tfExpr('5', '1+s', ''));

    return { passed, failed: failures.length, failures };
}

A.selfTest = selfTest;

})(globalThis.BodeMath = globalThis.BodeMath || {});
