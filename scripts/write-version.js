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
const { execSync } = require('child_process');

// ---- BUMP THIS for a real release. -----------------------------------------
// Major.minor only - the patch number is the commit count and fills itself in
// (see commitCount below), so this changes maybe a few times a year:
//   1.0 -> 1.1  new features
//   1.1 -> 2.0  big rework
const BASE_VERSION = '1.0';
// ----------------------------------------------------------------------------

function sh(cmd) {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

// Total commits on the branch, used as the auto patch number.
//
// The catch: Vercel clones shallowly, so a naive `git rev-list --count` would
// report something like 1 and the version would appear to go BACKWARDS between
// deploys. So we deepen the clone first, and if it's still shallow afterwards
// we return null and fall back to the plain base version rather than publish a
// number we know is wrong.
function commitCount() {
    try {
        if (sh('git rev-parse --is-shallow-repository') === 'true') {
            try {
                sh('git fetch --unshallow');
            } catch (err) {
                // Network/credentials unavailable in the build sandbox - fine,
                // the shallow re-check below decides what to do.
            }
        }
        if (sh('git rev-parse --is-shallow-repository') === 'true') {
            console.log('write-version: history still shallow, omitting patch number.');
            return null;
        }
        const n = parseInt(sh('git rev-list --count HEAD'), 10);
        return Number.isFinite(n) && n > 0 ? n : null;
    } catch (err) {
        console.log('write-version: git unavailable (' + err.message + '), omitting patch number.');
        return null;
    }
}

const patch = commitCount();
const sha = process.env.VERCEL_GIT_COMMIT_SHA || '';
const payload = {
    version: patch === null ? BASE_VERSION : BASE_VERSION + '.' + patch,
    commit: sha ? sha.slice(0, 7) : 'dev',
    // Date only - a full timestamp is noise in a sidebar footer.
    builtAt: new Date().toISOString().slice(0, 10)
};

const out = path.join(__dirname, '..', 'version.json');
fs.writeFileSync(out, JSON.stringify(payload) + '\n', 'utf8');
console.log('Wrote version.json:', JSON.stringify(payload));
