"""
Converts an MT5 History Center CSV export (tab-separated, <DATE>/<TIME>/
<OPEN>/<HIGH>/<LOW>/<CLOSE>/<TICKVOL>/<VOL>/<SPREAD> columns, one row per bar,
UTC timestamps) into the per-day, comma-separated CSV files this app reads
from /data:

    XAU-USD_<N>Minute_BID_<date>_00_00-23_59_Africa_Johannesburg.csv

MT5's own export filename varies by broker/symbol suffix (e.g. "XAUUSDm"),
but it always embeds the timeframe as "_M1_"/"_M5_"/"_M15_" - the interval
is auto-detected from that if not passed explicitly.

Assumes the source timestamps are UTC (GMT+0) and adds 2 hours to match the
rest of this app's data, which is always Africa/Johannesburg (GMT+2, no
DST) - a row at 23:00 UTC becomes 01:00 the next day, so rows are grouped
into output files by their SHIFTED date, not the original one. If your MT5
server isn't actually UTC, change UTC_TO_APP_OFFSET_HOURS below.

Usage:
    python scripts/convert_mt5_export.py path/to/XAUUSDm_M1_export.csv
    python scripts/convert_mt5_export.py path/to/export.csv --interval 5
    python scripts/convert_mt5_export.py path/to/export.csv --out-dir "C:\\some\\folder"

Existing files for the same date/interval are overwritten.
"""
import argparse
import csv
import io
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timedelta

UTC_TO_APP_OFFSET_HOURS = 2
DEFAULT_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")

# MT5's own "Export" button sometimes saves as UTF-16 rather than UTF-8,
# depending on Windows locale/version - try the common ones in order.
CANDIDATE_ENCODINGS = ["utf-8-sig", "utf-8", "utf-16", "utf-16-le", "latin-1"]

INTERVAL_FILENAME_PATTERN = re.compile(r"_M(1|5|15)_", re.IGNORECASE)


def detect_interval_from_filename(path):
    match = INTERVAL_FILENAME_PATTERN.search(os.path.basename(path))
    if not match:
        return None
    return match.group(1)


def read_text(path):
    for encoding in CANDIDATE_ENCODINGS:
        try:
            with open(path, encoding=encoding) as f:
                return f.read()
        except (UnicodeError, UnicodeDecodeError):
            continue
    raise ValueError(f"Could not decode {path} with any of {CANDIDATE_ENCODINGS}")


def convert(input_path, interval_label, out_dir):
    text = read_text(input_path)
    reader = csv.reader(io.StringIO(text), delimiter="\t")

    rows = iter(reader)
    next(rows, None)  # header row (<DATE> <TIME> <OPEN> ...)

    rows_by_day = defaultdict(list)
    skipped = 0

    for row in rows:
        if len(row) < 6:
            skipped += 1
            continue

        date_str, time_str, open_, high, low, close = row[0], row[1], row[2], row[3], row[4], row[5]
        tickvol = row[6] if len(row) > 6 else "0"

        try:
            dt = datetime.strptime(f"{date_str} {time_str}", "%Y.%m.%d %H:%M:%S")
        except ValueError:
            skipped += 1
            continue

        dt_shifted = dt + timedelta(hours=UTC_TO_APP_OFFSET_HOURS)
        day_key = dt_shifted.strftime("%Y-%m-%d")
        timestamp = dt_shifted.strftime("%Y-%m-%dT%H:%M:%S") + "+02:00"

        rows_by_day[day_key].append([timestamp, open_, high, low, close, tickvol])

    os.makedirs(out_dir, exist_ok=True)
    written = 0
    for day, day_rows in sorted(rows_by_day.items()):
        out_name = f"XAU-USD_{interval_label}Minute_BID_{day}_00_00-23_59_Africa_Johannesburg.csv"
        out_path = os.path.join(out_dir, out_name)
        with open(out_path, "w", newline="", encoding="utf-8") as out:
            writer = csv.writer(out)
            writer.writerow(["Africa/Johannesburg", "Open", "High", "Low", "Close", "Volume"])
            writer.writerows(day_rows)
        written += 1

    print(f"Wrote {written} daily file(s) for interval {interval_label} ({skipped} row(s) skipped) from {input_path} -> {out_dir}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input_path", help="Path to the MT5 CSV export")
    parser.add_argument("interval", nargs="?", choices=["1", "5", "15"], default=None,
                         help="Timeframe in minutes - auto-detected from the filename (_M1_/_M5_/_M15_) if omitted")
    parser.add_argument("--interval", dest="interval_flag", choices=["1", "5", "15"], default=None,
                         help="Same as the positional interval argument, as a named flag")
    parser.add_argument("--out-dir", default=DEFAULT_DATA_DIR,
                         help="Where to write the converted daily files (defaults to this repo's /data folder)")
    args = parser.parse_args()

    interval_label = args.interval_flag or args.interval or detect_interval_from_filename(args.input_path)
    if interval_label is None:
        print(f"Could not detect the timeframe from '{args.input_path}' (expected _M1_/_M5_/_M15_ in the filename).")
        print("Pass it explicitly: python scripts/convert_mt5_export.py <file> --interval 5")
        sys.exit(1)

    convert(args.input_path, interval_label, args.out_dir)


if __name__ == "__main__":
    main()
