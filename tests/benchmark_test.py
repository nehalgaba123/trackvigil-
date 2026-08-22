"""
benchmark_test.py — Person 5 (Integration, Testing, Benchmarking)

Measures actual timing for the 4 pipeline stages the team needs numbers for:
  1. Dataset processing time   (raw/cleaned CSV -> parsed structure)
  2. Alert generation time     (thresholds/analytics -> alerts)
  3. API response time         (backend GET /analytics, /alerts, etc.)
  4. Chainage query time       (single-chainage lookup/drill-down)

HOW THIS WORKS RIGHT NOW (before backend/analytics exist):
  Every stage below has a STUB implementation so this script runs and
  produces real timing numbers today, using a temporary local CSV parser
  and a dummy alert generator. As soon as Person 2's API and Person 4's
  analytics module exist, swap the STUB sections (clearly marked) for real
  calls — the rest of the harness (timing, output format) doesn't change.

Output: results/benchmark_results.csv, matching the table format required
for the final PPT. Only real measured numbers go in — never estimates.

Usage:
    python benchmark_test.py --csv path/to/cleaned_data.csv --api-base http://localhost:3000
"""

import argparse
import csv
import os
import time
import statistics
from pathlib import Path

# Optional — only needed once Person 2's backend is live
try:
    import requests
except ImportError:
    requests = None


LOCKED_COLUMNS = ["chainage", "date", "parameter", "value"]
LOCKED_PARAMS = {"gauge", "alignment", "twist", "unevenness", "crossLevel", "railWear"}

# Same values as docs/data_format.md — update in both places if they change.
THRESHOLDS = {
    "gauge":      {"warning": 5, "critical": 9},
    "alignment":  {"warning": 5, "critical": 10},
    "twist":      {"warning": 4, "critical": 7},
    "unevenness": {"warning": 8, "critical": 13},
    "crossLevel": {"warning": 6, "critical": 10},
    "railWear":   {"warning": 8, "critical": 12},
}


def timed(fn, *args, **kwargs):
    """Run fn, return (result, elapsed_seconds)."""
    start = time.perf_counter()
    result = fn(*args, **kwargs)
    elapsed = time.perf_counter() - start
    return result, elapsed


# ---------------------------------------------------------------------------
# Stage 1: Dataset processing
# ---------------------------------------------------------------------------
def process_dataset(csv_path):
    """
    Parse + validate the locked-format CSV.

    STUB NOTE: this is a lightweight stand-in for whatever Person 2's
    dataService.js / Person 3's clean_data.py actually does. Replace with
    a real call once those exist (e.g. subprocess into clean_data.py, or
    hit a backend /upload endpoint and time that instead).
    """
    rows = []
    with open(csv_path, newline="") as f:
        reader = csv.DictReader(f)
        assert reader.fieldnames == LOCKED_COLUMNS, (
            f"Schema mismatch: got {reader.fieldnames}, expected {LOCKED_COLUMNS}"
        )
        for row in reader:
            assert row["parameter"] in LOCKED_PARAMS, f"Unknown parameter: {row['parameter']}"
            row["chainage"] = float(row["chainage"])
            row["value"] = float(row["value"])
            rows.append(row)
    return rows


# ---------------------------------------------------------------------------
# Stage 2: Alert generation
# ---------------------------------------------------------------------------
def classify(param, value):
    """Locked severity logic: both boundaries inclusive (>=)."""
    t = THRESHOLDS[param]
    if value >= t["critical"]:
        return "critical"
    if value >= t["warning"]:
        return "warning"
    return "ok"


def generate_alerts(rows):
    """
    STUB alert generator, matching the LOCKED server-side alert structure
    from the backend/integration rules:

        { param, start, end, peak, sev }

    Alerts are contiguous runs of breached readings for the same
    parameter along chainage — not one alert per individual reading.

    Replace with a real call into Person 4's alert_engine.py the moment
    it's ready (e.g. subprocess, or import if it's a Python module you can
    call directly).
    """
    by_param = {}
    for row in rows:
        by_param.setdefault(row["parameter"], []).append(row)
    for param in by_param:
        by_param[param].sort(key=lambda r: r["chainage"])

    alerts = []
    for param, param_rows in by_param.items():
        run = []
        run_sev = None

        def flush():
            if not run:
                return
            alerts.append({
                "param": param,
                "start": run[0]["chainage"],
                "end": run[-1]["chainage"],
                "peak": max(r["value"] for r in run),
                "sev": run_sev,
            })

        for row in param_rows:
            sev = classify(param, row["value"])
            if sev == "ok":
                flush()
                run = []
                run_sev = None
                continue
            if run and sev != run_sev:
                # severity changed mid-run (e.g. warning -> critical) —
                # close the old run, start a new one
                flush()
                run = []
            run.append(row)
            run_sev = sev
        flush()

    return alerts


# ---------------------------------------------------------------------------
# Stage 3: API response time
# ---------------------------------------------------------------------------
def query_api(api_base, route):
    """
    Real HTTP call once the backend exists. Returns None (and elapsed
    time will just reflect the failed/skipped call) if the backend isn't
    up yet — this won't crash the whole script.
    """
    if requests is None or api_base is None:
        return None
    try:
        resp = requests.get(f"{api_base.rstrip('/')}{route}", timeout=10)
        return resp.status_code
    except Exception as e:
        return f"ERROR: {e}"


# ---------------------------------------------------------------------------
# Stage 4: Chainage query
# ---------------------------------------------------------------------------
def query_chainage(rows, chainage_value):
    """
    STUB — linear scan lookup for a single chainage across all rows.
    Once backend exists, replace with a real GET to something like
    /tracks?chainage=<value> and time that instead.
    """
    return [r for r in rows if abs(r["chainage"] - chainage_value) < 1e-6]


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------
def run_benchmark(csv_path, api_base=None, repeats=3):
    results = {}

    # Stage 1
    times = []
    rows = None
    for _ in range(repeats):
        rows, t = timed(process_dataset, csv_path)
        times.append(t)
    results["processing_time_sec"] = round(statistics.mean(times), 4)

    # Stage 2
    times = []
    alerts = None
    for _ in range(repeats):
        alerts, t = timed(generate_alerts, rows)
        times.append(t)
    results["alert_generation_sec"] = round(statistics.mean(times), 4)

    # Stage 3 (only meaningful once backend is live)
    api_times = []
    for route in ["/tracks", "/alerts", "/analytics", "/priority"]:
        _, t = timed(query_api, api_base, route)
        api_times.append(t)
    results["api_response_sec"] = round(statistics.mean(api_times), 4) if api_base else None

    # Stage 4
    sample_chainage = rows[len(rows) // 2]["chainage"] if rows else 0.0
    times = []
    for _ in range(repeats):
        _, t = timed(query_chainage, rows, sample_chainage)
        times.append(t)
    results["chainage_query_sec"] = round(statistics.mean(times), 4)

    results["row_count"] = len(rows) if rows else 0
    results["alert_count"] = len(alerts) if alerts else 0
    return results


def write_results(results, dataset_label, out_path="results/benchmark_results.csv"):
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    file_exists = os.path.isfile(out_path)
    with open(out_path, "a", newline="") as f:
        writer = csv.writer(f)
        if not file_exists:
            writer.writerow([
                "dataset_label", "row_count", "processing_time_sec",
                "alert_generation_sec", "api_response_sec", "chainage_query_sec",
                "alert_count",
            ])
        writer.writerow([
            dataset_label, results["row_count"], results["processing_time_sec"],
            results["alert_generation_sec"], results["api_response_sec"],
            results["chainage_query_sec"], results["alert_count"],
        ])
    print(f"Appended results to {out_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", required=True, help="Path to cleaned_data.csv")
    parser.add_argument("--api-base", default=None, help="e.g. http://localhost:3000 (optional)")
    parser.add_argument("--label", default=None, help="Label for this run, e.g. '10k rows'")
    parser.add_argument("--repeats", type=int, default=3)
    args = parser.parse_args()

    label = args.label or Path(args.csv).stem
    print(f"Running benchmark on: {args.csv}")
    results = run_benchmark(args.csv, api_base=args.api_base, repeats=args.repeats)
    print(results)
    write_results(results, label)
