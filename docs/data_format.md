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
| `date`      | ISO 8601 date | `YYYY-MM-DD` — confirm with Person 3         |
| `parameter` | string        | one of the 6 locked parameter names below   |
| `value`     | float (mm)    | deviation/measurement, unit = mm            |

No other columns. No wide format. Long format only.

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

(Confirmed as of the current frontend prototype — these exact keys are
already used in `RailTrackDashboard.jsx`'s `PARAMS` object.)

## 3. Thresholds (must match between Person 1 and Person 4)

**Currently hardcoded in the frontend prototype** (`THRESHOLDS` object,
`RailTrackDashboard.jsx`) — units = mm, presumably deviation from nominal:

| Parameter    | Warning | Critical |
|--------------|---------|----------|
| gauge        | 5       | 9        |
| alignment    | 5       | 10       |
| twist        | 4       | 7        |
| unevenness   | 8       | 13       |
| crossLevel   | 6       | 10       |
| railWear     | 8       | 12       |

**Action needed:** Person 4 must validate these against IRPWM (or cite a
different official source) and confirm whether track/speed class matters. If
Person 4's sourced values differ from the table above, **the frontend values
must be updated to match** — don't let these silently diverge. Whoever
changes this table must ping the team.

## 4. Severity logic (must match between Person 1 and Person 4)

Frontend currently classifies severity as: value < warning → normal,
warning ≤ value < critical → warning, value ≥ critical → critical
(see `getSeverity()` in `RailTrackDashboard.jsx`). Person 4's
`alert_engine.py` must implement the same boundary logic (confirm ≥ vs >
at the edges — easy place for an off-by-one mismatch).

## 5. API contract (must match between Person 1 and Person 2)

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

## 6. Pipeline

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

## 7. Open items / known gaps (as of Aug 22)

- [ ] Repo root doesn't yet have `backend/`, `data/`, `analytics/`,
      `tests/`, `docs/` folders — needs to be set up before parallel work
      starts colliding.
- [ ] `MaintenancePriorityList.jsx` not built yet (Person 1 task, spec'd
      in team rules doc).
- [ ] No data-source/status indicator in UI yet (real vs. fallback/demo
      data) — required for judges.
- [ ] `date` format not yet confirmed with Person 3.
- [ ] `/tracks`, `/alerts`, `/analytics`, `/priority` response shapes not
      yet documented — TODO once Person 2 has a stub.
- [ ] Thresholds table above needs IRPWM validation from Person 4 —
      currently just what's hardcoded in frontend mock data.
