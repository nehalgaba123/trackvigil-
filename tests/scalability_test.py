"""
scalability_test.py — Person 5 (Integration, Testing, Benchmarking)

Runs benchmark_test.py's measurements across the 4 target dataset sizes
(1k / 10k / 50k / 100k rows) and writes results/scalability_results.csv
in the exact table format needed for the final PPT.

HOW THIS WORKS RIGHT NOW:
  If Person 3 has already generated the sized CSVs (data/processed/*.csv),
  point this script at that folder and it'll use the real files.

  If those aren't ready yet, this script can generate TEMPORARY synthetic
  stand-ins locally (clearly labeled as dev-only, never for the actual
  demo/PPT) so you can test the harness itself today. Swap to Person 3's
  real files the moment they land — don't report numbers from the
  temporary generator in the final results.

Usage:
    # once Person 3's real sized files exist:
    python scalability_test.py --data-dir data/processed

    # to test the harness itself before that, with temp synthetic data:
    python scalability_test.py --generate-temp
"""

import argparse
import csv
import random
from datetime import date, timedelta
from pathlib import Path

from benchmark_test import run_benchmark, write_results, LOCKED_PARAMS

TARGET_SIZES = {
    "1k": 1_000,
    "10k": 10_000,
    "50k": 50_000,
    "100k": 100_000,
}

# Locked chainage rules from data_format.md — do not change without team approval.
CHAINAGE_MIN_KM = 0.0
CHAINAGE_MAX_KM = 60.0
CHAINAGE_STEP_KM = 0.1


def generate_temp_csv(path, target_rows):
    """
    TEMPORARY dev-only data generator — NOT for the real demo or PPT.
    Exists only so this harness can be exercised before Person 3's
    official sized datasets (data/processed/*.csv) are ready.

    Respects the LOCKED chainage contract (0-60km, 0.1km steps) instead
    of just extending chainage indefinitely — to hit larger row counts
    without violating that range, it adds more DATES instead (one full
    0-60km sweep per date). This also means temp data can double as a
    stand-in for testing trend/degradation logic later, since it won't
    have the same "only one date" problem as the real cleaned_data.csv
    sample currently does.
    """
    params = sorted(LOCKED_PARAMS)
    chainages = []
    c = CHAINAGE_MIN_KM
    while c <= CHAINAGE_MAX_KM + 1e-9:
        chainages.append(round(c, 1))
        c += CHAINAGE_STEP_KM

    rows_per_date = len(chainages) * len(params)
    n_dates = max(1, -(-target_rows // rows_per_date))  # ceil division

    start_date = date(2026, 8, 22)
    rows_written = 0
    with open(path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["chainage", "date", "parameter", "value"])
        for d_offset in range(n_dates):
            d = (start_date - timedelta(days=d_offset)).isoformat()
            for chainage in chainages:
                for p in params:
                    value = round(random.uniform(0.5, 13.0), 2)
                    writer.writerow([chainage, d, p, value])
                    rows_written += 1
                    if rows_written >= target_rows:
                        return rows_written
    return rows_written


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", default=None,
                         help="Folder containing Person 3's sized CSVs "
                              "(expects files named like 1k.csv, 10k.csv, 50k.csv, 100k.csv)")
    parser.add_argument("--generate-temp", action="store_true",
                         help="Generate temporary dev-only synthetic data instead "
                              "(for testing this harness before real data exists)")
    parser.add_argument("--api-base", default=None)
    args = parser.parse_args()

    if not args.data_dir and not args.generate_temp:
        parser.error("Pass either --data-dir (real sized CSVs) or --generate-temp (dev testing).")

    for label, target_rows in TARGET_SIZES.items():
        if args.generate_temp:
            tmp_dir = Path("tmp_scalability_data")
            tmp_dir.mkdir(exist_ok=True)
            csv_path = tmp_dir / f"{label}_TEMP.csv"
            actual_rows = generate_temp_csv(csv_path, target_rows)
            print(f"[TEMP DATA — dev only] {label}: generated {actual_rows} rows -> {csv_path}")
        else:
            csv_path = Path(args.data_dir) / f"{label}.csv"
            if not csv_path.exists():
                print(f"SKIP {label}: {csv_path} not found yet")
                continue

        print(f"\n=== Benchmarking {label} ({csv_path}) ===")
        results = run_benchmark(str(csv_path), api_base=args.api_base, repeats=3)
        print(results)
        write_results(results, label, out_path="results/scalability_results.csv")

    print("\nDone. See results/scalability_results.csv")
    if args.generate_temp:
        print("\nREMINDER: these numbers used TEMPORARY synthetic data, not the "
              "real sized datasets. Re-run with --data-dir once Person 3's real "
              "files exist, and do not put --generate-temp numbers in the final PPT.")


if __name__ == "__main__":
    main()
