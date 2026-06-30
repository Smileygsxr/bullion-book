"""
Fetches the previous trading day's XAUUSD candles (1m, 5m, 15m) from Dukascopy
via `duka` (free, no API key) and saves them into /data using the same filename
pattern the app already discovers: XAU-USD_<N>Minute_BID_<date>_00_00-23_59_Africa_Johannesburg.csv

Run daily by .github/workflows/fetch-daily-gold-data.yml - skips weekends since
the forex market is closed, so there's nothing to fetch.
"""
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone

import pandas as pd

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
INTERVALS = {"1": "M1", "5": "M5", "15": "M15"}


def get_target_date():
    yesterday = datetime.now(timezone.utc).date() - timedelta(days=1)
    if yesterday.weekday() in (5, 6):  # Saturday, Sunday - market was closed
        return None
    return yesterday


def fetch_interval(date, interval_label, candle_code):
    date_str = date.strftime("%Y-%m-%d")
    date_underscore = date.strftime("%Y_%m_%d")

    os.makedirs(".duka", exist_ok=True)
    command = f"duka XAUUSD -s {date_str} -e {date_str} -c {candle_code}"
    result = subprocess.run(command, shell=True, capture_output=True, text=True)

    expected_file = os.path.join(".duka", f"XAUUSD-{candle_code}-{date_underscore}-{date_underscore}.csv")
    if not os.path.exists(expected_file):
        print(f"  -> No data returned for {candle_code} {date_str} (exit code {result.returncode})")
        if result.stdout.strip():
            print(f"     stdout: {result.stdout.strip()[-500:]}")
        if result.stderr.strip():
            print(f"     stderr: {result.stderr.strip()[-500:]}")
        return False

    df = pd.read_csv(expected_file)
    df["time"] = pd.to_datetime(df["time"], format="%d.%m.%Y %H:%M:%S.%f")
    df.set_index("time", inplace=True)

    if df.index.tz is None:
        df.index = df.index.tz_localize("GMT")
    df.index = df.index.tz_convert("Africa/Johannesburg")

    # ISO-ish "YYYY-MM-DDTHH:MM:SS+02:00" - matches the format the app already parses
    df.index = df.index.map(
        lambda ts: ts.strftime("%Y-%m-%dT%H:%M:%S") + ts.strftime("%z")[:3] + ":" + ts.strftime("%z")[3:]
    )
    df.index.name = "Africa/Johannesburg"

    os.makedirs(DATA_DIR, exist_ok=True)
    out_name = f"XAU-USD_{interval_label}Minute_BID_{date_str}_00_00-23_59_Africa_Johannesburg.csv"
    df.to_csv(os.path.join(DATA_DIR, out_name))

    os.remove(expected_file)
    print(f"  -> Saved {out_name} ({len(df)} rows)")
    return True


def main():
    target = get_target_date()
    if target is None:
        print("Yesterday was a weekend - forex market was closed, nothing to fetch.")
        return

    print(f"Fetching XAUUSD data for {target.strftime('%Y-%m-%d')}...")
    any_saved = False
    for interval_label, candle_code in INTERVALS.items():
        print(f"-> {candle_code}")
        if fetch_interval(target, interval_label, candle_code):
            any_saved = True
        time.sleep(1.0)

    if os.path.isdir(".duka") and not os.listdir(".duka"):
        os.rmdir(".duka")

    if not any_saved:
        print("No data was retrieved for any interval.")
        sys.exit(0)


if __name__ == "__main__":
    main()
