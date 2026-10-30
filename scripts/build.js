// Production build - run by Vercel ("buildCommand" in vercel.json), output in
// dist/ (vercel.json "outputDirectory"). It:
//   1. writes version.json (write-version.js)
//   2. minifies every first-party .js/.css with esbuild - comments,
//      whitespace and local variable names go (~half the size). Top-level
//      names stay exactly as they are - the pages' onclick="..." handlers
//      and the other scripts call them by name - and no syntax is
//      rewritten, so the result runs in the same browsers as the source.
//   3. stamps every <script src>/<link href> to one of those files with
//      ?v=<hash of its content>, so a browser fetches a file again exactly
//      when it changed. The hand-bumped ?v= numbers in the HTML no longer
//      matter for the live site (they still help when testing locally).
//   4. copies the rest of the site - pages, images, the chart data (as
//      hard links: instant, no extra disk space) and the MetaTrader script
//      downloads - and refuses to finish if any page points at a file that
//      isn't there.
//
// Locally:  npm install   (once, for esbuild)   then   npm run build
// Your own files are never modified - everything goes to dist/.
// --skip-data leaves out data/ (CI does this - it doesn't check the charts).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist');
const SKIP_DATA = process.argv.includes('--skip-data');

// Root files that configure the project rather than being part of the site
const NOT_SITE = new Set(['package.json', 'package-lock.json', 'vercel.json', 'firebase.json', 'firestore.rules']);

let esbuild;
try {
    esbuild = require('esbuild');
} catch (err) {
    console.error('build: esbuild is not installed - run "npm install" first.');
    process.exit(1);
}

function fail(message) {
    console.error(`build: ${message}`);
    process.exit(1);
}

function hash(content) {
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 10);
}

function linkOrCopy(from, to) {
    try {
        fs.linkSync(from, to);
    } catch (err) {
        fs.copyFileSync(from, to);
    }
}

function copyTree(fromDir, toDir, keep) {
    fs.mkdirSync(toDir, { recursive: true });
    let count = 0;
    fs.readdirSync(fromDir, { withFileTypes: true }).forEach(entry => {
        const from = path.join(fromDir, entry.name);
        const to = path.join(toDir, entry.name);
        if (entry.isDirectory()) count += copyTree(from, to, keep);
        else if (!keep || keep(entry.name)) {
            linkOrCopy(from, to);
            count++;
        }
    });
    return count;
}

// Every name a script declares at its top level (functions, let/const/var)
function topLevelNames(code) {
    const names = new Set();
    code.split('\n').forEach(line => {
        const m = line.match(/^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/) || line.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/);
        if (m) names.add(m[1]);
    });
    return names;
}

function main() {
    // 1. version.json (in the repo root - it's gitignored - then copied)
    execFileSync(process.execPath, [path.join(__dirname, 'write-version.js')], { stdio: 'inherit' });

    fs.rmSync(OUT, { recursive: true, force: true });
    fs.mkdirSync(OUT, { recursive: true });

    const rootFiles = fs.readdirSync(ROOT, { withFileTypes: true })
        .filter(e => e.isFile() && !e.name.startsWith('.') && !NOT_SITE.has(e.name))
        .map(e => e.name);

    // 2. minify
    const stamps = {};
    let before = 0;
    let after = 0;
    rootFiles.filter(f => /\.(js|css)$/.test(f)).forEach(file => {
        const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
        const loader = file.endsWith('.css') ? 'css' : 'js';
        let result;
        try {
            result = esbuild.transformSync(source, { loader, minify: true, treeShaking: false, legalComments: 'none', sourcefile: file });
        } catch (err) {
            fail(`could not minify ${file}: ${err.message}`);
        }
        const code = result.code;
        if (loader === 'js') {
            // Belt and braces: every top-level name must survive, or the
            // pages' handlers / other scripts would hit "is not defined"
            const lost = Array.from(topLevelNames(source)).filter(name => !new RegExp(`(^|[^\\w$.])${name.replace(/\$/g, '\\$')}([^\\w$]|$)`).test(code));
            if (lost.length) fail(`${file}: minifying renamed top-level names: ${lost.join(', ')}`);
        }
        fs.writeFileSync(path.join(OUT, file), code);
        stamps[file] = hash(code);
        before += Buffer.byteLength(source);
        after += Buffer.byteLength(code);
    });

    // 3. pages, with content-hash stamps on the files above
    rootFiles.filter(f => !/\.(js|css)$/.test(f)).forEach(file => {
        if (!file.endsWith('.html')) {
            linkOrCopy(path.join(ROOT, file), path.join(OUT, file));
            return;
        }
        const html = fs.readFileSync(path.join(ROOT, file), 'utf8')
            .replace(/(\s(?:src|href)=")([\w.-]+\.(?:js|css))(?:\?v=[^"]*)?"/g, (whole, start, name) =>
                (stamps[name] ? `${start}${name}?v=${stamps[name]}"` : whole));
        fs.writeFileSync(path.join(OUT, file), html);
    });

    // 4. everything else the site serves
    let copied = copyTree(path.join(ROOT, 'images'), path.join(OUT, 'images'));
    copied += copyTree(path.join(ROOT, 'scripts'), path.join(OUT, 'scripts'), name => /\.(mq4|mq5)$/.test(name));
    if (!SKIP_DATA) copied += copyTree(path.join(ROOT, 'data'), path.join(OUT, 'data'));

    // Every local file a page refers to must be in dist/
    const missing = [];
    fs.readdirSync(OUT).filter(f => f.endsWith('.html')).forEach(page => {
        const html = fs.readFileSync(path.join(OUT, page), 'utf8');
        (html.match(/\s(?:src|href)="[^"]*"/g) || []).forEach(attr => {
            const url = attr.replace(/^\s(?:src|href)="/, '').replace(/"$/, '').split(/[?#]/)[0];
            if (!url || /^(?:[a-z]+:|\/\/|#|\$\{)/i.test(url) || url === './' || url === '/' || url.startsWith('/api/')) return;
            if (!fs.existsSync(path.join(OUT, url.replace(/^\.?\//, '')))) missing.push(`${page} -> ${url}`);
        });
    });
    if (missing.length) fail(`pages point at files that aren't in the build:\n  ${missing.join('\n  ')}`);

    const kb = n => `${Math.round(n / 1024)} KB`;
    console.log(`build: minified ${Object.keys(stamps).length} files, ${kb(before)} -> ${kb(after)}; copied ${copied} other files${SKIP_DATA ? ' (data/ skipped)' : ''} into dist/`);
}

main();
