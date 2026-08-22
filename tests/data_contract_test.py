"""
data_contract_test.py — Person 5 (Integration, Testing)

Standalone, runnable validation of a CSV against the locked data
contract (docs/data_format.md). Added Aug 22 specifically to cover
multi-date historical data / trend-readiness, since that's now a real
feature (Trend Projection + Report work against uploaded historical
CSVs) and wasn't covered by benchmark_test.py's single-pass schema
check.

Does NOT touch src/, backend/, analytics/, data/, or any CSV file —
read-only against whatever path you point it at.

Usage:
    python data_contract_test.py --csv path/to/cleaned_data.csv

Exits non-zero if any check fails, so it can be wired into CI later.
"""

import argparse
import csv
import sys
from collections import defaultdict

LOCKED_COLUMNS = ["chainage", "date", "parameter", "value"]
LOCKED_PARAMS = {"gauge", "alignment", "twist", "unevenness", "crossLevel", "railWear"}
CHAINAGE_MIN = 0.0
CHAINAGE_MAX = 60.0
CHAINAGE_STEP = 0.1


def run(csv_path):
    checks = []  # (name, passed: bool, detail: str)

    rows = []
    with open(csv_path, newline="") as f:
        reader = csv.DictReader(f)
        header_ok = reader.fieldnames == LOCKED_COLUMNS
        checks.append((
            "Schema: exact locked columns",
            header_ok,
            f"got {reader.fieldnames}" if not header_ok else f"{LOCKED_COLUMNS}",
        ))
        for i, row in enumerate(reader):
            row["_rownum"] = i + 2
            rows.append(row)

    # --- Parameter names -----------------------------------------------
    bad_params = sorted({r["parameter"] for r in rows} - LOCKED_PARAMS)
    checks.append((
        "Only the 6 locked parameter names appear",
        len(bad_params) == 0,
        f"unexpected: {bad_params}" if bad_params else "gauge/alignment/twist/unevenness/crossLevel/railWear only",
    ))

    # --- Numeric validity -------------------------------------------------
    bad_numeric = []
    for r in rows:
        try:
            float(r["chainage"])
            float(r["value"])
        except (ValueError, TypeError):
            bad_numeric.append(r["_rownum"])
    checks.append((
        "chainage and value are numeric on every row",
        len(bad_numeric) == 0,
        f"{len(bad_numeric)} bad rows, e.g. {bad_numeric[:5]}" if bad_numeric else f"{len(rows)} rows OK",
    ))

    # --- Duplicates ------------------------------------------------------
    seen = defaultdict(int)
    for r in rows:
        seen[(r["chainage"], r["date"], r["parameter"])] += 1
    dupes = {k: v for k, v in seen.items() if v > 1}
    checks.append((
        "No duplicate (chainage, date, parameter) rows",
        len(dupes) == 0,
        f"{len(dupes)} duplicate keys" if dupes else "0 duplicates",
    ))

    # --- Chainage range/step ----------------------------------------------
    chainages = sorted({round(float(r["chainage"]), 1) for r in rows})
    in_range = all(CHAINAGE_MIN <= c <= CHAINAGE_MAX for c in chainages)
    checks.append((
        f"All chainage values within locked range [{CHAINAGE_MIN}, {CHAINAGE_MAX}]",
        in_range,
        f"min={chainages[0] if chainages else None}, max={chainages[-1] if chainages else None}",
    ))

    # --- Multi-date / trend readiness (the new part) ----------------------
    dates = sorted({r["date"] for r in rows})
    multi_date = len(dates) >= 2
    checks.append((
        "Dataset has 2+ distinct dates (required for Trend Projection)",
        multi_date,
        f"{len(dates)} distinct dates: {dates[:3]}{'...' if len(dates) > 3 else ''}",
    ))

    # For each (chainage, parameter) pair, count how many distinct dates
    # it has data for. A pair with >=2 dates is trend-eligible.
    per_pair_dates = defaultdict(set)
    for r in rows:
        per_pair_dates[(round(float(r["chainage"]), 1), r["parameter"])].add(r["date"])
    trend_eligible = sum(1 for dates_set in per_pair_dates.values() if len(dates_set) >= 2)
    total_pairs = len(per_pair_dates)
    checks.append((
        "At least some (chainage, parameter) pairs have 2+ dates (trend-eligible)",
        trend_eligible > 0,
        f"{trend_eligible}/{total_pairs} chainage×parameter pairs have 2+ dates",
    ))

    return checks, rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", required=True, help="Path to a locked-schema CSV")
    args = parser.parse_args()

    checks, rows = run(args.csv)

    print(f"\nData contract check: {args.csv}")
    print(f"Total rows: {len(rows)}\n")

    all_passed = True
    for name, passed, detail in checks:
        status = "PASS" if passed else "FAIL"
        if not passed:
            all_passed = False
        print(f"[{status}] {name}")
        print(f"       {detail}")

    print(f"\nOverall: {'PASS' if all_passed else 'FAIL'}")
    sys.exit(0 if all_passed else 1)


if __name__ == "__main__":
    main()
