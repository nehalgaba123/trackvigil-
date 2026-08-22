"""
trend_analysis.py
Person 4 — Analytics, Threshold Validation & Prediction

Two clearly separated techniques (per project rules):

  Moving Average   -> smooths noise, shows underlying deterioration pattern.
                       Used only for display/de-noising, NOT for the rate
                       used in the critical-date projection.

  Linear Regression -> fit on the (de-noised) time series to estimate
                       direction + rate of degradation, and project when
                       the value will cross the critical threshold.

Formula:
  current value + estimated degradation rate -> critical threshold
  => estimated time to critical (days)

Input:  data/processed/cleaned_data.csv (chainage,date,parameter,value)
Output: analytics/output/trends.json, analytics/output/priority.json
"""

import csv
import json
import math
import os
from collections import defaultdict
from datetime import datetime, timedelta

from thresholds import get_threshold, deviation, NOMINAL_GAUGE_MM, SPEED_CLASSES

DEFAULT_SPEED_CLASS = "B"
MOVING_AVERAGE_WINDOW = 3
MIN_POINTS_FOR_REGRESSION = 3


def load_rows(csv_path):
    rows = []
    with open(csv_path, newline="") as f:
        reader = csv.DictReader(f)
        for r in reader:
            rows.append({
                "chainage": float(r["chainage"]),
                "date": datetime.strptime(r["date"], "%Y-%m-%d"),
                "parameter": r["parameter"],
                "value": float(r["value"]),
            })
    return rows


def group_series(rows):
    """Group into {(chainage, parameter): [(date, value), ...]} sorted by date."""
    series = defaultdict(list)
    for r in rows:
        series[(r["chainage"], r["parameter"])].append((r["date"], r["value"]))
    for key in series:
        series[key].sort(key=lambda t: t[0])
    return series


def moving_average(values, window=MOVING_AVERAGE_WINDOW):
    """Simple trailing moving average, used only to de-noise for display
    and to feed a cleaner signal into the regression."""
    if len(values) < window:
        return values[:]
    out = []
    for i in range(len(values)):
        lo = max(0, i - window + 1)
        out.append(sum(values[lo:i + 1]) / (i - lo + 1))
    return out


def linear_regression(x, y):
    """Ordinary least squares. x = days since first observation (float),
    y = value. Returns (slope, intercept). slope unit = value/day."""
    n = len(x)
    if n < 2:
        return 0.0, y[0] if y else 0.0
    mean_x = sum(x) / n
    mean_y = sum(y) / n
    num = sum((xi - mean_x) * (yi - mean_y) for xi, yi in zip(x, y))
    den = sum((xi - mean_x) ** 2 for xi in x)
    if den == 0:
        return 0.0, mean_y
    slope = num / den
    intercept = mean_y - slope * mean_x
    return slope, intercept


def days_to_critical(current_deviation, deviation_slope, critical_threshold):
    """How many days until the deviation-from-nominal reaches the critical
    threshold, given a linear rate `deviation_slope` (units/day, already
    signed so that positive = moving toward critical).

    Works uniformly for gauge, railWear, and the centered parameters,
    because the caller always passes DEVIATION values, not raw values.

    Returns None if not trending toward critical (avoids false predictions).
    """
    if current_deviation >= critical_threshold:
        return 0
    if deviation_slope <= 1e-6:
        return None  # flat or improving — not heading to critical
    remaining = critical_threshold - current_deviation
    return remaining / deviation_slope


def analyze_series(chainage, parameter, points, speed_class=DEFAULT_SPEED_CLASS):
    if len(points) < 1:
        return None

    dates = [p[0] for p in points]
    raw_values = [p[1] for p in points]

    # Work in DEVIATION space for regression/threshold comparison (handles
    # gauge's absolute-mm storage vs. the other centered-at-0 parameters
    # uniformly — see thresholds.deviation()). Keep raw_values separately
    # so we can still report the actual current measurement.
    deviations = [deviation(parameter, v) for v in raw_values]
    smoothed_dev = moving_average(deviations)

    current_value = raw_values[-1]
    current_deviation = deviations[-1]
    band = get_threshold(parameter, speed_class)
    critical_threshold = band["critical"]

    trend_direction = "stable"
    rate = 0.0
    est_days = None
    predicted_date = None

    if len(points) >= MIN_POINTS_FOR_REGRESSION:
        t0 = dates[0]
        x = [(d - t0).days for d in dates]
        slope, _ = linear_regression(x, smoothed_dev)  # slope of deviation/day
        rate = slope

        if slope > 1e-3:
            trend_direction = "worsening"
        elif slope < -1e-3:
            trend_direction = "improving"
        else:
            trend_direction = "stable"

        est_days = days_to_critical(current_deviation, slope, critical_threshold)
        if est_days is not None:
            predicted_date = (dates[-1] + timedelta(days=est_days)).strftime("%Y-%m-%d")
            est_days = round(est_days, 1)

    return {
        "chainage": chainage,
        "parameter": parameter,
        "current_value": round(current_value, 3),
        "current_deviation": round(current_deviation, 3),
        "trend_direction": trend_direction,
        "rate_of_degradation": round(rate, 4),
        "rate_unit": f"{band['unit']}/day",
        "critical_threshold": critical_threshold,
        "estimated_days_to_critical": est_days,
        "predicted_critical_date": predicted_date,
    }


def build_trends(csv_path, speed_class=DEFAULT_SPEED_CLASS):
    rows = load_rows(csv_path)
    series = group_series(rows)
    trends = []
    for (chainage, parameter), points in series.items():
        result = analyze_series(chainage, parameter, points, speed_class)
        if result:
            trends.append(result)
    return trends


def build_priority_list(trends):
    """Rank by estimated days to critical, ascending. Items with no
    prediction (None) are excluded from the ranked list — you can't
    prioritize maintenance on an undefined ETA."""
    predictable = [t for t in trends if t["estimated_days_to_critical"] is not None]
    predictable.sort(key=lambda t: t["estimated_days_to_critical"])

    priority = []
    for i, t in enumerate(predictable, start=1):
        priority.append({
            "rank": i,
            "chainage": t["chainage"],
            "parameter": t["parameter"],
            "severity": "critical" if t["estimated_days_to_critical"] <= 30 else "warning",
            "current_value": t["current_value"],
            "critical_threshold": t["critical_threshold"],
            "estimated_days_to_critical": t["estimated_days_to_critical"],
        })
    return priority


def run(csv_path, trends_out, priority_out, source_label="uploaded", speed_class=DEFAULT_SPEED_CLASS):
    trends = build_trends(csv_path, speed_class)
    priority = build_priority_list(trends)

    os.makedirs(os.path.dirname(trends_out), exist_ok=True)
    with open(trends_out, "w") as f:
        json.dump({"source": source_label, "trends": trends}, f, indent=2)
    with open(priority_out, "w") as f:
        json.dump({"source": source_label, "priority": priority}, f, indent=2)

    print(f"Wrote {len(trends)} trend entries -> {trends_out}")
    print(f"Wrote {len(priority)} priority entries -> {priority_out}")
    return trends, priority


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", default="../data/processed/cleaned_data.csv")
    parser.add_argument("--trends-out", default="output/trends.json")
    parser.add_argument("--priority-out", default="output/priority.json")
    parser.add_argument("--source", default="uploaded", choices=["uploaded", "synthetic"])
    parser.add_argument("--speed-class", default=DEFAULT_SPEED_CLASS, choices=SPEED_CLASSES)
    args = parser.parse_args()
    run(args.csv, args.trends_out, args.priority_out, args.source, args.speed_class)
