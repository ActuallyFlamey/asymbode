/* Node runner for the asymbode-math self-tests:  node selftest.js
 *
 * The math modules are plain browser scripts that register themselves on
 * globalThis.BodeMath, so requiring them in index.html order is enough. */
'use strict';

const MATH_MODULES = [
    'format', 'parse', 'poly', 'factor', 'curves', 'check', 'tex', 'selftest',
];

for (const name of MATH_MODULES) require('./math/' + name + '.js');

const { passed, failed, failures } = globalThis.BodeMath.selfTest();

console.log('self-test: ' + passed + ' passed, ' + failed + ' failed');
for (const f of failures) console.log('  ✗ ' + f);

process.exit(failed ? 1 : 0);
