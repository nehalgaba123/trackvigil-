
"""Person 4 -- Analytics, Threshold Validation & Prediction.

Tests the context-aware threshold engine (thresholds.py), alert/unresolved
detection (alert_engine.py), trend prediction (trend_analysis.py), and the
priority-ranking integration (run_analytics.build_priority).

These tests exercise the EXISTING architecture as-is. They do not invent
any numeric railway threshold: every assertion about a numeric NBML/UML/
renewal value below (twist 5/7 mm/m, railWear 13mm@60kg / 8mm@50kg) is
copied from the values already verified and encoded in thresholds.py, not
introduced here.

Run with:  python3 -m unittest analytics.tests.test_person4 -v
"""
import unittest

from ..thresholds import evaluate_parameter
from ..alert_engine import detect_alerts, detect_unresolved
from ..trend_analysis import analyze_trends
from ..run_analytics import build_priority


class GaugeTests(unittest.TestCase):
    def test_missing_context_is_context_required(self):
        r = evaluate_parameter("gauge", 4.0, context={})
        self.assertEqual(r["evaluation_status"], "context_required")
        self.assertIsNone(r["severity"])

    def test_full_structural_context_still_context_required(self):
        """Documents actual current behavior, not the aspirational
        'valid context -> evaluated' case: thresholds.py has NO verified
        numeric NBML/UML table for gauge at all (see _resolve_gauge --
        'verified_nbml_uml_table' is unconditionally appended to missing).
        So even fully-specified structural context (track_type,
        curve_radius_m) cannot reach evaluation_status == 'evaluated' for
        gauge today. Asserting the honest current behavior here rather
        than fabricating a threshold to force an 'evaluated' result --
        that would violate the 'do not invent thresholds' rule.
        """
        r = evaluate_parameter(
            "gauge", 4.0,
            context={"track_type": "curve", "curve_radius_m": 500},
        )
        self.assertEqual(r["evaluation_status"], "context_required")
        self.assertIsNone(r["severity"])
        self.assertIn("verified_nbml_uml_table", r["missing_context"])


class TwistTests(unittest.TestCase):
    def test_verified_band_normal(self):
        r = evaluate_parameter("twist", 3.0, context={"speed_kmph": 80})
        self.assertEqual(r["evaluation_status"], "evaluated")
        self.assertEqual(r["severity"], "normal")
        self.assertEqual(r["nbml"]["value"], 5.0)
        self.assertEqual(r["uml"]["value"], 7.0)

    def test_verified_band_warning_at_nbml(self):
        r = evaluate_parameter("twist", 5.0, context={"speed_kmph": 80})
        self.assertEqual(r["evaluation_status"], "evaluated")
        self.assertEqual(r["severity"], "warning")

    def test_verified_band_critical_at_uml(self):
        r = evaluate_parameter("twist", 7.0, context={"speed_kmph": 80})
        self.assertEqual(r["evaluation_status"], "evaluated")
        self.assertEqual(r["severity"], "critical")

    def test_unverified_speed_band_is_context_required(self):
        # >100 kmph has no verified band table -- must not be evaluated.
        r = evaluate_parameter("twist", 6.0, context={"speed_kmph": 160})
        self.assertEqual(r["evaluation_status"], "context_required")
        self.assertIsNone(r["severity"])

    def test_no_speed_context_is_context_required(self):
        r = evaluate_parameter("twist", 6.0, context={})
        self.assertEqual(r["evaluation_status"], "context_required")


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
        # Nested uml.evaluation_status label is now consistent with
        # alignment's: both use "UML_requires_acceleration" (previously
        # alignment used "not_evaluable" here instead).
        self.assertEqual(r["uml"]["evaluation_status"], "UML_requires_acceleration")


class CrossLevelTests(unittest.TestCase):
    def test_no_standalone_threshold(self):
        r = evaluate_parameter("crossLevel", 9.3, context={})
        self.assertEqual(r["evaluation_status"], "not_evaluable")
        self.assertIsNone(r["severity"])

    def test_never_classified_critical_regardless_of_magnitude(self):
        for v in (0.0, 5.0, 50.0, 500.0):
            r = evaluate_parameter("crossLevel", v, context={})
            self.assertNotEqual(r["severity"], "critical")
            self.assertIsNone(r["severity"])
            self.assertEqual(r["evaluation_status"], "not_evaluable")


class RailWearTests(unittest.TestCase):
    def test_supported_section_60kg_asset_renewal(self):
        r = evaluate_parameter("railWear", 10.0, context={"rail_section": "60kg"})
        self.assertEqual(r["evaluation_status"], "evaluated")
        self.assertIsNone(r["severity"])  # renewal criterion, not a severity
        self.assertEqual(r["asset_renewal"]["renewal_threshold"]["value"], 13.0)
        self.assertFalse(r["asset_renewal"]["at_or_beyond_renewal"])

    def test_supported_section_50kg_at_renewal(self):
        r = evaluate_parameter("railWear", 8.0, context={"rail_section": "50kg"})
        self.assertEqual(r["evaluation_status"], "evaluated")
        self.assertEqual(r["asset_renewal"]["renewal_threshold"]["value"], 8.0)
        self.assertTrue(r["asset_renewal"]["at_or_beyond_renewal"])

    def test_unsupported_section_is_context_required(self):
        r = evaluate_parameter("railWear", 10.0, context={"rail_section": "52kg"})
        self.assertEqual(r["evaluation_status"], "context_required")

    def test_missing_rail_section_is_context_required(self):
        r = evaluate_parameter("railWear", 10.0, context={})
        self.assertEqual(r["evaluation_status"], "context_required")

    def test_renewal_criterion_not_represented_as_uml(self):
        r = evaluate_parameter("railWear", 14.0, context={"rail_section": "60kg"})
        # Must never leak into uml/severity -- renewal != UML (see module
        # docstring / _resolve_railWear).
        self.assertIsNone(r["uml"])
        self.assertIsNone(r["severity"])
        self.assertIn("asset_renewal", r)
        self.assertEqual(r["asset_renewal"]["threshold_type"], "asset_renewal")


class AlertAndUnresolvedTests(unittest.TestCase):
    def test_confirmed_alert_for_evaluated_warning_critical_only(self):
        rows = [
            {"chainage": 1.0, "date": "2026-01-01", "parameter": "twist", "value": 8.0},
        ]
        alerts = detect_alerts(rows, context={"speed_kmph": 80})
        self.assertEqual(len(alerts), 1)
        self.assertEqual(alerts[0]["severity"], "critical")
        self.assertEqual(alerts[0]["evaluation_status"], "evaluated")

    def test_context_required_never_becomes_an_alert(self):
        rows = [
            {"chainage": 1.0, "date": "2026-01-01", "parameter": "gauge", "value": 4.0},
        ]
        alerts = detect_alerts(rows, context={})
        self.assertEqual(alerts, [])

    def test_context_required_appears_in_unresolved(self):
        rows = [
            {"chainage": 1.0, "date": "2026-01-01", "parameter": "gauge", "value": 4.0},
        ]
        unresolved = detect_unresolved(rows, context={})
        self.assertEqual(len(unresolved), 1)
        self.assertEqual(unresolved[0]["evaluation_status"], "context_required")

    def test_not_evaluable_appears_in_unresolved_not_alerts(self):
        rows = [
            {"chainage": 1.0, "date": "2026-01-01", "parameter": "crossLevel", "value": 9.3},
        ]
        self.assertEqual(detect_alerts(rows, context={}), [])
        unresolved = detect_unresolved(rows, context={})
        self.assertEqual(len(unresolved), 1)
        self.assertEqual(unresolved[0]["evaluation_status"], "not_evaluable")

    def test_normal_evaluated_row_is_neither_alert_nor_unresolved(self):
        rows = [
            {"chainage": 1.0, "date": "2026-01-01", "parameter": "twist", "value": 2.0},
        ]
        self.assertEqual(detect_alerts(rows, context={"speed_kmph": 80}), [])
        self.assertEqual(detect_unresolved(rows, context={"speed_kmph": 80}), [])


class TrendPredictionTests(unittest.TestCase):
    def test_valid_threshold_allows_time_to_critical(self):
        rows = [
            {"chainage": 1.0, "date": "2026-01-01", "parameter": "twist", "value": 3.0},
            {"chainage": 1.0, "date": "2026-01-11", "parameter": "twist", "value": 4.0},
            {"chainage": 1.0, "date": "2026-01-21", "parameter": "twist", "value": 5.0},
        ]
        trends = analyze_trends(rows, context={"speed_kmph": 80})
        t = trends[0]
        self.assertEqual(t["evaluation_status"], "evaluated")
        self.assertEqual(t["trend_direction"], "deteriorating")
        self.assertIsNotNone(t["estimated_days_to_critical"])
        self.assertIsNotNone(t["predicted_critical_date"])

    def test_no_valid_threshold_forces_null_prediction(self):
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

    def test_not_evaluable_forces_null_prediction(self):
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


class PriorityRankingTests(unittest.TestCase):
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

    def test_evaluated_critical_is_included_as_tier_1(self):
        trends = [self._trend(current_severity="critical", already_at_or_beyond_critical=True)]
        priority = build_priority(trends)
        self.assertEqual(len(priority), 1)
        self.assertEqual(priority[0]["priority_reason"], "currently_critical")
        self.assertEqual(priority[0]["priority_rank"], 1)

    def test_evaluated_warning_is_included_as_tier_2(self):
        trends = [self._trend(current_severity="warning")]
        priority = build_priority(trends)
        self.assertEqual(len(priority), 1)
        self.assertEqual(priority[0]["priority_reason"], "warning_condition")

    def test_evaluated_with_projection_is_tier_3(self):
        trends = [self._trend(current_severity="normal", estimated_days_to_critical=12.0)]
        priority = build_priority(trends)
        self.assertEqual(len(priority), 1)
        self.assertEqual(priority[0]["priority_reason"], "predicted_critical")

    def test_context_required_excluded_from_priority(self):
        trends = [self._trend(evaluation_status="context_required", current_severity=None)]
        priority = build_priority(trends)
        self.assertEqual(priority, [])

    def test_not_evaluable_excluded_from_priority(self):
        trends = [self._trend(evaluation_status="not_evaluable", current_severity=None)]
        priority = build_priority(trends)
        self.assertEqual(priority, [])

    def test_critical_ranks_above_warning_ranks_above_predicted(self):
        trends = [
            self._trend(parameter="a", current_severity="warning"),
            self._trend(parameter="b", current_severity="critical", already_at_or_beyond_critical=True),
            self._trend(parameter="c", current_severity="normal", estimated_days_to_critical=5.0),
        ]
        priority = build_priority(trends)
        self.assertEqual([p["parameter"] for p in priority], ["b", "a", "c"])
        self.assertEqual([p["priority_rank"] for p in priority], [1, 2, 3])


if __name__ == "__main__":
    unittest.main()
