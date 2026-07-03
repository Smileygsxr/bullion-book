"""
One-click MT5 data fetcher - connects directly to your already-running,
logged-in MT5 terminal (via the official MetaTrader5 Python package) and
pulls OHLC bars straight from it, skipping History Center's manual
Export/Import round-trip entirely. Writes files in this app's format
directly into /data, only for days that aren't already there - safe to
re-run any time, like clicking a "sync" button.

Setup (one-time):
    pip install MetaTrader5

Requires MT5 to be open and logged into your broker on THIS PC every time
you run this - it attaches to the running terminal, it can't run
unattended or in the cloud (only the Twelve Data GitHub Action can).

Usage:
    python scripts/mt5_fetch_button.py
    (or double-click scripts/mt5_fetch_button.bat)
"""
import os
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import MetaTrader5 as mt5

# ---- Configure these for your setup ----

# Broker symbol name (as it appears in your MT5 Market Watch - many
# brokers add a suffix like "m") -> the name to use in output filenames.
# Add/remove pairs here; the app's News page currently only displays
# XAU-USD charts, so other symbols will just sit in /data unused until
# it's extended to show them too.
SYMBOLS = {
    "XAUUSDm": "XAU-USD",
    "EURUSDm": "EUR-USD",
    "GBPUSDm": "GBP-USD",
}

INTERVALS = {"1": mt5.TIMEFRAME_M1, "5": mt5.TIMEFRAME_M5, "15": mt5.TIMEFRAME_M15}

# First run starts from here; later runs only fetch whatever's missing
# since the last one (existing files are never re-fetched or overwritten).
EARLIEST_DATE = datetime(2026, 1, 1)

# MT5 reports bar times in your BROKER SERVER's timezone. This app's chart
# data is always Africa/Johannesburg (GMT+2) - set this to whatever hour
# shift gets you from your server's time to GMT+2 (0 if your server is
# already GMT+2/GMT+3-no-DST).
SERVER_TO_APP_OFFSET_HOURS = 2

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")


def existing_dates(output_dir, filename_symbol, interval_label):
    prefix = f"{filename_symbol}_{interval_label}Minute_BID_"
    found = set()
    for name in os.listdir(output_dir):
        if name.startswith(prefix) and name.endswith(".csv"):
            date_part = name[len(prefix):len(prefix) + 10]
            found.add(date_part)
    return found


def fetch_symbol_interval(mt5_symbol, filename_symbol, interval_label, mt5_timeframe, range_end):
    existing = existing_dates(OUTPUT_DIR, filename_symbol, interval_label)

    rates = mt5.copy_rates_range(mt5_symbol, mt5_timeframe, EARLIEST_DATE, range_end)
    if rates is None or len(rates) == 0:
        print(f"{mt5_symbol} ({interval_label}m): no data returned from MT5 (error: {mt5.last_error()}).")
        return

    rows_by_day = defaultdict(list)
    for r in rates:
        dt_shifted = datetime.utcfromtimestamp(int(r["time"])) + timedelta(hours=SERVER_TO_APP_OFFSET_HOURS)
        day_str = dt_shifted.strftime("%Y-%m-%d")
        timestamp = dt_shifted.strftime("%Y-%m-%dT%H:%M:%S") + "+02:00"
        rows_by_day[day_str].append((timestamp, r["open"], r["high"], r["low"], r["close"], r["tick_volume"]))

    written = 0
    for day_str, day_rows in rows_by_day.items():
        if day_str in existing:
            continue
        out_name = f"{filename_symbol}_{interval_label}Minute_BID_{day_str}_00_00-23_59_Africa_Johannesburg.csv"
        out_path = os.path.join(OUTPUT_DIR, out_name)
        with open(out_path, "w", encoding="utf-8") as f:
            f.write("Africa/Johannesburg,Open,High,Low,Close,Volume\n")
            for timestamp, o, h, l, c, v in day_rows:
                f.write(f"{timestamp},{o},{h},{l},{c},{v}\n")
        written += 1

    print(f"{mt5_symbol} ({interval_label}m): wrote {written} new day(s)")


def main():
    if not mt5.initialize():
        print(f"Could not connect to MT5 - is the terminal open and logged in? Error: {mt5.last_error()}")
        return

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=None)
    range_end = today + timedelta(days=1)

    for mt5_symbol, filename_symbol in SYMBOLS.items():
        if not mt5.symbol_select(mt5_symbol, True):
            print(f"Could not select {mt5_symbol} - check it's in your broker's Market Watch. Skipping.")
            continue
        for interval_label, mt5_timeframe in INTERVALS.items():
            fetch_symbol_interval(mt5_symbol, filename_symbol, interval_label, mt5_timeframe, range_end)

    mt5.shutdown()


if __name__ == "__main__":
    main()
