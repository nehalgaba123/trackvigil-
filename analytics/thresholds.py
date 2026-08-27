"""
thresholds.py
Person 4 — Analytics, Threshold Validation & Prediction

Defines warning/critical thresholds for the six LOCKED parameters:
    gauge, alignment, twist, unevenness, crossLevel, railWear

*** IMPORTANT — ACTION REQUIRED BEFORE FINAL SUBMISSION ***
The numeric values below are engineering-plausible PLACEHOLDERS based on
general broad-gauge track-geometry tolerance orders of magnitude. They are
NOT copied verbatim from a verified IRPWM (Indian Railway Permanent Way
Manual) table or other cited standard. Before presenting to judges:
  1. Look up the actual permissible-variation tables for the relevant
     track/speed class in IRPWM (or another official/cited source).
  2. Replace SOURCE and the warning/critical numbers below.
  3. Keep the structure (dict keyed by parameter -> speed class) so the
     frontend doesn't need to change.

Do not present these placeholder numbers as officially validated.
"""

# Speed classes are illustrative groupings (e.g. Group A/B/C per IRPWM-style
# classification). Replace with the actual classes you decide to support.
SPEED_CLASSES = ["A", "B", "C"]  # A = highest speed / tightest tolerance

# unit: mm for all parameters
THRESHOLDS = {
    "gauge": {
        "unit": "mm",
        "source": "PLACEHOLDER — verify against IRPWM gauge tolerance table",
        "by_speed_class": {
            "A": {"warning": 6.0,  "critical": 10.0},
            "B": {"warning": 8.0,  "critical": 12.0},
            "C": {"warning": 10.0, "critical": 15.0},
        },
    },
    "alignment": {
        "unit": "mm",
        "source": "PLACEHOLDER — verify against IRPWM alignment tolerance table",
        "by_speed_class": {
            "A": {"warning": 4.0, "critical": 8.0},
            "B": {"warning": 6.0, "critical": 10.0},
            "C": {"warning": 8.0, "critical": 12.0},
        },
    },
    "twist": {
        "unit": "mm",
        "source": "PLACEHOLDER — verify against IRPWM twist tolerance table",
        "by_speed_class": {
            "A": {"warning": 3.5, "critical": 7.0},
            "B": {"warning": 5.0, "critical": 9.0},
            "C": {"warning": 6.5, "critical": 11.0},
        },
    },
    "unevenness": {
        "unit": "mm",
        "source": "PLACEHOLDER — verify against IRPWM unevenness (top) tolerance table",
        "by_speed_class": {
            "A": {"warning": 6.0, "critical": 10.0},
            "B": {"warning": 8.0, "critical": 12.0},
            "C": {"warning": 10.0, "critical": 14.0},
        },
    },
    "crossLevel": {
        "unit": "mm",
        "source": "PLACEHOLDER — verify against IRPWM cross-level tolerance table",
        "by_speed_class": {
            "A": {"warning": 4.0, "critical": 8.0},
            "B": {"warning": 6.0, "critical": 10.0},
            "C": {"warning": 8.0, "critical": 12.0},
        },
    },
    "railWear": {
        "unit": "mm",
        "source": "PLACEHOLDER — verify against IRPWM rail wear condemning limit table",
        "by_speed_class": {
            "A": {"warning": 6.0, "critical": 10.0},
            "B": {"warning": 8.0, "critical": 12.0},
            "C": {"warning": 10.0, "critical": 14.0},
        },
    },
}


def get_threshold(parameter, speed_class="B"):
    """Return {'warning': x, 'critical': y, 'unit': z} for a parameter/speed class.

    Raises KeyError for unknown parameter or speed class — keep it loud so
    frontend/backend mismatches are caught early instead of silently
    defaulting.
    """
    if parameter not in THRESHOLDS:
        raise KeyError(f"Unknown parameter '{parameter}'. Must be one of {list(THRESHOLDS.keys())}")
    if speed_class not in SPEED_CLASSES:
        raise KeyError(f"Unknown speed class '{speed_class}'. Must be one of {SPEED_CLASSES}")

    band = THRESHOLDS[parameter]["by_speed_class"][speed_class]
    return {
        "warning": band["warning"],
        "critical": band["critical"],
        "unit": THRESHOLDS[parameter]["unit"],
    }


# Nominal broad-gauge track width in mm — kept for reference / for anyone
# sourcing a real IRPWM gauge table later. NOT currently subtracted in
# deviation() below, because the locked dataset (see data_format.md) already
# stores `gauge` as a deviation-from-nominal value like the other five
# parameters (sample rows are ~2-3mm, not ~1676mm), matching how
# classify_severity() already treats every parameter uniformly.
NOMINAL_GAUGE_MM = 1676.0


def deviation(parameter, value):
    """Normalize a raw CSV value into the same 'deviation magnitude' space
    that classify_severity() already uses for alerting, so trend regression
    (trend_analysis.py) and threshold alerting (alert_engine.py) agree on
    what 'deviation' means for a given parameter.

    railWear is a genuine absolute measurement (wear amount), so it's kept
    signed/as-is. Every other locked parameter is already stored centered
    at 0 in the current dataset, so only its magnitude matters here —
    mirrors classify_severity()'s abs_value logic exactly.
    """
    return value if parameter == "railWear" else abs(value)


def classify_severity(parameter, value, speed_class="B"):
    """Shared severity logic — Person 1 (frontend severity.js) must mirror this.

    Returns one of: 'normal', 'warning', 'critical'
    """
    band = get_threshold(parameter, speed_class)
    abs_value = abs(value) if parameter != "railWear" else value
    if abs_value >= band["critical"]:
        return "critical"
    if abs_value >= band["warning"]:
        return "warning"
    return "normal"


if __name__ == "__main__":
    # quick sanity check
    for p in THRESHOLDS:
        print(p, get_threshold(p, "B"))
