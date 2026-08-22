# Data Format Contract — TrackVigil (SIH 2026)

This is the **single source of truth** for field names, formats, and thresholds
across the pipeline. If your module doesn't match this doc, it's wrong — fix
your module, don't fix the doc without telling the team.

Status as of Aug 22 (updated, Person 5): repo (`trackvigil--main`) contains
the Person 1 frontend, `docs/`, `tests/`, and `results/`. The frontend is
**no longer mock-only** — CSV upload works against the locked schema below,
and the Dashboard, Trend Projection, and Report views all run against real
uploaded historical multi-date data (verified with the 43,272-row,
12-date `cleaned_data.csv`). `backend/`, `data/`, `analytics/` still do not
exist at repo root as of this update — no API, no server-side analytics yet.

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

## 5b. Trend/history data (frontend, current state)

`src/lib/trackDataService.js` now supports generic uploaded historical
trends: uploading a CSV with multiple `date` values for the same
`chainage`/`parameter` drives the Trend Projection and Report views,
not just a fixed set of hardcoded demo sections. Confirmed working
against `cleaned_data.csv` (601 chainage points × 12 dates).

**Not yet re-verified by Person 5 at the code level** — this entry
reflects what the team has reported as working, not a line-by-line
review of the updated `trackDataService.js` (out of scope for this
doc/test pass per team rules — `src/` is Person 1's folder). If the
exact trend calculation (moving average / regression / other) needs to
be documented precisely, that should come from Person 1 directly so
this doc doesn't guess at someone else's implementation.

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

- [x] `tests/`, `docs/`, `results/` folders exist and are populated
      (this doc, architecture, demo plan, integration checklist,
      benchmark/scalability scripts, benchmark/scalability results).
- [ ] `backend/`, `data/`, `analytics/` folders still not created at
      repo root — no live API, no server-side alert/trend engine yet.
      Frontend currently does its own CSV parsing + trend logic
      client-side (`src/lib/trackDataService.js`) as a stand-in.
- [x] Frontend CSV upload now works against this locked schema —
      Dashboard, Trend Projection, and Report views all run against
      uploaded historical multi-date data, not just `generateDataset()`
      mock data. Mock data is now a fallback, not the only path.
- [ ] `MaintenancePriorityList.jsx` not built yet (Person 1 task, spec'd
      in team rules doc).
- [ ] No data-source/status indicator in UI yet (real vs. fallback/demo
      data) — required for judges.
- [x] `date` format confirmed 2026-08-22: `YYYY-MM-DD`, 12 distinct
      monthly dates present in the shared `cleaned_data.csv`
      (2025-10-19 → 2026-09-25) — trend calculations are **not** blocked
      the way this doc previously assumed. **Flag for Person 3:** the
      newest date (2026-09-25) is after today — confirm intentional.
- [ ] `/tracks`, `/alerts`, `/analytics`, `/priority` response shapes not
      yet documented — TODO once Person 2 has a stub.
- [ ] Thresholds table above needs IRPWM validation from Person 4 —
      currently just what's hardcoded in frontend mock data.
