# Data Format Contract — TrackVigil (SIH 2026)

This is the **single source of truth** for field names, formats, and thresholds
across the pipeline. If your module doesn't match this doc, it's wrong — fix
your module, don't fix the doc without telling the team.

Status as of Aug 22: repo (`trackvigil--main`) currently contains **only the
Person 1 frontend prototype**, running entirely on in-browser mock data
(`generateDataset()` in `RailTrackDashboard.jsx`). `backend/`, `data/`,
`analytics/`, `tests/`, `docs/` do not exist yet at repo root.

---

## 1. Locked CSV schema (Person 3 → Person 2)

```
chainage,date,parameter,value
```

| Field       | Type          | Notes                                      |
|-------------|---------------|---------------------------------------------|
| `chainage`  | float (km)    | e.g. `41.2`                                 |
| `date`      | ISO 8601 date | `YYYY-MM-DD`                                |
| `parameter` | string        | one of the 6 locked parameter names below   |
| `value`     | float (mm)    | deviation/measurement, unit = mm            |

Core schema is these 4 fields. No wide format. Long format only.

**Amendment (as of latest sync):** an optional 5th column, `alert`, has
started appearing in `cleaned_data.csv` — values `ok` / `warning` /
`critical`, a per-row ground-truth severity label generated alongside the
data. **This is a real contract change and needs full team sign-off** —
flagging it here now since it was added without being documented first
(see §11, "any intentional contract change must be documented and
communicated before dependent code is changed").

This column is currently being used as a **temporary stand-in** for real
alert generation: `backend/scripts/build-analytics-output.js` reads this
label directly and writes `analytics/output/alerts.json` from it, rather
than computing severity from thresholds. **This means alerts currently
shown on the dashboard reflect this pre-existing label, not live output
from `analytics/alert_engine.py`** (which cannot run yet — see §12).
Useful side benefit: this gives `evaluate.py` real ground truth to
validate against, if this label is trustworthy — but the team needs to
explicitly decide: (a) is `alert` a permanent 5th schema field or a
temporary generation artifact, (b) is it meant as ground truth for
`evaluate.py`, or as production alerting, or both, and (c) should
Person 4's `alert_engine.py` eventually replace this stand-in entirely
once its import bugs are fixed.

## 2. Locked parameter names

Do not rename, alias, or re-case these — anywhere, in any file:

```
gauge
alignment
twist
unevenness
crossLevel
railWear
```

Do not introduce alternatives such as `cross_level`, `rail_wear`,
`crosslevel`. If an external dataset uses different names, handle the
mapping in the appropriate API/data-ingestion layer only.

## 3. Gauge — special case

`gauge` is **deviation from the 1676mm nominal broad-gauge value**, not an
absolute measurement. A value of `3.2` means 3.2mm deviation, not a gauge
width of 3.2mm. If any raw/external data source gives absolute gauge
measurements, that conversion to deviation must happen in the
ingestion/API layer — never left for the frontend or analytics to assume.
This interpretation is locked; changing it requires team approval.

## 4. Thresholds — LOCKED default values (team-agreed, not a placeholder)

These are the official default thresholds, confirmed by the team rules
(matches what was already in the frontend prototype):

| Parameter    | Warning | Critical |
|--------------|---------|----------|
| gauge        | 5       | 9        |
| alignment    | 5       | 10       |
| twist        | 4       | 7        |
| unevenness   | 8       | 13       |
| crossLevel   | 6       | 10       |
| railWear     | 8       | 12       |

These are locked as the working defaults for backend/analytics/tests. A
**separate task still remains**: `docs/threshold_validation.md` needs to
document the IRPWM (or other official) source backing each number, and
note whether track/speed class changes any of them. That's about sourcing
justification, not about changing these numbers without team sign-off.

## 5. Severity logic — LOCKED

```
value >= critical → "critical"
value >= warning  → "warning"
otherwise         → "ok"
```

**Both boundaries are inclusive (`>=`)** — a value exactly equal to the
critical threshold counts as critical, not warning. Backend, analytics,
and tests must all implement this exact boundary logic — no separate
severity rules in different files.

## 6. Chainage — LOCKED

- Prototype range: **0–60 km**
- Prototype resolution: **100m (0.1 km) steps**
- No silent resampling, interpolation, rounding, or modification of
  chainage values anywhere in the pipeline. If real data has irregular
  spacing, that's a data-processing contract decision for the team, not
  something any one module decides on its own.

## 7. Dates & trends — LOCKED

- `date` is part of the schema and is required on every row.
- The main dashboard shows a **single current snapshot** — not a
  time series view.
- Trend/history views use an agreed aggregation format (still needs to be
  finalized — flag to the team if unclear, don't guess).
- Do not implement separate/independent date-aggregation logic in more
  than one file — one shared implementation only.

**Known blocker:** `cleaned_data.csv` (shared by Person 3) currently has
only **one date** for all rows. Trend/rate-of-degradation calculations
need multiple dates per chainage to compute a slope — this can't work off
a single snapshot. Needs resolution with Person 3/4.

## 8. Server-side alert object structure — LOCKED

```js
{
  param: "gauge",   // one of the 6 locked parameter names
  start: 12.1,      // chainage (km) where the breached run starts
  end: 12.7,        // chainage (km) where the breached run ends
  peak: 9.4,        // worst value within the breached run
  sev: "critical"   // "warning" or "critical"
}
```

Alerts represent **contiguous runs** of breached readings for the same
parameter — not one alert per individual reading.

## 9. API contract (must match between Person 1 and Person 2)

Locked routes (Person 2 owns implementation, Person 1 consumes):

```
GET /tracks
GET /alerts
GET /analytics
GET /priority
```

**Not yet defined:** exact JSON response shape for each route. This needs
to be written down the moment Person 2 has a working stub — even with fake
data — so Person 1 isn't reverse-engineering it from network tab.
*(Placeholder — fill in once Person 2 shares response shapes.)*

## 10. Pipeline

```
Person 3: railway_data.csv (raw)
        ↓ clean_data.py
Person 3: cleaned_data.csv  →  chainage,date,parameter,value
        ↓
Person 4: thresholds.py + alert_engine.py + trend_analysis.py + anomaly_detection.py
        ↓ (alerts.json, trends.json, priority.json)
Person 2: dataService.js + analyticsService.js
        ↓ transform long-format → frontend-compatible shape
Person 2: GET /tracks, /alerts, /analytics, /priority
        ↓
Person 1: services/api.js → components/pages
        ↓
React Dashboard (judge-facing)
```

Backend's internal transform:

```
Long-format analytics output (Person 4)
        ↓
Backend-shaped JSON (Person 2)
        ↓
Frontend-compatible format (matches what Person 1's components expect)
```

## 11. General integration rules (apply to all backend/analytics/test code)

- Never silently change the data contract or API response structure.
- Never rename fields just to make your own code easier to write.
- Never duplicate the same transformation/mapping/conversion logic in
  more than one place (backend, analytics, frontend).
- Check existing docs/code before changing an API, schema, field name,
  threshold, or data interpretation.
- Reuse existing constants/utilities/validation instead of rewriting.
- If something about the contract is unclear — **flag it to the team,
  don't guess.**
- Any intentional contract change must be documented here and
  communicated to the team **before** dependent code is changed.

## 12. Open items / known gaps (latest sync)

**Resolved since last update:**
- [x] `backend/`, `data/`, `analytics/`, `tests/`, `docs/` folders all
      exist now.
- [x] Data-source indicator live in UI ("Sample/Demo" vs "Uploaded Data").
- [x] `data/processed/cleaned_data.csv` exists (43,272 rows, 12 monthly
      dates, real chainage/date spread) — multi-date blocker resolved.
- [x] Backend/frontend port mismatch fixed (both on 5001).

**Still open / newly found:**
- [ ] **`analytics/run_analytics.py` still cannot run** — imports
      function names (`detect_alerts`, `analyze_trends`, etc.) that
      don't exist in `alert_engine.py`/`trend_analysis.py`/`evaluate.py`.
      `trend_analysis.py` also independently fails to import
      (`deviation`, `NOMINAL_GAUGE_MM` referenced but never defined in
      `thresholds.py`). Even Person 4's own `test_person4.py` doesn't
      match the delivered code — expects a `context`-based
      `evaluate_parameter()` that doesn't exist anywhere. Needs Person 4
      to reconcile — possibly a newer local version was never pushed.
- [ ] **Dashboard alerts are currently sourced from the CSV's new
      `alert` label column (see §1 amendment), not from
      `analytics/alert_engine.py`.** This needs to be communicated
      clearly for demo/interview honesty — don't describe alerts as
      "computed by our rule engine" until that engine actually runs.
- [ ] **`pickCurrentDate()` in `trackDataService.js` still has the
      original bug** (breaks date ties by first-seen, not by latest
      date) — inconsistent with the new `build-analytics-output.js`
      script, which correctly picks the latest date. Only affects the
      manual-upload path for now, but should be fixed for consistency.
- [ ] Threshold values in `analytics/thresholds.py` still don't match
      the locked table above for 4 of 6 parameters (see §4) — unresolved.
- [ ] Alert object shape from `alert_engine.py` still doesn't match the
      locked `{param, start, end, peak, sev}` format (see §8) —
      unresolved (though `build-analytics-output.js`'s stand-in output
      does match the locked shape correctly).
- [ ] `MaintenancePriorityList.jsx` not built yet.
- [ ] `/tracks`, `/alerts`, `/analytics`, `/priority` response shapes
      still not formally documented.
- [ ] `docs/threshold_validation.md` — IRPWM sourcing still not written.
- [ ] Data values look unusually far past critical thresholds (e.g.
      unevenness 28mm vs 13mm critical) — confirm with Person 3 whether
      intentional (worst-case demo section) or a generator issue.
