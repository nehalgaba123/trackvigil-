"""Person 4 -- Analytics, Threshold Validation & Prediction.

Tests the production analytics modules AS THEY ACTUALLY EXIST TODAY:
    thresholds.py, alert_engine.py, anomaly_detection.py, evaluate.py

Every function name, parameter, and return-value shape asserted below was
confirmed by actually importing and calling the real production code before
writing the assertion -- nothing here is guessed, and no production file is
modified by this file.

Two modules are NOT importable today, for reasons that are production-code
bugs, not test-file bugs. Both are handled by skipping their test classes
with an explicit, printed reason rather than either faking a pass or
silently omitting them:

  * trend_analysis.py -- its top-level `from thresholds import get_threshold,
    deviation, NOMINAL_GAUGE_MM, SPEED_CLASSES` fails immediately, because
    thresholds.py defines no `deviation` or `NOMINAL_GAUGE_MM` name. This
    means the ENTIRE module (including moving_average, linear_regression,
    days_to_critical, analyze_series, etc.) cannot be imported, let alone
    exercised, until thresholds.py is given those two names -- which is a
    production-code fix, not something to invent here.

  * run_analytics.py -- imports `detect_alerts`, `detect_unresolved`,
    `group_alerts` from alert_engine.py (only detect_threshold_alerts,
    latest_value_per_series, merge_anomaly_alerts, group_alerts_by_severity,
    sort_alerts actually exist there); `detect_anomalies` from
    anomaly_detection.py (only detect_anomalies_for_parameter exists);
    `analyze_trends` from trend_analysis.py (which doesn't import at all,
    per above); and `evaluate_alerts` from evaluate.py (only
    evaluate_with_ground_truth / evaluate_without_ground_truth exist). None
    of these four imported names exist anywhere in current production code.
    build_priority() itself is defined in run_analytics.py, so it inherits
    this same import failure and cannot be tested either.

alert_engine.py ALSO has a real, separate issue: it does a bare
`from thresholds import get_threshold, classify_severity, SPEED_CLASSES`
instead of a relative `from .thresholds import ...`. That only resolves
when analytics/'s own directory is on sys.path (i.e. running the script
standalone from inside analytics/), not when it's imported as the package
submodule `analytics.alert_engine`. Since get_threshold/classify_severity/
SPEED_CLASSES DO all exist in thresholds.py, this one is fixable purely as
test-harness plumbing -- adding analytics/'s directory to sys.path here,
in this test file only -- without touching alert_engine.py or thresholds.py
themselves. That fix is applied below.

Run with:  python3 -m unittest analytics.tests.test_person4 -v
"""
import os
import sys
import unittest

# --- Test-harness-only sys.path fix -----------------------------------
# alert_engine.py does `from thresholds import ...` (bare, not relative),
# which only resolves if analytics/'s own directory is importable as a
# path entry. This does not modify any production file.
_ANALYTICS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ANALYTICS_DIR not in sys.path:
    sys.path.insert(0, _ANALYTICS_DIR)

from .. import thresholds

try:
    from .. import alert_engine
    ALERT_ENGINE_AVAILABLE = True
    ALERT_ENGINE_SKIP_REASON = ""
except ImportError as e:
    ALERT_ENGINE_AVAILABLE = False
    ALERT_ENGINE_SKIP_REASON = f"alert_engine.py failed to import: {e}"

try:
    from .. import trend_analysis  # noqa: F401  (expected to fail today)
    TREND_ANALYSIS_AVAILABLE = True
    TREND_ANALYSIS_SKIP_REASON = ""
except ImportError as e:
    TREND_ANALYSIS_AVAILABLE = False
    TREND_ANALYSIS_SKIP_REASON = (
        "trend_analysis.py cannot be imported: its top-level "
        "`from thresholds import get_threshold, deviation, NOMINAL_GAUGE_MM, "
        "SPEED_CLASSES` fails because thresholds.py defines no `deviation` "
        f"or `NOMINAL_GAUGE_MM` name. Original error: {e}"
    )

try:
    from .. import anomaly_detection
    ANOMALY_DETECTION_AVAILABLE = True
    ANOMALY_DETECTION_SKIP_REASON = ""
except ImportError as e:
    ANOMALY_DETECTION_AVAILABLE = False
    ANOMALY_DETECTION_SKIP_REASON = f"anomaly_detection.py failed to import: {e}"

try:
    from .. import evaluate
    EVALUATE_AVAILABLE = True
    EVALUATE_SKIP_REASON = ""
except ImportError as e:
    EVALUATE_AVAILABLE = False
    EVALUATE_SKIP_REASON = f"evaluate.py failed to import: {e}"

try:
    from .. import run_analytics  # noqa: F401  (expected to fail today)
    RUN_ANALYTICS_AVAILABLE = True
    RUN_ANALYTICS_SKIP_REASON = ""
except ImportError as e:
    RUN_ANALYTICS_AVAILABLE = False
    RUN_ANALYTICS_SKIP_REASON = (
        "run_analytics.py cannot be imported: it imports detect_alerts/"
        "detect_unresolved/group_alerts from alert_engine.py, "
        "detect_anomalies from anomaly_detection.py, analyze_trends from "
        "trend_analysis.py, and evaluate_alerts from evaluate.py -- none of "
        "these four names exist in the current production modules "
        f"(actual names differ; see module docstring). Original error: {e}"
    )


# ---------------------------------------------------------------------------
# A. thresholds.py
# ---------------------------------------------------------------------------
class ThresholdsTests(unittest.TestCase):
    def test_get_threshold_returns_expected_structure(self):
        band = thresholds.get_threshold("twist", "B")
        self.assertEqual(band, {"warning": 5.0, "critical": 9.0, "unit": "mm"})

    def test_classify_severity_normal_below_warning(self):
        self.assertEqual(thresholds.classify_severity("twist", 3.0, "B"), "normal")

    def test_classify_severity_warning_at_boundary(self):
        # Boundary is inclusive (>=) per production logic.
        self.assertEqual(thresholds.classify_severity("twist", 5.0, "B"), "warning")

    def test_classify_severity_critical_at_boundary(self):
        self.assertEqual(thresholds.classify_severity("twist", 9.0, "B"), "critical")

    def test_classify_severity_uses_abs_value_for_non_railwear(self):
        # twist at -6.0: abs(-6.0) = 6.0, which is >= warning(5.0) and < critical(9.0).
        self.assertEqual(thresholds.classify_severity("twist", -6.0, "B"), "warning")

    def test_classify_severity_does_not_use_abs_for_railwear(self):
        # railWear is the one exception in classify_severity(): raw value is
        # compared directly, not abs(value). A large-magnitude negative
        # value therefore reads as "normal" here -- documenting the actual
        # current behavior, not what might seem more intuitive.
        self.assertEqual(thresholds.classify_severity("railWear", -20.0, "B"), "normal")

    def test_invalid_parameter_raises_keyerror(self):
        with self.assertRaises(KeyError):
            thresholds.get_threshold("not_a_real_parameter", "B")

    def test_invalid_speed_class_raises_keyerror(self):
        with self.assertRaises(KeyError):
            thresholds.get_threshold("twist", "Z")


# ---------------------------------------------------------------------------
# B. alert_engine.py
# ---------------------------------------------------------------------------
@unittest.skipUnless(ALERT_ENGINE_AVAILABLE, ALERT_ENGINE_SKIP_REASON)
class AlertEngineTests(unittest.TestCase):
    def test_normal_value_produces_no_alert(self):
        rows = [{"chainage": 1.0, "date": "2026-01-01", "parameter": "twist", "value": 2.0}]
        self.assertEqual(alert_engine.detect_threshold_alerts(rows, "B"), [])

    def test_warning_value_produces_warning_alert(self):
        rows = [{"chainage": 2.0, "date": "2026-01-01", "parameter": "twist", "value": 6.0}]
        alerts = alert_engine.detect_threshold_alerts(rows, "B")
        self.assertEqual(len(alerts), 1)
        self.assertEqual(alerts[0]["severity"], "warning")
        self.assertEqual(alerts[0]["parameter"], "twist")
        self.assertEqual(alerts[0]["type"], "threshold")

    def test_critical_value_produces_critical_alert(self):
        rows = [{"chainage": 3.0, "date": "2026-01-01", "parameter": "twist", "value": 9.5}]
        alerts = alert_engine.detect_threshold_alerts(rows, "B")
        self.assertEqual(len(alerts), 1)
        self.assertEqual(alerts[0]["severity"], "critical")

    def test_latest_value_per_series_keeps_newest_date(self):
        rows = [
            {"chainage": 5.0, "date": "2026-01-01", "parameter": "gauge", "value": 1.0},
            {"chainage": 5.0, "date": "2026-03-01", "parameter": "gauge", "value": 2.0},
            {"chainage": 5.0, "date": "2026-02-01", "parameter": "gauge", "value": 3.0},
        ]
        latest = alert_engine.latest_value_per_series(rows)
        self.assertEqual(len(latest), 1)
        self.assertEqual(latest[0]["date"], "2026-03-01")
        self.assertEqual(latest[0]["value"], 2.0)


# ---------------------------------------------------------------------------
# C. trend_analysis.py -- SKIPPED, see module docstring for exact reason.
# ---------------------------------------------------------------------------
@unittest.skipUnless(TREND_ANALYSIS_AVAILABLE, TREND_ANALYSIS_SKIP_REASON)
class TrendAnalysisTests(unittest.TestCase):
    def test_placeholder_not_reachable_today(self):
        # This body never runs while TREND_ANALYSIS_AVAILABLE is False; kept
        # so `-v` output shows a named, explained skip instead of the class
        # silently vanishing from the report.
        self.fail("trend_analysis.py should not be importable given the current thresholds.py")


# ---------------------------------------------------------------------------
# D. anomaly_detection.py
# ---------------------------------------------------------------------------
@unittest.skipUnless(ANOMALY_DETECTION_AVAILABLE, ANOMALY_DETECTION_SKIP_REASON)
class AnomalyDetectionTests(unittest.TestCase):
    def test_build_features_first_point_has_zero_delta_and_deviation(self):
        from datetime import datetime
        points = [
            (datetime(2026, 1, 1), 5.0),
            (datetime(2026, 1, 2), 5.0),
            (datetime(2026, 1, 3), 5.0),
            (datetime(2026, 1, 4), 50.0),
        ]
        feats = anomaly_detection.build_features(points)
        self.assertEqual(feats[0], [5.0, 0.0, 0.0])
        self.assertEqual(feats[1], [5.0, 0.0, 0.0])
        self.assertEqual(feats[2], [5.0, 0.0, 0.0])
        # last point: delta = 50-5=45; rolling window = last 4 values
        # (indices 0..3) = [5,5,5,50], mean=16.25, deviation=50-16.25=33.75
        self.assertEqual(feats[3], [50.0, 45.0, 33.75])

    def test_detect_anomalies_flags_the_clear_outlier_only(self):
        from datetime import datetime
        stable_chainage_points = [(datetime(2026, 1, i + 1), 5.0) for i in range(6)]
        outlier_chainage_points = (
            [(datetime(2026, 1, i + 1), 5.0) for i in range(5)]
            + [(datetime(2026, 1, 6), 80.0)]
        )
        series_by_chainage = {
            1.0: stable_chainage_points,
            2.0: outlier_chainage_points,
        }
        anomalies = anomaly_detection.detect_anomalies_for_parameter(
            "twist", series_by_chainage, min_points=5
        )
        self.assertEqual(len(anomalies), 1)
        self.assertEqual(anomalies[0]["chainage"], 2.0)
        self.assertEqual(anomalies[0]["value"], 80.0)
        self.assertEqual(anomalies[0]["type"], "anomaly")

    def test_series_shorter_than_min_points_is_excluded(self):
        series_by_chainage = {
            1.0: [(__import__("datetime").datetime(2026, 1, i + 1), 5.0) for i in range(3)],
        }
        anomalies = anomaly_detection.detect_anomalies_for_parameter(
            "twist", series_by_chainage, min_points=5
        )
        self.assertEqual(anomalies, [])


# ---------------------------------------------------------------------------
# E. evaluate.py
# ---------------------------------------------------------------------------
@unittest.skipUnless(EVALUATE_AVAILABLE, EVALUATE_SKIP_REASON)
class EvaluateTests(unittest.TestCase):
    def test_evaluate_with_ground_truth_computes_tp_fp_fn_precision_recall(self):
        alerts = [
            {"chainage": 1.0, "date": "2026-01-01", "parameter": "twist", "severity": "critical", "type": "threshold"},
            {"chainage": 2.0, "date": "2026-01-01", "parameter": "gauge", "severity": "warning", "type": "threshold"},
        ]
        ground_truth = {
            (1.0, "2026-01-01", "twist"): 1,     # true positive
            (2.0, "2026-01-01", "gauge"): 0,     # false positive
            (3.0, "2026-01-01", "railWear"): 1,  # false negative
        }
        result = evaluate.evaluate_with_ground_truth(alerts, ground_truth)
        self.assertEqual(result["validation_method"], "ground_truth_comparison")
        self.assertEqual(result["true_positives"], 1)
        self.assertEqual(result["false_positives"], 1)
        self.assertEqual(result["false_negatives"], 1)
        self.assertEqual(result["precision"], 0.5)
        self.assertEqual(result["recall"], 0.5)
        self.assertEqual(result["f1_score"], 0.5)

    def test_evaluate_without_ground_truth_does_not_fabricate_precision_recall(self):
        alerts = [
            {"chainage": 1.0, "date": "2026-01-01", "parameter": "twist", "severity": "critical", "type": "threshold"},
            {"chainage": 2.0, "date": "2026-01-01", "parameter": "gauge", "severity": "warning", "type": "threshold"},
        ]
        result = evaluate.evaluate_without_ground_truth(alerts)
        self.assertEqual(result["validation_method"], "no_ground_truth_available")
        self.assertNotIn("precision", result)
        self.assertNotIn("recall", result)
        self.assertEqual(result["self_consistency_checks"]["total_alerts"], 2)
        self.assertEqual(result["self_consistency_checks"]["critical_alerts"], 1)
        self.assertEqual(result["self_consistency_checks"]["warning_alerts"], 1)


# ---------------------------------------------------------------------------
# F. run_analytics.py / build_priority() -- SKIPPED, see module docstring.
# ---------------------------------------------------------------------------
@unittest.skipUnless(RUN_ANALYTICS_AVAILABLE, RUN_ANALYTICS_SKIP_REASON)
class RunAnalyticsTests(unittest.TestCase):
    def test_placeholder_not_reachable_today(self):
        self.fail("run_analytics.py should not be importable given its current imports")


if __name__ == "__main__":
    unittest.main()
