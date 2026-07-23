"""
Chart-data retention tool.

/data grows forever - every run of mt5_fetch_button.py adds another day per
symbol per interval. The 1-minute files are the bulk of it (they're ~8x the
size of 5m for the same day), so trimming old 1m history reclaims most of the
space while leaving the 5m/15m record intact.

This is SAFE to do because the app degrades gracefully when an interval is
missing for a date:
  * renderChartBlocks picks defaultInterval = 5m, else 1m, else 15m, and
    disables the toggle buttons for intervals that have no file (app.js).
  * fetchMaeMfeCandles walks MAE_MFE_INTERVALS ['1','5','15'] and falls back
    to the next one when a fetch fails (stats.js).

IMPORTANT: MT5 only keeps a limited window of M1 history, which is why the 1m
files here start months later than the 5m/15m ones. Once you delete old 1m
files you probably CANNOT re-fetch them. That's why this script is dry-run by
default - review the list before passing --apply.

Usage:
    python scripts/prune_chart_data.py                      # dry run, 1m older than 90d
    python scripts/prune_chart_data.py --keep-days 60       # dry run, different window
    python scripts/prune_chart_data.py --keep-days 60 --apply
    python scripts/prune_chart_data.py --interval 1 --interval 5 --keep-days 120 --apply
"""
import argparse
import os
import re
import sys
from datetime import date, timedelta

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
NAME_RE = re.compile(r"^(?P<prefix>.+?)_(?P<interval>\d+)Minute_BID_(?P<date>\d{4}-\d{2}-\d{2})_")


def parse_args():
    p = argparse.ArgumentParser(description="Prune old chart CSVs from /data.")
    p.add_argument("--keep-days", type=int, default=90,
                   help="Keep files newer than this many days (default: 90).")
    p.add_argument("--interval", action="append", default=None,
                   help="Interval(s) to prune, e.g. --interval 1. Repeatable. Default: 1 only.")
    p.add_argument("--apply", action="store_true",
                   help="Actually delete. Without this the script only reports.")
    return p.parse_args()


def main():
    args = parse_args()
    intervals = set(args.interval or ["1"])
    cutoff = date.today() - timedelta(days=args.keep_days)

    if not os.path.isdir(DATA_DIR):
        print("No data directory at %s" % DATA_DIR)
        return 1

    doomed = []
    kept_bytes = 0
    for name in sorted(os.listdir(DATA_DIR)):
        if not name.endswith(".csv"):
            continue
        m = NAME_RE.match(name)
        if not m:
            continue
        path = os.path.join(DATA_DIR, name)
        size = os.path.getsize(path)
        y, mo, d = (int(x) for x in m.group("date").split("-"))
        if m.group("interval") in intervals and date(y, mo, d) < cutoff:
            doomed.append((path, name, size))
        else:
            kept_bytes += size

    total = sum(s for _, _, s in doomed)
    print("Interval(s) targeted : %s" % ", ".join(sorted(intervals)))
    print("Cutoff               : older than %s (keep last %d days)" % (cutoff.isoformat(), args.keep_days))
    print("Files to remove      : %d" % len(doomed))
    print("Space reclaimed      : %.1f MB" % (total / 1048576.0))
    print("Space remaining      : %.1f MB" % (kept_bytes / 1048576.0))

    if not doomed:
        print("\nNothing to do.")
        return 0

    if not args.apply:
        print("\nDRY RUN - nothing deleted. Sample of what would go:")
        for _, name, _ in doomed[:10]:
            print("   %s" % name)
        if len(doomed) > 10:
            print("   ... and %d more" % (len(doomed) - 10))
        print("\nRe-run with --apply to delete. Note: old 1m history generally")
        print("cannot be re-fetched from MT5, so make sure you want this.")
        return 0

    for path, _, _ in doomed:
        os.remove(path)
    print("\nDeleted %d file(s)." % len(doomed))

    # Keep the manifest in step - the Charts page reads it to discover files.
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import build_data_manifest
    build_data_manifest.build_manifest()
    print("Rebuilt data-manifest.json.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
