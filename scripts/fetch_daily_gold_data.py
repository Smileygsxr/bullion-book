"""
Fetches the previous trading day's XAUUSD candles (1m, 5m, 15m) from Twelve Data
and saves them into /data using the filename pattern the app already discovers:
XAU-USD_<N>Minute_BID_<date>_00_00-23_59_Africa_Johannesburg.csv

Run daily by .github/workflows/fetch-daily-gold-data.yml - skips weekends since
the forex market is closed, so there's nothing to fetch. Requires the
TWELVE_DATA_API_KEY environment variable (set from a GitHub repo secret) -
Dukascopy scraping (the previous approach) blocks/rate-limits cloud datacenter
IPs like GitHub Actions runners, which is why this switched to a real API.
"""
import os
import sys
import time
from datetime import datetime, timedelta, timezone

import pandas as pd
import requests

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
INTERVALS = {"1": "1min", "5": "5min", "15": "15min"}
API_URL = "https://api.twelvedata.com/time_series"


def get_target_date():
    yesterday = datetime.now(timezone.utc).date() - timedelta(days=1)
    if yesterday.weekday() in (5, 6):  # Saturday, Sunday - market was closed
        return None
    return yesterday


def fetch_interval(api_key, date, interval_label, td_interval):
    date_str = date.strftime("%Y-%m-%d")

    params = {
        "symbol": "XAU/USD",
        "interval": td_interval,
        "start_date": f"{date_str} 00:00:00",
        "end_date": f"{date_str} 23:59:59",
        "timezone": "Africa/Johannesburg",
        "outputsize": 5000,
        "apikey": api_key,
    }

    response = requests.get(API_URL, params=params, timeout=30)
    payload = response.json()

    if payload.get("status") == "error" or "values" not in payload:
        print(f"  -> No data returned for {td_interval} {date_str}: {payload.get('message', payload)}")
        return False

    values = payload["values"]
    if not values:
        print(f"  -> No data returned for {td_interval} {date_str} (empty result)")
        return False

    df = pd.DataFrame(values)
    df = df.rename(columns={
        "datetime": "Africa/Johannesburg", "open": "Open", "high": "High",
        "low": "Low", "close": "Close", "volume": "Volume"
    })
    if "Volume" not in df.columns:
        df["Volume"] = 0

    # Twelve Data already returns timestamps in the requested timezone (fixed
    # UTC+2, South Africa has no DST), so just append the offset as a string.
    df["Africa/Johannesburg"] = pd.to_datetime(df["Africa/Johannesburg"])
    df = df.sort_values("Africa/Johannesburg")
    df["Africa/Johannesburg"] = df["Africa/Johannesburg"].dt.strftime("%Y-%m-%dT%H:%M:%S") + "+02:00"

    df = df[["Africa/Johannesburg", "Open", "High", "Low", "Close", "Volume"]]

    os.makedirs(DATA_DIR, exist_ok=True)
    out_name = f"XAU-USD_{interval_label}Minute_BID_{date_str}_00_00-23_59_Africa_Johannesburg.csv"
    df.to_csv(os.path.join(DATA_DIR, out_name), index=False)

    print(f"  -> Saved {out_name} ({len(df)} rows)")
    return True


def main():
    api_key = os.environ.get("TWELVE_DATA_API_KEY")
    if not api_key:
        print("TWELVE_DATA_API_KEY environment variable is not set.")
        sys.exit(1)

    target = get_target_date()
    if target is None:
        print("Yesterday was a weekend - forex market was closed, nothing to fetch.")
        return

    print(f"Fetching XAUUSD data for {target.strftime('%Y-%m-%d')}...")
    any_saved = False
    for interval_label, td_interval in INTERVALS.items():
        print(f"-> {td_interval}")
        if fetch_interval(api_key, target, interval_label, td_interval):
            any_saved = True
        time.sleep(2.0)

    if not any_saved:
        print("No data was retrieved for any interval.")
        sys.exit(0)


if __name__ == "__main__":
    main()
