"""
Writes /data-manifest.json - a plain JSON list of every CSV filename in /data.

The Charts page reads this file to discover chart days. Being a static file
committed alongside the data itself, it works on any static host with zero
server support - unlike the /api/data-files serverless function or a live
directory listing, which remain as fallbacks in app.js discoverChartFiles().

Re-run whenever files are added to or removed from /data. The MT5 fetch
script (mt5_fetch_button.py) calls this automatically after every fetch, so
the normal daily-import flow keeps it in sync without extra steps.

Usage:
    python scripts/build_data_manifest.py
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def build_manifest():
    data_dir = os.path.join(ROOT, "data")
    names = sorted(n for n in os.listdir(data_dir) if n.lower().endswith(".csv"))
    out_path = os.path.join(ROOT, "data-manifest.json")
    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(names, f, separators=(",", ":"))
    print(f"data-manifest.json: {len(names)} files listed")
    return len(names)


if __name__ == "__main__":
    build_manifest()
