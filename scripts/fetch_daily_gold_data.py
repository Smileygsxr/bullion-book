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


def get_missing_dates(lookback_days=7):
    """
    Returns a list of weekday dates (most recent first) within the last
    lookback_days that don't yet have a complete set of 3 CSV files in /data.
    This catches yesterday plus any days that were missed due to API errors.
    """
    today = datetime.now(timezone.utc).date()
    missing = []
    for i in range(1, lookback_days + 1):
        date = today - timedelta(days=i)
        if date.weekday() in (5, 6):  # skip weekends
            continue
        date_str = date.strftime("%Y-%m-%d")
        existing = sum(
            1 for label in INTERVALS
            if os.path.exists(os.path.join(
                DATA_DIR,
                f"XAU-USD_{label}Minute_BID_{date_str}_00_00-23_59_Africa_Johannesburg.csv"
            ))
        )
        if existing < len(INTERVALS):
            missing.append((date, existing))
    return missing


def fetch_interval(api_key, date, interval_label, td_interval, retries=3):
    date_str = date.strftime("%Y-%m-%d")
    out_name = f"XAU-USD_{interval_label}Minute_BID_{date_str}_00_00-23_59_Africa_Johannesburg.csv"
    out_path = os.path.join(DATA_DIR, out_name)

    if os.path.exists(out_path):
        print(f"  -> {out_name} already exists, skipping")
        return True

    params = {
        "symbol": "XAU/USD",
        "interval": td_interval,
        "start_date": f"{date_str} 00:00:00",
        "end_date": f"{date_str} 23:59:59",
        "timezone": "Africa/Johannesburg",
        "outputsize": 5000,
        "apikey": api_key,
    }

    for attempt in range(1, retries + 1):
        try:
            response = requests.get(API_URL, params=params, timeout=30)
            payload = response.json()
        except Exception as e:
            print(f"  -> Attempt {attempt} network error: {e}")
            if attempt < retries:
                time.sleep(5.0 * attempt)
            continue

        if payload.get("status") == "error" or "values" not in payload:
            msg = payload.get("message", payload)
            print(f"  -> Attempt {attempt} API error for {td_interval} {date_str}: {msg}")
            if attempt < retries:
                time.sleep(5.0 * attempt)
            continue

        values = payload["values"]
        if not values:
            print(f"  -> No candles returned for {td_interval} {date_str} (market may have been closed)")
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
        df.to_csv(out_path, index=False)

        print(f"  -> Saved {out_name} ({len(df)} rows)")
        return True

    print(f"  -> All {retries} attempts failed for {td_interval} {date_str}")
    return False


def main():
    api_key = os.environ.get("TWELVE_DATA_API_KEY")
    if not api_key:
        print("TWELVE_DATA_API_KEY environment variable is not set.")
        sys.exit(1)

    missing = get_missing_dates(lookback_days=7)
    if not missing:
        print("All recent trading days already have complete data.")
        return

    any_saved = False
    for date, existing_count in missing:
        date_str = date.strftime("%Y-%m-%d")
        print(f"\nFetching XAUUSD data for {date_str} ({existing_count}/{len(INTERVALS)} intervals already present)...")
        for interval_label, td_interval in INTERVALS.items():
            print(f"  -> {td_interval}")
            if fetch_interval(api_key, date, interval_label, td_interval):
                any_saved = True
            time.sleep(2.0)

    if not any_saved:
        print("\nNo data was retrieved for any missing date/interval.")
        sys.exit(0)


if __name__ == "__main__":
    main()
