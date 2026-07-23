// Generates version.json at deploy time so the app can show which build is
// live. Run by Vercel via the "buildCommand" in vercel.json.
//
// The visible version is BASE_VERSION + an auto patch number = the repo's
// total commit count, so it climbs on its own with every deploy.
//
// Getting that count on Vercel takes some care: Vercel clones shallowly, so a
// naive `git rev-list --count` reports 1 and the version would appear to go
// BACKWARDS. We therefore try, in order:
//   1. re-deepen the clone from the PUBLIC repo URL (Vercel's own remote has
//      no credentials in the build sandbox, which is why a plain
//      `git fetch --unshallow` fails there), then count locally;
//   2. ask the GitHub API for the count (works for public repos, no auth);
//   3. give up and publish just BASE_VERSION - never a number we know is wrong.
//
// Locally there's no VERCEL_* env at all, so this writes "dev" and the app
// hides the stamp entirely.
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

// ---- BUMP THIS for a real release. -----------------------------------------
// Major.minor only - the patch number fills itself in.
//   1.0 -> 1.1  new features
//   1.1 -> 2.0  big rework
const BASE_VERSION = '1.0';
// ----------------------------------------------------------------------------

const OWNER = process.env.VERCEL_GIT_REPO_OWNER || '';
const SLUG = process.env.VERCEL_GIT_REPO_SLUG || '';

function sh(cmd) {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function isShallow() {
    try { return sh('git rev-parse --is-shallow-repository') === 'true'; } catch (err) { return false; }
}

// (1) Count from local git, deepening the clone first if needed.
function countFromGit() {
    try {
        if (isShallow()) {
            // Fetch from the public URL rather than the configured remote:
            // Vercel's remote needs credentials the build sandbox doesn't have.
            if (OWNER && SLUG) {
                try {
                    sh(`git fetch --unshallow https://github.com/${OWNER}/${SLUG}.git`);
                } catch (err) { /* fall through to the shallow re-check */ }
            }
        }
        if (isShallow()) return null;
        const n = parseInt(sh('git rev-list --count HEAD'), 10);
        return Number.isFinite(n) && n > 0 ? n : null;
    } catch (err) {
        return null;
    }
}

// (2) Count via the GitHub API. Asking for one commit per page makes the
// "last" link's page number equal to the total commit count.
function countFromGitHub() {
    return new Promise(resolve => {
        if (!OWNER || !SLUG) return resolve(null);
        const req = https.request({
            host: 'api.github.com',
            path: `/repos/${OWNER}/${SLUG}/commits?per_page=1&sha=${process.env.VERCEL_GIT_COMMIT_REF || 'main'}`,
            method: 'HEAD',
            headers: { 'User-Agent': 'bullion-book-build', 'Accept': 'application/vnd.github+json' }
        }, res => {
            const link = res.headers.link || '';
            const match = link.match(/[?&]page=(\d+)>;\s*rel="last"/);
            res.resume();
            resolve(match ? parseInt(match[1], 10) : null);
        });
        req.on('error', () => resolve(null));
        req.setTimeout(8000, () => { req.destroy(); resolve(null); });
        req.end();
    });
}

async function main() {
    let patch = countFromGit();
    if (patch !== null) {
        console.log('write-version: commit count from git =', patch);
    } else {
        patch = await countFromGitHub();
        if (patch !== null) console.log('write-version: commit count from GitHub API =', patch);
        else console.log('write-version: no commit count available, publishing base version only.');
    }

    const sha = process.env.VERCEL_GIT_COMMIT_SHA || '';
    const payload = {
        version: patch === null ? BASE_VERSION : BASE_VERSION + '.' + patch,
        commit: sha ? sha.slice(0, 7) : 'dev',
        // Date only - a full timestamp is noise in a sidebar footer.
        builtAt: new Date().toISOString().slice(0, 10)
    };

    fs.writeFileSync(path.join(__dirname, '..', 'version.json'),
                     JSON.stringify(payload) + '\n', 'utf8');
    console.log('Wrote version.json:', JSON.stringify(payload));
}

main();
