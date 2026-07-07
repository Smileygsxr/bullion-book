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
# brokers add a suffix like "m") -> the file-prefix used in output
# filenames. Must match CHART_SYMBOLS in app.js exactly, or the News page
# won't recognize the files. Double-check these against your own broker's
# Market Watch - the "m" suffix and "US500" naming are guesses and may
# differ (e.g. some brokers use "US500.cash" or no suffix at all).
SYMBOLS = {
    "XAUUSDm": "XAU-USD",
    "BTCUSDm": "BTC-USD",
    "US500m": "US500",
    "EURUSDm": "EUR-USD",
    "GBPUSDm": "GBP-USD",
    "USDJPYm": "USD-JPY",
    "USDCHFm": "USD-CHF",
    "AUDUSDm": "AUD-USD",
    "USDCADm": "USD-CAD",
    "NZDUSDm": "NZD-USD",
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

    # Only ask MT5 for days we don't already have, instead of re-requesting
    # the full EARLIEST_DATE-to-today span every run - that grows a little
    # more each day this script runs, and for M1 (5-15x more bars than M5/
    # M15 over the same span) eventually exceeds MT5's per-request bar cap,
    # which hits less-liquid pairs first since they also cache less local
    # M1 history to begin with. A tight, recent range avoids that entirely.
    #
    # The MOST RECENT saved day is always re-fetched and overwritten: it was
    # almost certainly written mid-day on a previous run (e.g. fetching at
    # 08:00 saves a file with bars only up to 08:00), so skipping it forever
    # would leave that day permanently cut off at whatever time you last ran
    # this. Range starts SERVER_TO_APP_OFFSET_HOURS earlier in server time so
    # the rebuilt file keeps that day's first wall-clock hours too.
    range_start = EARLIEST_DATE
    if existing:
        latest_str = max(existing)
        latest_existing = datetime.strptime(latest_str, "%Y-%m-%d")
        existing.discard(latest_str)
        range_start = latest_existing - timedelta(hours=SERVER_TO_APP_OFFSET_HOURS)

    rates = mt5.copy_rates_range(mt5_symbol, mt5_timeframe, range_start, range_end)
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
