"""
anomaly_detection.py
Person 4 — Analytics, Threshold Validation & Prediction

Role: detect STATISTICALLY UNUSUAL observations/patterns that fixed
thresholds might miss (e.g. a value that's technically inside the
warning band but wildly inconsistent with that chainage's own history,
or a sudden jump). This is deliberately separate from alert_engine.py:

  alert_engine.py      -> "is this value past a known, validated limit?"
  anomaly_detection.py -> "is this value/pattern statistically unusual,
                           regardless of the fixed limit?"

Uses Isolation Forest (scikit-learn) per parameter across all chainages,
using engineered features (current value, short-term rate of change,
deviation from that chainage's own rolling mean) rather than raw value
alone, so it can catch abnormal *behaviour*, not just extreme numbers.

Input:  data/processed/cleaned_data.csv
Output: analytics/output/anomalies.json (merged into alerts.json by
        alert_engine.py as type="anomaly")
"""

import csv
import json
import os
from collections import defaultdict
from datetime import datetime

import numpy as np
from sklearn.ensemble import IsolationForest

CONTAMINATION = 0.05  # expected fraction of outliers; tune per dataset size
RANDOM_STATE = 42


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
    series = defaultdict(list)
    for r in rows:
        series[(r["chainage"], r["parameter"])].append((r["date"], r["value"]))
    for key in series:
        series[key].sort(key=lambda t: t[0])
    return series


def build_features(points):
    """For each point in a (chainage, parameter) series, build:
      [value, delta_from_prev, deviation_from_rolling_mean]
    First point has delta=0, deviation=0 (no history yet)."""
    values = [v for _, v in points]
    features = []
    for i, v in enumerate(values):
        delta = v - values[i - 1] if i > 0 else 0.0
        window = values[max(0, i - 3):i + 1]
        rolling_mean = sum(window) / len(window)
        deviation = v - rolling_mean
        features.append([v, delta, deviation])
    return features


def detect_anomalies_for_parameter(parameter, series_by_chainage, min_points=5):
    """Fit one Isolation Forest per parameter across all chainages'
    feature rows, so it learns what 'normal' looks like for that
    parameter overall, then flags outlier points."""
    all_features = []
    lookup = []  # parallel list: (chainage, date, value)

    for chainage, points in series_by_chainage.items():
        if len(points) < min_points:
            continue  # not enough history to judge abnormal behaviour
        feats = build_features(points)
        for (date, value), f in zip(points, feats):
            all_features.append(f)
            lookup.append((chainage, date, value))

    if len(all_features) < 10:
        return []  # not enough data across the board to train meaningfully

    X = np.array(all_features)
    model = IsolationForest(contamination=CONTAMINATION, random_state=RANDOM_STATE)
    preds = model.fit_predict(X)          # -1 = anomaly, 1 = normal
    scores = model.score_samples(X)        # lower = more anomalous

    anomalies = []
    for (chainage, date, value), pred, score in zip(lookup, preds, scores):
        if pred == -1:
            anomalies.append({
                "chainage": chainage,
                "parameter": parameter,
                "value": value,
                "date": date.strftime("%Y-%m-%d"),
                "anomaly_score": round(float(score), 4),
                "type": "anomaly",
            })
    return anomalies


def run(csv_path, out_path, source_label="uploaded"):
    rows = load_rows(csv_path)
    series = group_series(rows)

    # regroup by parameter -> {chainage: [(date, value), ...]}
    by_parameter = defaultdict(dict)
    for (chainage, parameter), points in series.items():
        by_parameter[parameter][chainage] = points

    all_anomalies = []
    for parameter, chainage_series in by_parameter.items():
        all_anomalies.extend(detect_anomalies_for_parameter(parameter, chainage_series))

    # severity for anomalies is informational, not threshold-derived —
    # flag as 'warning' by default so it doesn't overstate certainty
    for a in all_anomalies:
        a["severity"] = "warning"

    output = {
        "source": source_label,
        "anomalies": all_anomalies,
        "method": "IsolationForest (contamination=%.2f) on [value, delta, rolling_deviation] features per parameter" % CONTAMINATION,
    }

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(output, f, indent=2)
    print(f"Wrote {len(all_anomalies)} anomalies -> {out_path}")
    return output


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", default="../data/processed/cleaned_data.csv")
    parser.add_argument("--out", default="output/anomalies.json")
    parser.add_argument("--source", default="uploaded", choices=["uploaded", "synthetic"])
    args = parser.parse_args()
    run(args.csv, args.out, args.source)
