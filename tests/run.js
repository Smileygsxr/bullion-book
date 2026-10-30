// Runs every tests/*.test.js suite.  Usage:  node tests/run.js
// Exits non-zero if any test fails (that's what fails the CI check).
const fs = require('fs');
const path = require('path');
const harness = require('./harness');

const suites = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort();
for (const file of suites) {
    // Each suite registers its tests with the shared harness
    require(path.join(__dirname, file))(harness);
}

harness.runAll().then(failed => process.exit(failed > 0 ? 1 : 0));
