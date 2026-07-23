// Generates version.json at deploy time so the app can show which build is
// live. Run by Vercel via the "buildCommand" in vercel.json.
//
// Vercel sets VERCEL_GIT_COMMIT_SHA automatically for Git-linked projects:
//   https://vercel.com/docs/environment-variables/system-environment-variables
//
// Running this locally (where that variable doesn't exist) writes "dev", and
// the app treats a missing/failed version.json as "no version to show" - so
// nothing breaks either way.
const fs = require('fs');
const path = require('path');

const sha = process.env.VERCEL_GIT_COMMIT_SHA || '';
const payload = {
    commit: sha ? sha.slice(0, 7) : 'dev',
    // Date only - a full timestamp is noise in a sidebar footer.
    builtAt: new Date().toISOString().slice(0, 10)
};

const out = path.join(__dirname, '..', 'version.json');
fs.writeFileSync(out, JSON.stringify(payload) + '\n', 'utf8');
console.log('Wrote version.json:', JSON.stringify(payload));
