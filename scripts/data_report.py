"""
Chart-data size report - read-only, deletes nothing.

Shows how big /data is, what it's made of (per interval and symbol), how
fast it's growing per month, and what that means for the git repository
(every chart file ever committed stays in git history, even after it's
deleted from the folder). To actually free space, see prune_chart_data.py.

Usage:
    python scripts/data_report.py
    python scripts/data_report.py --months 12      # longer growth history
"""
import argparse
import os
import re
import subprocess
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
NAME_RE = re.compile(r"^(?P<prefix>.+?)_(?P<interval>\d+)Minute_BID_(?P<date>\d{4}-\d{2}-\d{2})_")

# GitHub's guidance: keep repositories under 1 GB (it emails at 5 GB);
# single files over 50 MB warn, over 100 MB are refused.
GITHUB_SOFT_LIMIT_MB = 1024


def mb(n):
    return n / (1024 * 1024)


def git_size_mb():
    """Size of the packed + loose git objects, or None if git isn't available."""
    try:
        out = subprocess.run(["git", "count-objects", "-v"], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError):
        return None
    kib = 0
    for line in out.splitlines():
        key, _, value = line.partition(":")
        if key.strip() in ("size", "size-pack"):
            kib += int(value.strip() or 0)
    return kib / 1024


def main():
    p = argparse.ArgumentParser(description="Report the size and growth of /data (read-only).")
    p.add_argument("--months", type=int, default=6, help="Months of growth history to show (default: 6).")
    args = p.parse_args()

    total = 0
    files = 0
    other = 0
    by_interval = defaultdict(int)
    by_symbol = defaultdict(int)
    by_month = defaultdict(int)
    for name in os.listdir(DATA_DIR):
        path = os.path.join(DATA_DIR, name)
        if not os.path.isfile(path):
            continue
        size = os.path.getsize(path)
        total += size
        files += 1
        m = NAME_RE.match(name)
        if not m:
            other += size
            continue
        by_interval[m.group("interval") + "m"] += size
        by_symbol[m.group("prefix")] += size
        by_month[m.group("date")[:7]] += size

    print(f"/data: {mb(total):.1f} MB in {files:,} files")
    print("\nBy interval:")
    for interval, size in sorted(by_interval.items(), key=lambda kv: -kv[1]):
        print(f"  {interval:>4}  {mb(size):8.1f} MB  ({100 * size / total:4.1f}%)")
    if other:
        print(f"  other {mb(other):7.1f} MB (economic calendar, etc.)")
    print("\nBy symbol:")
    for symbol, size in sorted(by_symbol.items(), key=lambda kv: -kv[1]):
        print(f"  {symbol:<12} {mb(size):8.1f} MB")

    months = sorted(by_month)[-args.months:]
    print(f"\nAdded per month (by the chart day in each file's name), last {len(months)}:")
    for month in months:
        print(f"  {month}  {mb(by_month[month]):7.1f} MB")
    # Complete months only: the current one is still filling up
    full = months[:-1] if len(months) > 1 else months
    rate = sum(by_month[m] for m in full) / max(1, len(full))
    print(f"\nRecent rate: ~{mb(rate):.0f} MB/month -> ~{mb(rate * 12):.0f} MB more per year at this pace")

    print(f"(the deployed site carries the files uncompressed: {mb(total):.0f} MB now)")

    git_mb = git_size_mb()
    if git_mb is not None:
        # Git stores the CSVs compressed, so the repository grows by only a
        # fraction of the raw rate - estimate that fraction from today's sizes
        ratio = min(1.0, git_mb / mb(total)) if total else 1.0
        git_rate = mb(rate) * ratio
        print(f"\nGit repository: {git_mb:.0f} MB (the CSVs compress to ~{100 * ratio:.0f}% of their size in git)")
        print(f"It grows ~{git_rate:.1f} MB/month at this pace; GitHub suggests staying under {GITHUB_SOFT_LIMIT_MB} MB.")
        if git_rate > 0 and git_mb < GITHUB_SOFT_LIMIT_MB:
            years = (GITHUB_SOFT_LIMIT_MB - git_mb) / git_rate / 12
            print(f"That's roughly {years:.0f} years away.")
        print("Note: pruning files from /data shrinks the site, but NOT the git history -")
        print("old versions stay in .git unless the history itself is rewritten.")


if __name__ == "__main__":
    main()
