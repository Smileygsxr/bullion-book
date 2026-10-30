// The password-protected Programs area (api/programs.js), run against a
// temporary programs folder with fake requests - the same handler Vercel runs.
const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = ({ test, assert, assertEqual, ROOT }) => {
    const handlerPath = path.join(__dirname, '..', 'api', 'programs.js');

    function setup(password) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-programs-'));
        const programs = path.join(dir, 'programs');
        fs.mkdirSync(path.join(programs, 'tools'), { recursive: true });
        fs.mkdirSync(path.join(programs, 'calc'), { recursive: true });
        fs.writeFileSync(path.join(programs, 'README.md'), 'notes for the repo');
        fs.writeFileSync(path.join(programs, '.secret'), 'hidden');
        fs.writeFileSync(path.join(programs, 'tools', 'MyEA.mq5'), 'int OnInit() { return 0; }');
        fs.writeFileSync(path.join(programs, 'calc', 'index.html'), '<h1>Lot calculator</h1>');
        fs.writeFileSync(path.join(programs, 'notes.txt'), 'plain notes');
        fs.writeFileSync(path.join(dir, 'outside.txt'), 'MUST NOT LEAK');
        process.env.BB_PROGRAMS_DIR = programs;
        process.env.BB_PROGRAMS_FAIL_DELAY_MS = '0';
        if (password === undefined) delete process.env.PROGRAMS_PASSWORD;
        else process.env.PROGRAMS_PASSWORD = password;
        delete require.cache[require.resolve(handlerPath)];
        return require(handlerPath);
    }

    function call(handler, { method = 'GET', pathParam = '', query = '', headers = {}, body } = {}) {
        const res = {
            statusCode: 200, headers: {}, body: '',
            setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
            getHeader(k) { return this.headers[k.toLowerCase()]; },
            end(chunk) { this.body = chunk === undefined ? '' : String(chunk); }
        };
        const url = `/api/programs?path=${encodeURIComponent(pathParam)}${query ? `&${query}` : ''}`;
        const req = { method, url, headers, query: { path: pathParam }, body };
        return Promise.resolve(handler(req, res)).then(() => res);
    }

    function cookieFrom(res) {
        return String(res.headers['set-cookie'] || '').split(';')[0];
    }

    async function login(handler, password) {
        const res = await call(handler, { method: 'POST', headers: { accept: 'application/json' }, body: { password } });
        return { res, cookie: cookieFrom(res) };
    }

    test('programs: the temporary password is 1234; a password set in Vercel replaces it', async () => {
        let handler = setup(undefined);
        const page = await call(handler);
        assertEqual(page.statusCode, 401, 'still asks for the password');
        assert(page.headers['cache-control'] === 'private, no-store', 'never cached');
        assertEqual((await login(handler, '1234')).res.statusCode, 200, '1234 opens it');
        assertEqual((await login(handler, '12345')).res.statusCode, 401, 'anything else is refused');
        handler = setup('from-vercel');
        assertEqual((await login(handler, '1234')).res.statusCode, 401, '1234 stops working once Vercel has one');
        assertEqual((await login(handler, 'from-vercel')).res.statusCode, 200, 'the Vercel password works');
    });

    test('programs: asks for the password; a wrong one is refused', async () => {
        const handler = setup('s3cret!');
        const page = await call(handler, { pathParam: 'notes.txt' });
        assertEqual(page.statusCode, 401, 'login required');
        assert(/type="password"/.test(page.body) && page.body.indexOf('plain notes') < 0, 'login form, no file content');
        const wrong = await login(handler, 'guess');
        assertEqual(wrong.res.statusCode, 401, 'wrong password refused');
        assertEqual(wrong.cookie, '', 'no session for a wrong password');
    });

    test('programs: the right password opens a 12-hour session; files and folders are served', async () => {
        const handler = setup('s3cret!');
        const { res, cookie } = await login(handler, 's3cret!');
        assertEqual(res.statusCode, 200, 'accepted');
        const setCookie = String(res.headers['set-cookie']);
        assert(/HttpOnly/.test(setCookie) && /Secure/.test(setCookie) && /Path=\/programs/.test(setCookie) && /Max-Age=43200/.test(setCookie), `safe cookie: ${setCookie}`);
        const headers = { cookie };
        const list = await call(handler, { headers });
        assertEqual(list.statusCode, 200, 'listing');
        assert(/tools/.test(list.body) && /notes\.txt/.test(list.body) && /calc/.test(list.body), 'lists the folder');
        assert(!/README/.test(list.body) && !/\.secret/.test(list.body), 'README and hidden files left out');
        const txt = await call(handler, { pathParam: 'notes.txt', headers });
        assert(txt.body === 'plain notes' && /text\/plain/.test(txt.headers['content-type']), 'text file opens in the browser');
        const ea = await call(handler, { pathParam: 'tools/MyEA.mq5', headers });
        assert(/attachment/.test(ea.headers['content-disposition']) && ea.body.indexOf('OnInit') >= 0, 'an EA downloads');
        const app = await call(handler, { pathParam: 'calc', headers });
        assert(app.statusCode === 302 && app.headers.location === '/programs/calc/index.html', 'a folder with index.html opens it');
        const sub = await call(handler, { pathParam: 'tools', headers });
        assert(sub.statusCode === 200 && /MyEA\.mq5/.test(sub.body), 'a folder without index.html is listed');
    });

    test('programs: nothing outside the folder can be reached', async () => {
        const handler = setup('s3cret!');
        const { cookie } = await login(handler, 's3cret!');
        for (const attempt of ['../outside.txt', '..%2Foutside.txt', '%2e%2e/outside.txt', 'tools/../../outside.txt', '/../outside.txt', '.secret', '..\\outside.txt']) {
            const res = await call(handler, { pathParam: attempt, headers: { cookie } });
            assert(res.body.indexOf('MUST NOT LEAK') < 0 && res.body.indexOf('hidden') < 0, `leaked via ${attempt}`);
            assert(res.statusCode === 400 || res.statusCode === 404, `${attempt}: status ${res.statusCode}`);
        }
    });

    test('programs: forged, expired or old-password sessions are refused; log out works', async () => {
        let handler = setup('s3cret!');
        const { cookie } = await login(handler, 's3cret!');
        const [name, value] = cookie.split('=');
        const [exp, sig] = value.split('.');
        const forged = `${name}=${exp}.${sig.replace(/^./, c => (c === 'a' ? 'b' : 'a'))}`;
        assertEqual((await call(handler, { headers: { cookie: forged } })).statusCode, 401, 'forged signature refused');
        const longer = `${name}=${Number(exp) + 999999}.${sig}`;
        assertEqual((await call(handler, { headers: { cookie: longer } })).statusCode, 401, 'stretched expiry refused');
        handler = setup('new-password');
        assertEqual((await call(handler, { headers: { cookie } })).statusCode, 401, 'changing the password ends old sessions');
        const out = await call(handler, { query: 'logout=1', headers: { cookie } });
        assert(out.statusCode === 303 && /Max-Age=0/.test(String(out.headers['set-cookie'])), 'log out clears the cookie');
        const bare = await call(handler, { query: 'bare=1' });
        assert(bare.statusCode === 302 && bare.headers.location === '/programs/', '"/programs" gets its slash');
    });

    test('programs: basic auth also works (e.g. curl -u any:password)', async () => {
        const handler = setup('s3cret!');
        const auth = `Basic ${Buffer.from('anyone:s3cret!').toString('base64')}`;
        const res = await call(handler, { pathParam: 'notes.txt', headers: { authorization: auth } });
        assertEqual(res.body, 'plain notes', 'served');
        const bad = await call(handler, { pathParam: 'notes.txt', headers: { authorization: `Basic ${Buffer.from('anyone:nope').toString('base64')}` } });
        assertEqual(bad.statusCode, 401, 'wrong basic auth refused');
    });

    test('programs: the build never publishes the folder as public files', () => {
        // When the suite runs against the build (BB_TEST_ROOT=dist), the
        // programs folder must not be in it - only api/programs.js serves it
        if (path.resolve(ROOT) === path.resolve(__dirname, '..')) return;
        assert(!fs.existsSync(path.join(ROOT, 'programs')), 'dist/ contains programs/');
    });
};
