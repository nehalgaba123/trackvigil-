import json, sys
from pathlib import Path

# NOTE (integration fix): this file used to import helper functions
# (detect_alerts, detect_unresolved, group_alerts, analyze_trends,
# detect_anomalies, evaluate_alerts) that do not exist in the current
# alert_engine.py / trend_analysis.py / anomaly_detection.py / evaluate.py
# -- those modules were reworked at some point to each expose their own
# self-contained run(csv_path, out_path, ...) that reads the CSV and
# writes its own JSON file directly, rather than returning python objects
# for an outer orchestrator to combine. This orchestrator was never
# updated to match, so `python -m analytics.run_analytics` has never
# actually completed -- analytics/output/ only ever had a stale
# alerts.json from a separate stand-in script
# (backend/scripts/build-analytics-output.js), not from this pipeline.
#
# Fix: call each module's real run() in the right order instead of
# reimplementing their logic here. anomaly_detection runs first so its
# output can be merged into alert_engine's alerts (see alert_engine.py's
# merge_anomaly_alerts docstring -- anomalies are meant to stay distinct
# from threshold alerts, not replace them).
from . import alert_engine, anomaly_detection, trend_analysis, evaluate


def run(csv_path, outdir, source_label="uploaded", speed_class="B", ground_truth_csv=None):
    """Run the full analytics pipeline end to end and write every output
    file the backend (analyticsService.js) and frontend expect:
      alerts.json, trends.json, priority.json, anomalies.json,
      evaluation_results.json
    """
    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)

    anomalies_result = anomaly_detection.run(
        csv_path, str(out / "anomalies.json"), source_label=source_label
    )

    alerts_result = alert_engine.run(
        csv_path, str(out / "alerts.json"),
        source_label=source_label, speed_class=speed_class,
        anomaly_alerts=anomalies_result["anomalies"],
    )

    trends, priority = trend_analysis.run(
        csv_path, str(out / "trends.json"), str(out / "priority.json"),
        source_label=source_label, speed_class=speed_class,
    )

    evaluation_result = evaluate.run(
        str(out / "alerts.json"), str(out / "evaluation_results.json"),
        ground_truth_csv=ground_truth_csv,
    )

    return {
        "alerts": alerts_result["summary"]["total"],
        "critical": alerts_result["summary"]["critical"],
        "warning": alerts_result["summary"]["warning"],
        "anomalies": len(anomalies_result["anomalies"]),
        "trends": len(trends),
        "priority_records": len(priority),
        "evaluation_method": evaluation_result.get("validation_method"),
    }


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python -m analytics.run_analytics <csv_path> <outdir> [source_label] [speed_class]")
        sys.exit(1)
    csv_path = sys.argv[1]
    outdir = sys.argv[2]
    source_label = sys.argv[3] if len(sys.argv) > 3 else "uploaded"
    speed_class = sys.argv[4] if len(sys.argv) > 4 else "B"
    print(json.dumps(run(csv_path, outdir, source_label, speed_class), indent=2))
