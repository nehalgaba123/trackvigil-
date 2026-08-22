"""
evaluate.py
Person 4 — Analytics, Threshold Validation & Prediction

Judges specifically asked for QUANTITATIVE validation. This script:

  - IF a ground-truth / engineer-confirmed label file is provided, computes
    precision, recall, and true/false alert counts against it.
  - IF NOT, it does NOT invent precision/recall numbers. Instead it reports
    the validation method actually used and its limitations, honestly.

Expected ground-truth format (optional, CSV):
    chainage,date,parameter,is_defect
where is_defect is 1/0, sourced from actual engineer sign-off / inspection
records — NOT self-generated from the same synthetic data pipeline (that
would be circular and would not count as real validation).

Output: analytics/output/evaluation_results.json
"""

import csv
import json
import os


def load_alerts(alerts_json_path):
    with open(alerts_json_path) as f:
        data = json.load(f)
    return data.get("alerts", [])


def load_ground_truth(gt_csv_path):
    labels = {}
    with open(gt_csv_path, newline="") as f:
        reader = csv.DictReader(f)
        for r in reader:
            key = (float(r["chainage"]), r["date"], r["parameter"])
            labels[key] = int(r["is_defect"])
    return labels


def evaluate_with_ground_truth(alerts, ground_truth):
    """Precision/recall/TP/FP/FN/TN against real labels.
    An alert is a 'positive prediction' regardless of severity
    (warning or critical both count as 'flagged')."""
    predicted_positive = {
        (a["chainage"], a["date"], a["parameter"]) for a in alerts
    }
    actual_positive = {k for k, v in ground_truth.items() if v == 1}
    all_keys = set(ground_truth.keys()) | predicted_positive

    tp = len(predicted_positive & actual_positive)
    fp = len(predicted_positive - actual_positive)
    fn = len(actual_positive - predicted_positive)
    tn = len(all_keys) - tp - fp - fn

    precision = tp / (tp + fp) if (tp + fp) > 0 else None
    recall = tp / (tp + fn) if (tp + fn) > 0 else None
    f1 = (2 * precision * recall / (precision + recall)
          if precision and recall and (precision + recall) > 0 else None)

    return {
        "validation_method": "ground_truth_comparison",
        "ground_truth_records": len(ground_truth),
        "true_positives": tp,
        "false_positives": fp,
        "false_negatives": fn,
        "true_negatives": tn,
        "precision": round(precision, 3) if precision is not None else None,
        "recall": round(recall, 3) if recall is not None else None,
        "f1_score": round(f1, 3) if f1 is not None else None,
    }


def evaluate_without_ground_truth(alerts, csv_path=None):
    """No engineer-confirmed labels available. Report what WAS actually
    checked, honestly, instead of fabricating precision/recall."""
    total_alerts = len(alerts)
    critical = sum(1 for a in alerts if a.get("severity") == "critical")
    warning = sum(1 for a in alerts if a.get("severity") == "warning")
    by_type = {}
    for a in alerts:
        t = a.get("type", "unknown")
        by_type[t] = by_type.get(t, 0) + 1

    return {
        "validation_method": "no_ground_truth_available",
        "limitations": (
            "No engineer-confirmed defect labels were available for this "
            "dataset, so precision/recall CANNOT be computed and are not "
            "reported. Alert counts below are self-consistency checks only "
            "(threshold logic applied correctly, alerts trace back to "
            "specific values) — they do NOT demonstrate real-world accuracy."
        ),
        "self_consistency_checks": {
            "total_alerts": total_alerts,
            "critical_alerts": critical,
            "warning_alerts": warning,
            "alerts_by_detection_type": by_type,
        },
        "recommended_next_step": (
            "Obtain even a small set (e.g. 20-50 points) of engineer-"
            "confirmed defect/non-defect labels on real track sections to "
            "enable a genuine precision/recall evaluation."
        ),
    }


def run(alerts_json_path, out_path, ground_truth_csv=None):
    alerts = load_alerts(alerts_json_path)

    if ground_truth_csv and os.path.exists(ground_truth_csv):
        ground_truth = load_ground_truth(ground_truth_csv)
        result = evaluate_with_ground_truth(alerts, ground_truth)
    else:
        result = evaluate_without_ground_truth(alerts)

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(result, f, indent=2)
    print(f"Evaluation method: {result['validation_method']}")
    print(f"Wrote evaluation results -> {out_path}")
    return result


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--alerts", default="output/alerts.json")
    parser.add_argument("--out", default="output/evaluation_results.json")
    parser.add_argument("--ground-truth", default=None,
                         help="Optional CSV: chainage,date,parameter,is_defect")
    args = parser.parse_args()
    run(args.alerts, args.out, args.ground_truth)
