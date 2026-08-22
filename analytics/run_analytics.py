import csv, json, sys
from pathlib import Path
from .alert_engine import detect_alerts, detect_unresolved, group_alerts
from .anomaly_detection import detect_anomalies
from .trend_analysis import analyze_trends
from .evaluate import evaluate_alerts


def load(path):
    with open(path, newline='') as f:
        return list(csv.DictReader(f))


def build_priority(trends):
    """Rank trend observations by urgency -- ENGINEERING-EVALUABLE CASES ONLY.

    Integration fix: trend_analysis.analyze_trends() (unchanged) computes a
    statistical trend_direction/degradation_rate for every row regardless of
    evaluation_status, because that's descriptive statistics and doesn't
    need a verified engineering threshold. But the *priority list* is a
    maintenance-action ranking, and a row whose evaluation_status is
    "context_required" or "not_evaluable" has no confirmed engineering
    severity to act on -- ranking it here would misrepresent a statistical
    observation as a confirmed maintenance priority. So this function now
    first filters to evaluation_status == "evaluated" trends, then applies
    the existing urgency ordering to that subset only:

      Tier 1: already_at_or_beyond_critical (active confirmed breach).
      Tier 2: current_severity == "warning".
      Tier 3: has a valid, non-None estimated_days_to_critical (a genuine
              engineering projection target existed -- see trend_analysis.py
              / thresholds.py for when that's populated).
      Tier 4: evaluated but none of the above (e.g. normal and stable/
              improving/no projection) -- still evaluated, just not urgent.

    Within Tier 3, smallest (soonest) estimated_days_to_critical first.

    context_required / not_evaluable trends are excluded from this list
    entirely -- they remain visible in trends.json (full, unfiltered) for
    statistical/monitoring purposes, and the corresponding raw measurements
    are captured with their reason in unresolved.json (see run()).

    Each item keeps all of its original trend fields plus priority_rank.
    """
    evaluated = [t for t in trends if t.get('evaluation_status') == 'evaluated']

    def tier(t):
        if t.get('already_at_or_beyond_critical'):
            return 1
        if t.get('current_severity') == 'warning':
            return 2
        if t.get('estimated_days_to_critical') is not None:
            return 3
        return 4

    # Stable string label per tier, for callers that want a human-readable
    # reason without re-deriving it from the other fields. "not_urgent" is
    # used for Tier 4 (evaluated but no active/predicted concern) rather
    # than leaving it null, since a reason *is* meaningfully available --
    # only context_required/not_evaluable rows (excluded above) lack one.
    _REASON_BY_TIER = {
        1: 'currently_critical',
        2: 'warning_condition',
        3: 'predicted_critical',
        4: 'not_urgent',
    }

    ranked = sorted(
        evaluated,
        key=lambda t: (
            tier(t),
            t['estimated_days_to_critical'] if t.get('estimated_days_to_critical') is not None else float('inf'),
        ),
    )
    return [
        dict(t, priority_rank=i + 1, priority_reason=_REASON_BY_TIER[tier(t)])
        for i, t in enumerate(ranked)
    ]


def run(path, outdir, context=None, track_class="standard", overrides=None):
    """Run the full pipeline.

    `context`, `track_class`, and `overrides` are optional and default to
    the same conservative behavior as before this change (context=None ->
    every row that needs context to evaluate stays context_required /
    not_evaluable, exactly as it did previously). Passing a real context
    dict lets confirmed alerts/priority entries be produced for parameters
    where a verified threshold + supplied context make that possible (e.g.
    twist at a verified speed band) -- nothing about the conservative
    default behavior changes when context is omitted.
    """
    rows = load(path)
    alerts = detect_alerts(rows, track_class=track_class, overrides=overrides, context=context)
    unresolved = detect_unresolved(rows, track_class=track_class, overrides=overrides, context=context)
    trends = analyze_trends(rows, track_class=track_class, overrides=overrides, context=context)
    anomalies = detect_anomalies(rows)
    priority = build_priority(trends)

    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    for name, obj in [
        ('alerts.json', {'alerts': alerts, 'groups': group_alerts(alerts)}),
        ('unresolved.json', {'unresolved': unresolved}),
        ('trends.json', {'trends': trends}),
        ('priority.json', {'priority': priority}),
        ('anomalies.json', {'anomalies': anomalies}),
        ('evaluation_results.json', evaluate_alerts(alerts)),
    ]:
        (out / name).write_text(json.dumps(obj, indent=2))

    return {
        'rows': len(rows),
        'alerts': len(alerts),
        'unresolved': len(unresolved),
        'anomalies': len(anomalies),
        'trends': len(trends),
        'priority_records': len(priority),
    }


if __name__ == '__main__':
    print(json.dumps(run(sys.argv[1], sys.argv[2]), indent=2))
