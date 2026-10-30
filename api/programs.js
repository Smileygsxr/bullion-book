// Password-protected Programs area (Settings > Programs).
//
// Everything in the repository's /programs folder is served ONLY through this
// function, after a password check - scripts/build.js never publishes that
// folder as ordinary public files, so there's no way around the check.
// vercel.json routes /programs and /programs/* here.
//
// The password is DEFAULT_PASSWORD below - a temporary one, until the
// Programs page opens to the public. Setting a PROGRAMS_PASSWORD environment
// variable in Vercel (Project > Settings > Environment Variables) replaces it.
//
// A correct password gets the browser a signed, HttpOnly cookie for 12 hours.
// It's signed with the password itself, so changing the password logs every
// session out. Any file type can go in the folder: web pages open in the
// browser, everything else (EAs, indicators, scripts, archives...) downloads.
// With no index.html, a folder shows an automatic list of what's in it.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const COOKIE = 'bb_programs';
const SESSION_SECONDS = 12 * 60 * 60;
const DEFAULT_PASSWORD = '1234'; // temporary - until the page opens to the public

// Opened in the browser; anything not listed here downloads as a file
const INLINE_TYPES = {
    '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.webm': 'video/webm',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.woff': 'font/woff', '.woff2': 'font/woff2'
};

function programsDir() {
    return process.env.BB_PROGRAMS_DIR || path.join(process.cwd(), 'programs');
}

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Compares two strings in constant time (hashing first evens out the lengths)
function sameText(a, b) {
    const ha = crypto.createHash('sha256').update(String(a)).digest();
    const hb = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
}

function sign(password, expires) {
    return crypto.createHmac('sha256', password).update(`bullion-book-programs:${expires}`).digest('hex');
}

function readCookie(req, name) {
    const found = String(req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${name}=`));
    return found ? decodeURIComponent(found.slice(name.length + 1)) : '';
}

function hasSession(req, password) {
    const [exp, sig] = readCookie(req, COOKIE).split('.');
    const expires = Number(exp);
    return Number.isFinite(expires) && expires * 1000 > Date.now() && !!sig && sameText(sig, sign(password, expires));
}

// "Authorization: Basic ..." (e.g. curl -u any:password) also works
function hasBasicAuth(req, password) {
    const header = String(req.headers.authorization || '');
    if (!/^Basic /i.test(header)) return false;
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    return sameText(decoded.slice(decoded.indexOf(':') + 1), password);
}

function send(res, status, body, type) {
    res.statusCode = status;
    res.setHeader('Content-Type', type || 'text/html; charset=utf-8');
    res.end(body);
}

function redirect(res, status, location) {
    res.statusCode = status;
    res.setHeader('Location', location);
    res.end();
}

// /programs/<each segment URL-encoded>
function programsUrl(relative) {
    return `/programs/${relative.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`;
}

function shell(title, body) {
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${escapeHtml(title)} - Bullion Book</title>
<style>
  body { margin: 0; min-height: 100vh; background: #131722; color: #d1d4dc; font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 32px 16px; }
  a { color: #dfb15b; }
  h1 { font-size: 1.4rem; margin: 0 0 4px; }
  .muted { color: #848e9c; font-size: 0.85rem; }
  .card { background: #1c2030; border: 1px solid #2a2e39; border-radius: 12px; padding: 20px; margin-top: 18px; }
  .top { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
  input[type=password] { width: 100%; box-sizing: border-box; padding: 10px 12px; margin: 10px 0; background: #131722; color: #d1d4dc; border: 1px solid #2a2e39; border-radius: 8px; font-size: 1rem; }
  button { padding: 10px 18px; background: #2979ff; color: #fff; border: 0; border-radius: 8px; font-weight: 700; font-size: 0.95rem; cursor: pointer; }
  .error { color: #f6465d; }
  ul { list-style: none; margin: 0; padding: 0; }
  li a { display: flex; justify-content: space-between; gap: 12px; padding: 12px 14px; border-bottom: 1px solid #2a2e39; text-decoration: none; color: #d1d4dc; }
  li:last-child a { border-bottom: 0; }
  li a:hover { background: #222738; }
  .size { color: #848e9c; font-size: 0.8rem; white-space: nowrap; }
</style></head>
<body><main>${body}</main></body></html>`;
}

function loginPage(message) {
    return shell('Programs', `
  <h1>Programs</h1>
  <p class="muted">This area is password-protected.</p>
  <div class="card">
    <form method="post">
      <label for="password">Password</label>
      <input type="password" id="password" name="password" autocomplete="current-password" autofocus required>
      ${message ? `<p class="error">${escapeHtml(message)}</p>` : ''}
      <button type="submit">Open Programs</button>
    </form>
  </div>
  <p class="muted"><a href="/app.html">&larr; Back to Bullion Book</a></p>`);
}

function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function listingPage(dir, relative) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
        .filter(e => !e.name.startsWith('.') && !(relative === '' && /^README\.md$/i.test(e.name)))
        .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
    const items = entries.map(e => {
        const rel = relative ? `${relative}/${e.name}` : e.name;
        const size = e.isDirectory() ? 'folder' : formatSize(fs.statSync(path.join(dir, e.name)).size);
        return `<li><a href="${escapeHtml(programsUrl(rel) + (e.isDirectory() ? '/' : ''))}"><span>${e.isDirectory() ? '&#128193;' : '&#128196;'} ${escapeHtml(e.name)}</span><span class="size">${size}</span></a></li>`;
    }).join('');
    const up = relative ? `<a href="${escapeHtml(relative.includes('/') ? `${programsUrl(relative.split('/').slice(0, -1).join('/'))}/` : '/programs/')}">&larr; Up</a> &middot; ` : '';
    return shell('Programs', `
  <div class="top">
    <div><h1>Programs${relative ? ` / ${escapeHtml(relative)}` : ''}</h1><p class="muted">${up}<a href="/app.html">Back to Bullion Book</a></p></div>
    <a href="/programs/?logout=1">Log out</a>
  </div>
  <div class="card">${items ? `<ul>${items}</ul>` : '<p class="muted">Nothing here yet - add files to the programs folder in the repository and redeploy.</p>'}</div>`);
}

// The requested path inside the programs folder, or null if it tries to
// leave it (".." segments, absolute paths, hidden files)
function resolveInside(requested) {
    let clean;
    try {
        clean = decodeURIComponent(String(requested || '')).replace(/\\/g, '/');
    } catch (e) {
        return null;
    }
    const segments = clean.split('/').filter(Boolean);
    if (segments.some(s => s === '..' || s.startsWith('.'))) return null;
    const root = path.resolve(programsDir());
    const full = path.resolve(root, ...segments);
    if (full !== root && !full.startsWith(root + path.sep)) return null;
    return { full, relative: segments.join('/') };
}

function serve(res, requested) {
    const target = resolveInside(requested);
    if (!target) return send(res, 400, shell('Not allowed', '<h1>Not allowed</h1><p><a href="/programs/">Back to Programs</a></p>'));
    let stat;
    try {
        stat = fs.statSync(target.full);
    } catch (e) {
        return send(res, 404, shell('Not found', `<h1>Not found</h1><p class="muted">${escapeHtml(target.relative)}</p><p><a href="/programs/">Back to Programs</a></p>`));
    }
    if (stat.isDirectory()) {
        // A folder's own index.html is opened by its full address, so links
        // inside it resolve relative to the folder
        if (target.relative && fs.existsSync(path.join(target.full, 'index.html'))) {
            return redirect(res, 302, `${programsUrl(target.relative)}/index.html`);
        }
        if (!target.relative && fs.existsSync(path.join(target.full, 'index.html'))) {
            return send(res, 200, fs.readFileSync(path.join(target.full, 'index.html')));
        }
        return send(res, 200, listingPage(target.full, target.relative));
    }
    const ext = path.extname(target.full).toLowerCase();
    const type = INLINE_TYPES[ext];
    res.statusCode = 200;
    res.setHeader('Content-Type', type || 'application/octet-stream');
    res.setHeader('Content-Length', stat.size);
    if (!type) res.setHeader('Content-Disposition', `attachment; filename="${path.basename(target.full).replace(/[^\w.\- ]/g, '_')}"`);
    return res.end(fs.readFileSync(target.full));
}

function readBody(req) {
    if (req.body !== undefined && req.body !== null) {
        // Vercel has usually parsed it already
        if (typeof req.body === 'string') return Promise.resolve(req.body);
        if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body.toString('utf8'));
        return Promise.resolve(new URLSearchParams(req.body).toString());
    }
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => {
            data += chunk;
            if (data.length > 10000) req.destroy();
        });
        req.on('end', () => resolve(data));
        req.on('error', reject);
    });
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = async (req, res) => {
    // Never cached, never indexed - this is private content
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');

    const password = process.env.PROGRAMS_PASSWORD || DEFAULT_PASSWORD;
    const url = new URL(req.url || '/', 'https://bullion-book.local');
    const requested = (req.query && typeof req.query.path === 'string' ? req.query.path : null)
        ?? url.searchParams.get('path') ?? '';
    const wantsJson = /application\/json/i.test(String(req.headers.accept || ''));

    // "/programs" without the slash: add it, so links in a page resolve
    // inside the folder (vercel.json sends only that address here with bare=1)
    if (url.searchParams.has('bare')) return redirect(res, 302, '/programs/');

    if (url.searchParams.has('logout')) {
        res.setHeader('Set-Cookie', `${COOKIE}=; Path=/programs; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
        return redirect(res, 303, '/programs/');
    }

    if (req.method === 'POST') {
        const given = new URLSearchParams(await readBody(req)).get('password') || '';
        if (!sameText(given, password)) {
            // A pause on every wrong guess slows down anyone guessing
            await wait(Number(process.env.BB_PROGRAMS_FAIL_DELAY_MS || 800));
            return wantsJson ? send(res, 401, JSON.stringify({ ok: false, error: 'Wrong password.' }), 'application/json')
                : send(res, 401, loginPage('Wrong password - try again.'));
        }
        const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
        res.setHeader('Set-Cookie', `${COOKIE}=${expires}.${sign(password, expires)}; Path=/programs; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Lax`);
        return wantsJson ? send(res, 200, JSON.stringify({ ok: true }), 'application/json')
            : redirect(res, 303, programsUrl(requested));
    }

    if (!hasSession(req, password) && !hasBasicAuth(req, password)) {
        return send(res, 401, loginPage(''));
    }
    return serve(res, requested);
};
