// Static checks over every HTML page (no browser needed):
//   - every script/stylesheet loaded from another site is pinned to an exact
//     version and carries a Subresource Integrity hash, so a compromised CDN
//     can't swap in different code
//   - every local script the app loads actually exists
//   - every onclick/onchange/... handler in app.html names a real function
const fs = require('fs');
const path = require('path');

module.exports = ({ test, assert, ROOT, readSource, readOriginalSource }) => {
    const pages = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));

    function tags(html, name) {
        return html.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) || [];
    }

    function attr(tag, name) {
        const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'));
        return m ? m[1] : null;
    }

    test('pages: every CDN script and stylesheet is version-pinned with an integrity hash', () => {
        const problems = [];
        let checked = 0;
        pages.forEach(page => {
            const html = readSource(page);
            const external = tags(html, 'script').map(t => ({ t, url: attr(t, 'src') }))
                .concat(tags(html, 'link').filter(t => /rel="stylesheet"/i.test(t)).map(t => ({ t, url: attr(t, 'href') })))
                .filter(x => x.url && /^https?:\/\//i.test(x.url))
                // Google Fonts serves different CSS per browser, so it can't be hashed
                .filter(x => !/^https:\/\/fonts\.googleapis\.com\//.test(x.url));
            external.forEach(({ t, url }) => {
                checked++;
                const integrity = attr(t, 'integrity');
                if (!integrity || !/^sha(256|384|512)-[A-Za-z0-9+/=]+$/.test(integrity)) problems.push(`${page}: ${url} has no valid integrity hash`);
                if (attr(t, 'crossorigin') !== 'anonymous') problems.push(`${page}: ${url} needs crossorigin="anonymous"`);
                if (!/@?\d+\.\d+\.\d+/.test(url)) problems.push(`${page}: ${url} is not pinned to an exact version`);
            });
        });
        assert(checked >= 10, `expected the CDN tags, found ${checked}`);
        assert(problems.length === 0, problems.join('\n'));
    });

    test('pages: every local script the pages load exists', () => {
        const missing = [];
        pages.forEach(page => {
            tags(readSource(page), 'script').map(t => attr(t, 'src')).filter(src => src && !/^https?:/i.test(src)).forEach(src => {
                const file = src.split('?')[0];
                if (!fs.existsSync(path.join(ROOT, file))) missing.push(`${page}: ${src}`);
            });
        });
        assert(missing.length === 0, missing.join('\n'));
    });

    // All of app.html's scripts share one global scope: a name declared at the
    // top level of two files either throws on load ("already been declared",
    // for let/const) or silently replaces the other (functions). Checked on
    // the original source (it reads line by line; the build is one line) -
    // the boot test covers the built files actually loading together.
    test('pages: no two scripts on app.html declare the same top-level name', () => {
        const html = readSource('app.html');
        const scripts = tags(html, 'script').map(t => attr(t, 'src')).filter(src => src && !/^https?:/i.test(src)).map(src => src.split('?')[0]);
        const owner = new Map();
        const clashes = [];
        scripts.forEach(file => {
            const names = new Set();
            readOriginalSource(file).split('\n').forEach(line => {
                const m = line.match(/^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/) || line.match(/^(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/);
                if (m) names.add(m[1]);
            });
            names.forEach(name => {
                if (owner.has(name)) clashes.push(`${name}: ${owner.get(name)} and ${file}`);
                else owner.set(name, file);
            });
        });
        assert(owner.size > 300, `expected the app's top-level names, found ${owner.size}`);
        assert(clashes.length === 0, clashes.join('\n'));
    });

    test('pages: every inline event handler in app.html calls a function that exists', () => {
        const html = readSource('app.html');
        const scripts = tags(html, 'script').map(t => attr(t, 'src')).filter(src => src && !/^https?:/i.test(src)).map(src => src.split('?')[0]);
        const source = scripts.map(readSource).join('\n') + '\n' + html;
        const defined = new Set();
        (source.match(/function\s+([A-Za-z_$][\w$]*)\s*\(/g) || []).forEach(m => defined.add(m.replace(/function\s+/, '').replace(/\s*\($/, '')));
        (source.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:function|\()/g) || []).forEach(m => defined.add(m.replace(/(?:const|let|var)\s+/, '').replace(/\s*=.*$/, '')));
        const builtins = new Set(['event', 'this', 'window', 'document', 'if', 'return', 'setTimeout', 'alert', 'confirm']);
        const missing = new Set();
        (html.match(/\son[a-z]+="([^"]*)"/g) || []).forEach(handler => {
            // (string arguments blanked first - tooltip text like "Avg Loss (...)" isn't a call)
            const code = handler.replace(/^\s*on[a-z]+="/, '').replace(/"$/, '')
                .replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/&quot;.*?&quot;/g, "''");
            (code.match(/(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g) || []).forEach(call => {
                const name = call.replace(/^[^A-Za-z_$]*/, '').replace(/\s*\($/, '');
                if (!builtins.has(name) && !defined.has(name)) missing.add(name);
            });
        });
        assert(missing.size === 0, `handlers call undefined functions: ${Array.from(missing).join(', ')}`);
    });
};
