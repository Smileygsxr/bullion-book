// Vercel serverless function: lists files in /data so the app can discover
// chart CSVs without relying on a directory-listing server (which Vercel's
// static hosting doesn't provide, unlike the local `python -m http.server` setup).
const fs = require('fs');
const path = require('path');

module.exports = (req, res) => {
    const dataDir = path.join(process.cwd(), 'data');
    let files;
    try {
        files = fs.readdirSync(dataDir);
    } catch (err) {
        res.status(500).json({ error: err.message });
        return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(files);
};
