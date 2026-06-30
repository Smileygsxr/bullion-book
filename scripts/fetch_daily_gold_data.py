"""
Fetches the previous trading day's XAUUSD candles (1m, 5m, 15m) from OANDA's
v20 API and saves them into /data using the filename pattern the app already
discovers: XAU-USD_<N>Minute_BID_<date>_00_00-23_59_Africa_Johannesburg.csv

Run daily by .github/workflows/fetch-daily-gold-data.yml - skips weekends since
the forex market is closed, so there's nothing to fetch. Requires the
OANDA_API_KEY environment variable (a Personal Access Token, from a GitHub
repo secret). Works with a free OANDA practice account - practice accounts get
the same real market data as live accounts, just no real money behind trades.
"""
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pandas as pd
import requests

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
INTERVALS = {"1": "M1", "5": "M5", "15": "M15"}
JOHANNESBURG = ZoneInfo("Africa/Johannesburg")


def get_target_date():
    yesterday = datetime.now(timezone.utc).date() - timedelta(days=1)
    if yesterday.weekday() in (5, 6):  # Saturday, Sunday - market was closed
        return None
    return yesterday


def get_api_base():
    env = os.environ.get("OANDA_ENVIRONMENT", "practice").strip().lower()
    return "https://api-fxtrade.oanda.com" if env == "live" else "https://api-fxpractice.oanda.com"


def fetch_interval(api_key, date, interval_label, granularity):
    date_str = date.strftime("%Y-%m-%d")

    start_local = datetime(date.year, date.month, date.day, 0, 0, 0, tzinfo=JOHANNESBURG)
    end_local = datetime(date.year, date.month, date.day, 23, 59, 59, tzinfo=JOHANNESBURG)

    url = f"{get_api_base()}/v3/instruments/XAU_USD/candles"
    params = {
        "price": "B",  # Bid prices, matching the existing "_BID_" filenames
        "granularity": granularity,
        "from": start_local.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "to": end_local.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    headers = {"Authorization": f"Bearer {api_key}"}

    response = requests.get(url, params=params, headers=headers, timeout=30)
    if response.status_code != 200:
        print(f"  -> No data returned for {granularity} {date_str}: HTTP {response.status_code} {response.text[:300]}")
        return False

    candles = response.json().get("candles", [])
    rows = []
    for c in candles:
        if not c.get("complete", True):
            continue
        bid = c.get("bid")
        if not bid:
            continue
        utc_time = datetime.strptime(c["time"][:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
        local_time = utc_time.astimezone(JOHANNESBURG)
        rows.append({
            "Africa/Johannesburg": local_time.strftime("%Y-%m-%dT%H:%M:%S") + "+02:00",
            "Open": bid["o"], "High": bid["h"], "Low": bid["l"], "Close": bid["c"],
            "Volume": c.get("volume", 0)
        })

    if not rows:
        print(f"  -> No data returned for {granularity} {date_str} (empty result)")
        return False

    df = pd.DataFrame(rows)
    os.makedirs(DATA_DIR, exist_ok=True)
    out_name = f"XAU-USD_{interval_label}Minute_BID_{date_str}_00_00-23_59_Africa_Johannesburg.csv"
    df.to_csv(os.path.join(DATA_DIR, out_name), index=False)

    print(f"  -> Saved {out_name} ({len(df)} rows)")
    return True


def main():
    api_key = os.environ.get("OANDA_API_KEY")
    if not api_key:
        print("OANDA_API_KEY environment variable is not set.")
        sys.exit(1)

    target = get_target_date()
    if target is None:
        print("Yesterday was a weekend - forex market was closed, nothing to fetch.")
        return

    print(f"Fetching XAUUSD data for {target.strftime('%Y-%m-%d')}...")
    any_saved = False
    for interval_label, granularity in INTERVALS.items():
        print(f"-> {granularity}")
        if fetch_interval(api_key, target, interval_label, granularity):
            any_saved = True
        time.sleep(1.0)

    if not any_saved:
        print("No data was retrieved for any interval.")
        sys.exit(0)


if __name__ == "__main__":
    main()
