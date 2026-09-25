/* Node runner for the asymbode self-tests:  node selftest.js
 *
 * The math and app modules are plain browser scripts that register themselves
 * on globalThis.BodeMath / globalThis.BodeApp, so requiring them in index.html
 * order is enough (window is aliased to the global object first). */
'use strict';

globalThis.window = globalThis;

const MATH_MODULES = [
    'format', 'parse', 'poly', 'factor', 'curves', 'check', 'tex', 'selftest',
];

const APP_MODULES = [
    'state', 'util', 'view', 'zoom', 'pointer', 'selftest',
];

for (const name of MATH_MODULES) require('./math/' + name + '.js');
for (const name of APP_MODULES) require('./app/' + name + '.js');

const SUITES = [
    ['math', globalThis.BodeMath.selfTest()],
    ['app', globalThis.BodeApp.selfTest()],
];

let passed = 0, failed = 0;
for (const [name, suite] of SUITES) {
    passed += suite.passed;
    failed += suite.failed;
    for (const f of suite.failures) console.log('  ✗ [' + name + '] ' + f);
}
console.log('self-test: ' + passed + ' passed, ' + failed + ' failed');

process.exit(failed ? 1 : 0);
