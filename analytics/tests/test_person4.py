"""Person 4 -- Analytics, Threshold Validation & Prediction.

TEST-ONLY module. Written by reading the CURRENT production files
(thresholds.py, alert_engine.py, trend_analysis.py, anomaly_detection.py,
evaluate.py, run_analytics.py) directly -- not by reusing assumptions from
earlier test versions or prior conversations.

No docs/data_format.md was found anywhere on disk in this environment, so
the locked CSV contract (chainage, date, parameter, value) is taken from
the shape every module here already reads/writes consistently (rows as
dicts with those four keys; see run_analytics.load(), alert_engine.py,
trend_analysis.py, anomaly_detection.py).

These tests only assert behavior that is actually present in the current
implementation:
  * verified numeric limits used below (twist 5/7 mm/m for the <=100 kmph
    band; railWear renewal 13mm@60kg / 8mm@50kg) are copied from
    thresholds.py's own _TWIST_TABLE / _RAILWEAR_RENEWAL, not invented
    here;
  * gauge, alignment, and unevenness have NO verified numeric NBML/UML
    table in the current code at all, so no "evaluated" test is written
    for them -- only context_required / not_evaluable behavior, which is
    what the current resolvers actually return;
  * anomaly detection and evaluate_alerts(labels=...) use hand-computed,
    deterministic expected values (shown in comments) so nothing here
    relies on randomness.

Run with:  python3 -m unittest analytics.tests.test_person4 -v
"""
import unittest
from datetime import date, timedelta

from ..thresholds import PARAMETERS, evaluate_parameter, get_thresholds, export_contract
from ..alert_engine import detect_alerts, detect_unresolved, group_alerts
from ..trend_analysis import analyze_trends
from ..anomaly_detection import detect_anomalies
from ..evaluate import evaluate_alerts
from ..run_analytics import build_priority


# ---------------------------------------------------------------------------
# 1. Locked parameters
# ---------------------------------------------------------------------------

class LockedParametersTests(unittest.TestCase):
    """The six locked parameters must be exactly what thresholds.PARAMETERS
    declares, and evaluate_parameter() must accept every one of them
    without raising -- source of truth is PARAMETERS itself, not a
    duplicated literal tuple."""

    def test_locked_parameter_set(self):
        self.assertEqual(
            set(PARAMETERS),
            {"gauge", "alignment", "twist", "unevenness", "crossLevel", "railWear"},
        )

    def test_every_locked_parameter_is_accepted_by_evaluate_parameter(self):
        for p in PARAMETERS:
            # Empty context is enough to prove the parameter itself is
            # accepted (no ValueError) -- it may still come back
            # context_required/not_evaluable, which is fine and expected.
            result = evaluate_parameter(p, 1.0, context={})
            self.assertEqual(result["parameter"], p)
            self.assertIn(result["evaluation_status"],
                           ("evaluated", "context_required", "not_evaluable"))


# ---------------------------------------------------------------------------
# 2. Unknown parameters -- only where the current code actually validates
# ---------------------------------------------------------------------------

class UnknownParameterTests(unittest.TestCase):
    """Inspection of the current code shows different unknown-parameter
    behavior per function:
      * evaluate_parameter(): raises ValueError (explicit check).
      * get_thresholds(overrides=...) / export_contract(overrides=...):
        raise ValueError for an unknown key in `overrides`.
      * analyze_trends(): raises ValueError indirectly, because it calls
        evaluate_parameter() internally for every row.
      * detect_alerts() / detect_unresolved(): do NOT raise -- they
        silently skip rows whose parameter isn't in PARAMETERS
        (`if p not in PARAMETERS: continue`).
      * detect_anomalies(): does not validate parameter against
        PARAMETERS at all; it operates on whatever string is present.
    Each test below matches the function's *actual* behavior rather than
    assuming uniform validation everywhere.
    """

    def test_evaluate_parameter_raises_for_unknown_parameter(self):
        with self.assertRaises(ValueError):
            evaluate_parameter("notARealParameter", 1.0)

    def test_get_thresholds_raises_for_unknown_override_key(self):
        with self.assertRaises(ValueError):
            get_thresholds(overrides={"notARealParameter": {}})

    def test_export_contract_raises_for_unknown_override_key(self):
        with self.assertRaises(ValueError):
            export_contract(overrides={"notARealParameter": {}})

    def test_analyze_trends_raises_for_unknown_parameter_row(self):
        rows = [{"chainage": 1.0, "date": "2026-01-01",
                  "parameter": "notARealParameter", "value": 1.0}]
        with self.assertRaises(ValueError):
            analyze_trends(rows)

    def test_detect_alerts_silently_skips_unknown_parameter_rows(self):
        rows = [{"chainage": 1.0, "date": "2026-01-01",
                  "parameter": "notARealParameter", "value": 1.0}]
        self.assertEqual(detect_alerts(rows), [])

    def test_detect_unresolved_silently_skips_unknown_parameter_rows(self):
        rows = [{"chainage": 1.0, "date": "2026-01-01",
                  "parameter": "notARealParameter", "value": 1.0}]
        self.assertEqual(detect_unresolved(rows), [])

    def test_detect_anomalies_does_not_validate_parameter_name(self):
        # detect_anomalies groups purely by the 'parameter' string with no
        # PARAMETERS check -- an unrecognized name is processed like any
        # other. 20 identical values + 1 outlier is the same deterministic
        # shape used in AnomalyDetectionTests below.
        rows = [{"chainage": 1.0, "date": _iso(i), "parameter": "notARealParameter", "value": 10.0}
                for i in range(20)]
        rows.append({"chainage": 1.0, "date": _iso(20), "parameter": "notARealParameter", "value": 13.0})
        out = detect_anomalies(rows)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["parameter"], "notARealParameter")


def _iso(days_after_epoch, start=date(2026, 1, 1)):
    return (start + timedelta(days=days_after_epoch)).isoformat()


# ---------------------------------------------------------------------------
# 3 & 4. Threshold engine / twist
# ---------------------------------------------------------------------------

class TwistTests(unittest.TestCase):
    """Reads the actual verified twist figures out of get_thresholds()
    rather than hardcoding 5.0/7.0 twice, per the task's 'read the actual
    verified table' guidance -- the literal 5.0/7.0 assertions in
    test_reads_verified_table_matches_known_values exist only to catch a
    genuine drift in the source table, and are themselves copied straight
    from thresholds.py's docstring/_TWIST_TABLE, not invented."""

    def setUp(self):
        self.verified_band = get_thresholds()["twist"]["verified_bands"]["upto_100"]

    def test_reads_verified_table_matches_known_values(self):
        self.assertEqual(self.verified_band["nbml"], 5.0)
        self.assertEqual(self.verified_band["uml"], 7.0)

    def test_a_verified_speed_context_evaluates(self):
        r = evaluate_parameter("twist", 1.0, context={"speed_kmph": 80})
        self.assertEqual(r["evaluation_status"], "evaluated")

    def test_b_below_nbml_is_normal(self):
        below = self.verified_band["nbml"] - 1.0
        r = evaluate_parameter("twist", below, context={"speed_kmph": 80})
        self.assertEqual(r["severity"], "normal")
        self.assertEqual(r["evaluation_status"], "evaluated")

    def test_c_at_nbml_is_warning(self):
        r = evaluate_parameter("twist", self.verified_band["nbml"], context={"speed_kmph": 80})
        self.assertEqual(r["severity"], "warning")
        self.assertEqual(r["nbml"]["value"], self.verified_band["nbml"])

    def test_d_at_uml_is_critical(self):
        r = evaluate_parameter("twist", self.verified_band["uml"], context={"speed_kmph": 80})
        self.assertEqual(r["severity"], "critical")
        self.assertEqual(r["uml"]["value"], self.verified_band["uml"])

    def test_e_missing_speed_context_is_context_required(self):
        r = evaluate_parameter("twist", 6.0, context={})
        self.assertEqual(r["evaluation_status"], "context_required")
        self.assertIsNone(r["severity"])

    def test_unverified_speed_band_is_context_required_not_fabricated(self):
        # >100 kmph has no entry in _TWIST_TABLE; the resolver must not
        # extrapolate a threshold for it.
        r = evaluate_parameter("twist", 6.0, context={"speed_kmph": 160})
        self.assertEqual(r["evaluation_status"], "context_required")
        self.assertIsNone(r["severity"])
        self.assertIsNone(r["nbml"])
        self.assertIsNone(r["uml"])

    def test_context_required_never_reported_as_normal(self):
        r = evaluate_parameter("twist", 6.0, context={})
        self.assertNotEqual(r["evaluation_status"], "evaluated")
        self.assertIsNone(r["severity"])  # never coerced to "normal"


# ---------------------------------------------------------------------------
# Gauge / alignment / unevenness: no verified numeric table exists in the
# current thresholds.py, so these stay context_required regardless of how
# complete the structural context is. Testing "evaluated" here would
# require a threshold the code does not have -- explicitly out of scope
# per the task instructions.
# ---------------------------------------------------------------------------

class GaugeTests(unittest.TestCase):
    def test_missing_context_is_context_required(self):
        r = evaluate_parameter("gauge", 4.0, context={})
        self.assertEqual(r["evaluation_status"], "context_required")
        self.assertIsNone(r["severity"])

    def test_full_structural_context_still_context_required(self):
        # _resolve_gauge unconditionally appends "verified_nbml_uml_table"
        # to missing_context regardless of track_type/curve_radius_m -- no
        # numeric gauge table exists yet in this codebase.
        r = evaluate_parameter(
            "gauge", 4.0,
            context={"track_type": "curve", "curve_radius_m": 500},
        )
        self.assertEqual(r["evaluation_status"], "context_required")
        self.assertIsNone(r["severity"])
        self.assertIn("verified_nbml_uml_table", r["missing_context"])

    def test_context_required_not_treated_as_normal(self):
        r = evaluate_parameter("gauge", 4.0, context={})
        self.assertIsNone(r["severity"])


class AlignmentTests(unittest.TestCase):
    def test_geometry_result_is_represented(self):
        r = evaluate_parameter(
            "alignment", 4.5,
            context={"measurement_type": "SD", "chord_or_base_m": 10},
        )
        self.assertEqual(r["parameter"], "alignment")
        self.assertEqual(r["value"], 4.5)
        self.assertIn("alignment", r["metric"])

    def test_uml_unavailable_acceleration_based(self):
        r = evaluate_parameter(
            "alignment", 4.5,
            context={"measurement_type": "SD", "chord_or_base_m": 10},
        )
        self.assertEqual(r["evaluation_status"], "context_required")
        self.assertIsNone(r["severity"])
        self.assertEqual(r["uml"]["evaluation_status"], "UML_requires_acceleration")


class UnevennessTests(unittest.TestCase):
    def test_geometry_result_is_represented(self):
        r = evaluate_parameter(
            "unevenness", 3.2,
            context={"measurement_type": "UN-1", "chord_or_base_m": 10,
                     "speed_band": "upto_100"},
        )
        self.assertEqual(r["parameter"], "unevenness")
        self.assertEqual(r["value"], 3.2)

    def test_uml_unavailable_acceleration_based(self):
        r = evaluate_parameter(
            "unevenness", 3.2,
            context={"measurement_type": "UN-1", "chord_or_base_m": 10,
                     "speed_band": "upto_100"},
        )
        self.assertEqual(r["evaluation_status"], "context_required")
        self.assertIsNone(r["severity"])
        # Same nested label as alignment's -- both currently read
        # "UML_requires_acceleration".
        self.assertEqual(r["uml"]["evaluation_status"], "UML_requires_acceleration")


class CrossLevelTests(unittest.TestCase):
    def test_no_standalone_threshold(self):
        r = evaluate_parameter("crossLevel", 9.3, context={})
        self.assertEqual(r["evaluation_status"], "not_evaluable")
        self.assertIsNone(r["severity"])

    def test_never_classified_critical_regardless_of_magnitude(self):
        for v in (0.0, 5.0, 50.0, 500.0):
            r = evaluate_parameter("crossLevel", v, context={})
            self.assertIsNone(r["severity"])
            self.assertEqual(r["evaluation_status"], "not_evaluable")

    def test_context_does_not_change_not_evaluable(self):
        # _resolve_crossLevel takes no context fields at all -- passing
        # some should have no effect.
        r = evaluate_parameter("crossLevel", 9.3, context={"speed_kmph": 80})
        self.assertEqual(r["evaluation_status"], "not_evaluable")


# ---------------------------------------------------------------------------
# 5. Rail wear
# ---------------------------------------------------------------------------

class RailWearTests(unittest.TestCase):
    def setUp(self):
        self.renewal_table = get_thresholds()["railWear"]["renewal_criteria"]

    def test_missing_rail_section_is_context_required(self):
        r = evaluate_parameter("railWear", 10.0, context={})
        self.assertEqual(r["evaluation_status"], "context_required")
        self.assertIn("rail_section", r["missing_context"])

    def test_supported_section_60kg_asset_renewal(self):
        renewal = self.renewal_table["60kg"]
        r = evaluate_parameter("railWear", renewal - 1.0, context={"rail_section": "60kg"})
        self.assertEqual(r["evaluation_status"], "evaluated")
        self.assertIsNone(r["severity"])  # renewal criterion, not a severity
        self.assertEqual(r["asset_renewal"]["renewal_threshold"]["value"], renewal)
        self.assertFalse(r["asset_renewal"]["at_or_beyond_renewal"])

    def test_supported_section_50kg_at_renewal(self):
        renewal = self.renewal_table["50kg"]
        r = evaluate_parameter("railWear", renewal, context={"rail_section": "50kg"})
        self.assertEqual(r["evaluation_status"], "evaluated")
        self.assertEqual(r["asset_renewal"]["renewal_threshold"]["value"], renewal)
        self.assertTrue(r["asset_renewal"]["at_or_beyond_renewal"])

    def test_unsupported_rail_section_is_context_required(self):
        # A section not present in _RAILWEAR_RENEWAL (e.g. "52kg", noted
        # in thresholds.py as mentioned-but-not-confirmed) must not be
        # silently given a fabricated renewal figure.
        self.assertNotIn("52kg", self.renewal_table)
        r = evaluate_parameter("railWear", 10.0, context={"rail_section": "52kg"})
        self.assertEqual(r["evaluation_status"], "context_required")

    def test_renewal_criterion_not_represented_as_uml_or_severity(self):
        renewal = self.renewal_table["60kg"]
        r = evaluate_parameter("railWear", renewal + 1.0, context={"rail_section": "60kg"})
        self.assertIsNone(r["uml"])
        self.assertIsNone(r["severity"])
        self.assertIn("asset_renewal", r)
        self.assertEqual(r["asset_renewal"]["threshold_type"], "asset_renewal")


# ---------------------------------------------------------------------------
# 6. Alert engine
# ---------------------------------------------------------------------------

class AlertEngineTests(unittest.TestCase):
    def test_evaluated_warning_becomes_a_confirmed_alert(self):
        nbml = get_thresholds()["twist"]["verified_bands"]["upto_100"]["nbml"]
        rows = [{"chainage": 1.0, "date": "2026-01-01", "parameter": "twist", "value": nbml}]
        alerts = detect_alerts(rows, context={"speed_kmph": 80})
        self.assertEqual(len(alerts), 1)
        self.assertEqual(alerts[0]["severity"], "warning")
        self.assertEqual(alerts[0]["evaluation_status"], "evaluated")

    def test_evaluated_critical_becomes_a_confirmed_alert(self):
        uml = get_thresholds()["twist"]["verified_bands"]["upto_100"]["uml"]
        rows = [{"chainage": 1.0, "date": "2026-01-01", "parameter": "twist", "value": uml}]
        alerts = detect_alerts(rows, context={"speed_kmph": 80})
        self.assertEqual(len(alerts), 1)
        self.assertEqual(alerts[0]["severity"], "critical")

    def test_evaluated_normal_row_does_not_become_an_alert(self):
        nbml = get_thresholds()["twist"]["verified_bands"]["upto_100"]["nbml"]
        rows = [{"chainage": 1.0, "date": "2026-01-01", "parameter": "twist", "value": nbml - 1.0}]
        self.assertEqual(detect_alerts(rows, context={"speed_kmph": 80}), [])

    def test_context_required_row_does_not_become_a_confirmed_alert(self):
        rows = [{"chainage": 1.0, "date": "2026-01-01", "parameter": "gauge", "value": 4.0}]
        self.assertEqual(detect_alerts(rows, context={}), [])

    def test_not_evaluable_row_does_not_become_a_confirmed_alert(self):
        rows = [{"chainage": 1.0, "date": "2026-01-01", "parameter": "crossLevel", "value": 9.3}]
        self.assertEqual(detect_alerts(rows, context={}), [])

    def test_context_required_appears_in_unresolved_with_reason(self):
        rows = [{"chainage": 1.0, "date": "2026-01-01", "parameter": "gauge", "value": 4.0}]
        unresolved = detect_unresolved(rows, context={})
        self.assertEqual(len(unresolved), 1)
        rec = unresolved[0]
        self.assertEqual(rec["evaluation_status"], "context_required")
        self.assertIsNotNone(rec["reason"])
        self.assertIn("track_type", rec["missing_context"])
        self.assertEqual(rec["parameter"], "gauge")
        self.assertEqual(rec["chainage"], 1.0)
        self.assertEqual(rec["date"], "2026-01-01")
        self.assertEqual(rec["value"], 4.0)

    def test_not_evaluable_appears_in_unresolved_with_reason(self):
        rows = [{"chainage": 1.0, "date": "2026-01-01", "parameter": "crossLevel", "value": 9.3}]
        unresolved = detect_unresolved(rows, context={})
        self.assertEqual(len(unresolved), 1)
        rec = unresolved[0]
        self.assertEqual(rec["evaluation_status"], "not_evaluable")
        self.assertIsNotNone(rec["reason"])

    def test_evaluated_normal_row_absent_from_both_alerts_and_unresolved(self):
        nbml = get_thresholds()["twist"]["verified_bands"]["upto_100"]["nbml"]
        rows = [{"chainage": 1.0, "date": "2026-01-01", "parameter": "twist", "value": nbml - 1.0}]
        self.assertEqual(detect_alerts(rows, context={"speed_kmph": 80}), [])
        self.assertEqual(detect_unresolved(rows, context={"speed_kmph": 80}), [])

    def test_group_alerts_groups_same_chainage_and_date(self):
        uml = get_thresholds()["twist"]["verified_bands"]["upto_100"]["uml"]
        rows = [
            {"chainage": 1.0, "date": "2026-01-01", "parameter": "twist", "value": uml},
        ]
        alerts = detect_alerts(rows, context={"speed_kmph": 80})
        groups = group_alerts(alerts)
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]["severity"], "critical")
        self.assertEqual(groups[0]["alert_count"], 1)
        self.assertIn("twist", groups[0]["parameters"])


# ---------------------------------------------------------------------------
# 7. Trend analysis
# ---------------------------------------------------------------------------

class TrendAnalysisTests(unittest.TestCase):
    def test_trend_is_produced_with_expected_fields(self):
        rows = [
            {"chainage": 1.0, "date": "2026-01-01", "parameter": "twist", "value": 3.0},
            {"chainage": 1.0, "date": "2026-01-11", "parameter": "twist", "value": 4.0},
            {"chainage": 1.0, "date": "2026-01-21", "parameter": "twist", "value": 5.0},
        ]
        trends = analyze_trends(rows, context={"speed_kmph": 80})
        self.assertEqual(len(trends), 1)
        t = trends[0]
        for key in ("chainage", "parameter", "current_value", "moving_average",
                    "trend_direction", "degradation_rate_per_day",
                    "evaluation_status", "estimated_days_to_critical",
                    "predicted_critical_date"):
            self.assertIn(key, t)
        self.assertEqual(t["current_value"], 5.0)
        self.assertEqual(t["trend_direction"], "deteriorating")

    def test_valid_engineering_threshold_allows_time_to_critical(self):
        rows = [
            {"chainage": 1.0, "date": "2026-01-01", "parameter": "twist", "value": 3.0},
            {"chainage": 1.0, "date": "2026-01-11", "parameter": "twist", "value": 4.0},
            {"chainage": 1.0, "date": "2026-01-21", "parameter": "twist", "value": 5.0},
        ]
        trends = analyze_trends(rows, context={"speed_kmph": 80})
        t = trends[0]
        self.assertEqual(t["evaluation_status"], "evaluated")
        self.assertIsNotNone(t["estimated_days_to_critical"])
        self.assertIsNotNone(t["predicted_critical_date"])

    def test_no_valid_engineering_threshold_forces_null_prediction(self):
        # gauge has no verified table at all -> context_required, so no
        # time-to-critical must ever be fabricated even though the trend
        # itself is deteriorating.
        rows = [
            {"chainage": 1.0, "date": "2026-01-01", "parameter": "gauge", "value": 3.0},
            {"chainage": 1.0, "date": "2026-01-11", "parameter": "gauge", "value": 4.0},
            {"chainage": 1.0, "date": "2026-01-21", "parameter": "gauge", "value": 5.0},
        ]
        trends = analyze_trends(rows, context={})
        t = trends[0]
        self.assertEqual(t["evaluation_status"], "context_required")
        self.assertEqual(t["trend_direction"], "deteriorating")  # stats still computed
        self.assertIsNone(t["estimated_days_to_critical"])
        self.assertIsNone(t["predicted_critical_date"])

    def test_not_evaluable_parameter_forces_null_prediction(self):
        rows = [
            {"chainage": 1.0, "date": "2026-01-01", "parameter": "crossLevel", "value": 6.1},
            {"chainage": 1.0, "date": "2026-01-11", "parameter": "crossLevel", "value": 7.0},
            {"chainage": 1.0, "date": "2026-01-21", "parameter": "crossLevel", "value": 8.2},
        ]
        trends = analyze_trends(rows, context={})
        t = trends[0]
        self.assertEqual(t["evaluation_status"], "not_evaluable")
        self.assertIsNone(t["estimated_days_to_critical"])
        self.assertIsNone(t["predicted_critical_date"])


# ---------------------------------------------------------------------------
# 8. Anomaly detection
# ---------------------------------------------------------------------------

class AnomalyDetectionTests(unittest.TestCase):
    """detect_anomalies() computes a plain z-score per parameter group
    (sample standard deviation, ddof=1) and flags |z| >= z_limit (default
    3.0). No Isolation Forest or any other model is used in the current
    implementation -- confirmed by reading anomaly_detection.py directly.
    The dataset below is fully deterministic (20 identical values + one
    outlier); the expected z-score is hand-computed:

        mean = (20*10 + 13) / 21 = 10.142857...
        sum_sq_dev = 20*(10-mean)**2 + (13-mean)**2 = 8.5714...
        sample_var (n-1=20) = 8.5714.../20 = 0.42857...
        sd = sqrt(0.42857...) = 0.65465...
        z(13) = (13 - mean) / sd = 4.364  (matches anomaly_detection.py's
                                            own round(z, 3))
    """

    def test_deterministic_outlier_is_flagged_with_expected_fields(self):
        rows = [{"chainage": 5.0, "date": _iso(i), "parameter": "gauge", "value": 10.0}
                for i in range(20)]
        rows.append({"chainage": 5.0, "date": _iso(20), "parameter": "gauge", "value": 13.0})

        out = detect_anomalies(rows)
        self.assertEqual(len(out), 1)
        rec = out[0]
        self.assertEqual(rec["parameter"], "gauge")
        self.assertEqual(rec["value"], 13.0)
        self.assertAlmostEqual(rec["z_score"], 4.364, places=3)
        self.assertEqual(rec["anomaly_type"], "statistical_outlier")
        self.assertEqual(rec["source"], "statistical anomaly detection")

    def test_uniform_values_produce_no_anomalies(self):
        # sd == 0 -> the group is skipped entirely (see `if sd==0: continue`).
        rows = [{"chainage": 1.0, "date": _iso(i), "parameter": "twist", "value": 4.0}
                for i in range(5)]
        self.assertEqual(detect_anomalies(rows), [])

    def test_mild_variation_below_z_limit_is_not_flagged(self):
        # Values close together should not cross the default z_limit=3.0.
        rows = [{"chainage": 1.0, "date": _iso(i), "parameter": "twist", "value": v}
                for i, v in enumerate([4.0, 4.1, 3.9, 4.05, 3.95])]
        self.assertEqual(detect_anomalies(rows), [])


# ---------------------------------------------------------------------------
# 9. evaluate.py
# ---------------------------------------------------------------------------

class EvaluateTests(unittest.TestCase):
    def test_no_labels_reports_ground_truth_unavailable_without_inventing_metrics(self):
        alerts = [{"chainage": 1.0, "date": "2026-01-01", "parameter": "twist"}]
        result = evaluate_alerts(alerts)
        self.assertEqual(result["status"], "ground_truth_unavailable")
        self.assertNotIn("precision", result)
        self.assertNotIn("recall", result)

    def test_no_labels_even_with_empty_alerts(self):
        result = evaluate_alerts([])
        self.assertEqual(result["status"], "ground_truth_unavailable")

    def test_labels_supplied_computes_actual_precision_recall(self):
        # Hand-computed: pred={(1.0,twist)(matches), (2.0,gauge)(false
        # positive)}; truth={(1.0,twist)(matches), (3.0,railWear)(missed)}
        # tp=1, fp=1, fn=1 -> precision=0.5, recall=0.5
        alerts = [
            {"chainage": 1.0, "date": "2026-01-01", "parameter": "twist"},
            {"chainage": 2.0, "date": "2026-01-01", "parameter": "gauge"},
        ]
        labels = [
            {"chainage": 1.0, "date": "2026-01-01", "parameter": "twist"},
            {"chainage": 3.0, "date": "2026-01-01", "parameter": "railWear"},
        ]
        result = evaluate_alerts(alerts, labels=labels)
        self.assertEqual(result["status"], "evaluated")
        self.assertEqual(result["true_alerts"], 1)
        self.assertEqual(result["false_alerts"], 1)
        self.assertEqual(result["missed_alerts"], 1)
        self.assertAlmostEqual(result["precision"], 0.5)
        self.assertAlmostEqual(result["recall"], 0.5)

    def test_perfect_match_gives_precision_and_recall_of_one(self):
        alerts = [{"chainage": 1.0, "date": "2026-01-01", "parameter": "twist"}]
        labels = [{"chainage": 1.0, "date": "2026-01-01", "parameter": "twist"}]
        result = evaluate_alerts(alerts, labels=labels)
        self.assertEqual(result["precision"], 1.0)
        self.assertEqual(result["recall"], 1.0)


# ---------------------------------------------------------------------------
# Priority ranking (build_priority, part of run_analytics.py)
# ---------------------------------------------------------------------------

class PriorityRankingTests(unittest.TestCase):
    """build_priority() takes analyze_trends() output. Only
    evaluation_status == "evaluated" trends may enter the ranked list;
    context_required/not_evaluable trends are excluded entirely."""

    def _trend(self, **overrides):
        base = {
            "chainage": 1.0, "parameter": "twist", "current_value": 5.0,
            "moving_average": 5.0, "trend_direction": "deteriorating",
            "degradation_rate_per_day": 0.1, "critical_threshold": 7.0,
            "current_severity": None, "evaluation_status": "evaluated",
            "evaluation_reason": None, "already_at_or_beyond_critical": False,
            "estimated_days_to_critical": None, "predicted_critical_date": None,
            "observations": 3, "insufficient_data": False,
        }
        base.update(overrides)
        return base

    def test_evaluated_critical_enters_priority(self):
        trends = [self._trend(current_severity="critical", already_at_or_beyond_critical=True)]
        priority = build_priority(trends)
        self.assertEqual(len(priority), 1)
        self.assertEqual(priority[0]["priority_rank"], 1)

    def test_evaluated_warning_enters_priority(self):
        trends = [self._trend(current_severity="warning")]
        priority = build_priority(trends)
        self.assertEqual(len(priority), 1)

    def test_context_required_excluded_from_priority(self):
        trends = [self._trend(evaluation_status="context_required", current_severity=None)]
        self.assertEqual(build_priority(trends), [])

    def test_not_evaluable_excluded_from_priority(self):
        trends = [self._trend(evaluation_status="not_evaluable", current_severity=None)]
        self.assertEqual(build_priority(trends), [])


# ---------------------------------------------------------------------------
# 10. Integration test
# ---------------------------------------------------------------------------

class IntegrationTests(unittest.TestCase):
    """A small synthetic dataset in the locked format (chainage, date,
    parameter, value) run through the full Person 4 chain:
    rows -> detect_alerts -> detect_unresolved -> analyze_trends
          -> detect_anomalies -> build_priority
    without crashing, and respecting the conservative default (no context
    supplied -> nothing outside the verified twist band gets evaluated).
    """

    def setUp(self):
        self.rows = [
            # twist: deteriorating series, evaluable once speed context is given
            {"chainage": 10.0, "date": "2026-01-01", "parameter": "twist", "value": 4.0},
            {"chainage": 10.0, "date": "2026-01-10", "parameter": "twist", "value": 5.5},
            {"chainage": 10.0, "date": "2026-01-20", "parameter": "twist", "value": 6.5},
            {"chainage": 10.0, "date": "2026-01-30", "parameter": "twist", "value": 8.0},
            # gauge: no verified table exists regardless of context
            {"chainage": 12.4, "date": "2026-01-01", "parameter": "gauge", "value": 3.0},
            {"chainage": 12.4, "date": "2026-01-30", "parameter": "gauge", "value": 5.6},
            # crossLevel: not_evaluable regardless of context
            {"chainage": 41.2, "date": "2026-01-01", "parameter": "crossLevel", "value": 6.1},
            {"chainage": 41.2, "date": "2026-01-30", "parameter": "crossLevel", "value": 9.3},
        ]

    def test_pipeline_runs_without_crashing_and_respects_conservative_default(self):
        alerts = detect_alerts(self.rows)              # no context supplied
        unresolved = detect_unresolved(self.rows)       # no context supplied
        trends = analyze_trends(self.rows)               # no context supplied
        anomalies = detect_anomalies(self.rows)
        priority = build_priority(trends)

        # Conservative default: with no context at all, twist can't reach
        # its verified <=100 kmph band either (speed_band/speed_kmph is
        # missing), so nothing in this dataset should be a confirmed
        # alert or a priority record.
        self.assertEqual(alerts, [])
        self.assertEqual(priority, [])

        # All 8 rows should be unresolved (none of the three parameters
        # used here can be evaluated without context).
        self.assertEqual(len(unresolved), 8)
        self.assertTrue(all(u["evaluation_status"] in ("context_required", "not_evaluable")
                             for u in unresolved))

        # Trends should still be produced (3 chainage/parameter series),
        # purely as descriptive statistics.
        self.assertEqual(len(trends), 3)
        for t in trends:
            if t["evaluation_status"] != "evaluated":
                self.assertIsNone(t["estimated_days_to_critical"])
                self.assertIsNone(t["predicted_critical_date"])

        # detect_anomalies should not raise; result type is a list.
        self.assertIsInstance(anomalies, list)

    def test_pipeline_with_context_produces_confirmed_twist_results(self):
        context = {"speed_kmph": 80}
        alerts = detect_alerts(self.rows, context=context)
        unresolved = detect_unresolved(self.rows, context=context)
        trends = analyze_trends(self.rows, context=context)
        priority = build_priority(trends)

        # Twist crosses NBML (5.5, 6.5) and UML (8.0) at this verified
        # speed band -- confirmed alerts should appear.
        self.assertGreater(len(alerts), 0)
        self.assertTrue(all(a["parameter"] == "twist" for a in alerts))

        # gauge/crossLevel remain unresolved even with this context, since
        # it doesn't supply what they need (track_type / nothing at all,
        # respectively).
        unresolved_params = {u["parameter"] for u in unresolved}
        self.assertIn("gauge", unresolved_params)
        self.assertIn("crossLevel", unresolved_params)

        # The twist trend should now be evaluated and able to enter
        # priority.
        twist_trend = next(t for t in trends if t["parameter"] == "twist")
        self.assertEqual(twist_trend["evaluation_status"], "evaluated")
        priority_params = {p["parameter"] for p in priority}
        self.assertIn("twist", priority_params)


if __name__ == "__main__":
    unittest.main()
