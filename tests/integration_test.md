# Integration Test Checklist — TrackVigil

Living checklist. Update status as each piece comes online — don't wait
until the end to run this. Re-run relevant sections any time someone
changes a shared contract (CSV schema, thresholds, API shape).

Legend: ⬜ not started · 🟡 partial/stubbed · ✅ passing

---

## Stage 1 — Data (Person 3)

- ⬜ `cleaned_data.csv` exists and matches locked schema
      (`chainage,date,parameter,value`)
- ⬜ Only the 6 locked parameter names appear (`gauge`, `alignment`,
      `twist`, `unevenness`, `crossLevel`, `railWear`) — no typos/aliases
- ⬜ No missing/duplicate/invalid rows in the "cleaned" output
- ⬜ Date format confirmed and consistent
- ⬜ Real data documented with source, OR synthetic data clearly labeled
      as synthetic (not presented as real)
- ⬜ 1k / 10k / 50k / 100k row versions generated for scalability testing

## Stage 2 — Analytics (Person 4)

- ⬜ `thresholds.py` values match `docs/data_format.md` table, sourced
      from IRPWM (or cited alternative), source documented per parameter
- ⬜ `alert_engine.py` severity boundaries match Person 1's frontend logic
      (confirm ≥ / > edge behavior matches)
- ⬜ Alerts fire correctly on known threshold-crossing test rows
- ⬜ `trend_analysis.py` outputs: current value, trend direction, rate,
      critical threshold, estimated time to critical, predicted date
      (when meaningful)
- ⬜ Ranked maintenance priority list generated, matches expected order
      on a hand-checked sample
- ⬜ `anomaly_detection.py` (Isolation Forest) clearly separated from
      threshold alerting — not duplicating rule engine's role
- ⬜ `evaluate.py`: precision/recall only reported if real ground truth
      exists; otherwise validation method + limitations documented
      (no fabricated numbers)
- ⬜ Output JSON (`alerts.json`, `trends.json`, `priority.json`) matches
      what Person 2 expects to consume

## Stage 3 — Backend (Person 2)

- ⬜ Reads `cleaned_data.csv` without errors
- ⬜ Serves Person 4's analytics output correctly via `/analytics`,
      `/priority`
- ⬜ `GET /tracks` — response shape documented and stable
- ⬜ `GET /alerts` — response shape documented and stable
- ⬜ `GET /analytics` — response shape documented and stable
- ⬜ `GET /priority` — response shape documented and stable
- ⬜ Frontend never has to parse raw CSV structure directly
- ⬜ Upload flow works (if part of demo)
- ⬜ No `.env` / credentials committed

## Stage 4 — Frontend (Person 1)

- ⬜ Dashboard renders against **real backend data**, not just
      `generateDataset()` mock (mock kept only as fallback)
- ⬜ `TrendView` shows: current value, rate of change, critical
      threshold, estimated time to critical, predicted date, urgency
      ranking
- ⬜ `MaintenancePriorityList.jsx` built and shows: section/chainage,
      parameter, severity, current value, critical threshold, ETA to
      critical, priority rank
- ⬜ Data source/status indicator visible (real vs. fallback/demo data)
- ⬜ No "AI" language anywhere in UI copy — use "threshold-based
      monitoring and statistical trend analysis"
- ⬜ Thresholds displayed in UI match `docs/data_format.md` table exactly

## Stage 5 — End-to-end sanity checks

- ⬜ **Perturbation test:** change one value in `cleaned_data.csv` to
      cross a critical threshold → confirm the correct alert appears
      all the way through to the dashboard
- ⬜ A section known to be near-critical shows up correctly ranked in
      Maintenance Priority List
- ⬜ Chainage search/drill-down returns consistent data across
      Dashboard, Search, Trend, and Report views
- ⬜ Full pipeline run on all 4 dataset sizes without crashing

## Stage 6 — Benchmarking (Person 5)

Table to fill with **measured**, not target, numbers:

| Dataset Size | Processing Time | Alert Generation | API Response | Chainage Query |
|---------------|------------------|-------------------|----------------|------------------|
| 1,000         |                  |                   |                |                  |
| 10,000        |                  |                   |                |                  |
| 50,000        |                  |                   |                |                  |
| 100,000       |                  |                   |                |                  |

Only measured results go in the final PPT — no projected/target numbers.

---

## Known blockers right now (Aug 22)

- Repo only has the Person 1 frontend prototype; `backend/`, `data/`,
  `analytics/` folders don't exist yet — most of this checklist can't
  start until those come online.
- No API response shapes documented yet from Person 2.
