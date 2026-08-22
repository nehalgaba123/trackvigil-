# Architecture — TrackVigil (SIH 2026)

How the system fits together end to end: what each piece does, who owns
it, what tech it uses, and how data moves through it. See
`docs/data_format.md` for the exact field/schema/threshold contract —
this doc explains the *shape* of the system, that doc is the *rulebook*.

---

## 1. System overview (one paragraph)

TrackVigil ingests railway Track Recording Car (TRC) geometry data (6
parameters per chainage point), runs it through threshold-based alerting
and statistical trend analysis to flag sections at risk, ranks them by
urgency, and presents it all on a live dashboard — so a track inspector
knows what to check first, not just what the raw numbers say.

## 2. The five pieces and who owns them

| Layer | Folder | Owner | Tech |
|---|---|---|---|
| Data | `data/` | Person 3 | Python (pandas), CSV |
| Analytics | `analytics/` | Person 4 | Python (scikit-learn for anomaly detection, numpy/scipy for trend regression) |
| Backend | `backend/` | Person 2 | Node.js, Express |
| Frontend | `frontend/` (currently repo root `src/`) | Person 1 | React, Vite, Tailwind, Recharts |
| Integration/Testing | `tests/`, `docs/`, `results/` | Person 5 (you) | Python test scripts, Markdown docs |

## 3. End-to-end data flow

```
┌─────────────┐
│  Raw TRC     │  railway_data.csv (or real/public source, documented)
│  data        │
└──────┬──────┘
       │  clean_data.py (Person 3)
       │  - fix missing/invalid/duplicate rows
       │  - enforce locked schema: chainage,date,parameter,value
       │  - enforce locked parameter names (6 only)
       ▼
┌─────────────┐
│ cleaned_data │  Long format, locked schema. Also generated in
│   .csv       │  1k/10k/50k/100k sizes for scalability testing.
└──────┬──────┘
       │
       ▼
┌──────────────────────────────────────────┐
│  ANALYTICS (Person 4)                      │
│  ┌────────────────┐  ┌───────────────────┐ │
│  │ thresholds.py   │  │ trend_analysis.py  │ │
│  │ (IRPWM-sourced) │  │ (moving avg +      │ │
│  └────────┬────────┘  │  linear regression)│ │
│           │            └──────────┬─────────┘ │
│           ▼                       ▼            │
│  ┌────────────────┐  ┌───────────────────┐    │
│  │ alert_engine.py │  │ anomaly_detection  │    │
│  │ (rule-based,    │  │ .py (Isolation     │    │
│  │  threshold      │  │  Forest — outliers  │    │
│  │  crossing)      │  │  not caught by      │    │
│  │                 │  │  fixed thresholds)  │    │
│  └────────┬────────┘  └──────────┬─────────┘    │
│           └───────────┬──────────┘               │
│                        ▼                          │
│         alerts.json, trends.json, priority.json   │
│                        │                           │
│                        ▼                           │
│                  evaluate.py                       │
│         (precision/recall IF ground truth          │
│          exists; else documented validation        │
│          method + limitations — never invented)    │
└──────────────────────┬─────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────┐
│  BACKEND (Person 2)                        │
│  dataService.js — reads cleaned_data.csv   │
│  analyticsService.js — reads Person 4's    │
│    JSON output, transforms long-format     │
│    analytics into frontend-shaped JSON     │
│                                             │
│  Exposes:                                  │
│    GET /tracks                             │
│    GET /alerts                             │
│    GET /analytics                          │
│    GET /priority                           │
│                                             │
│  Frontend never touches raw CSV directly.  │
└──────────────────────┬─────────────────────┘
                        │  HTTP/JSON
                        ▼
┌──────────────────────────────────────────┐
│  FRONTEND (Person 1) — React dashboard     │
│  services/api.js → components → pages      │
│                                             │
│  DashboardView | TrendView | SearchView |  │
│  ReportView | MaintenancePriorityList      │
│                                             │
│  Data-source indicator: real vs.           │
│  fallback/demo data, always visible.       │
└──────────────────────┬─────────────────────┘
                        │
                        ▼
              Judge-facing live demo
        "Actionable railway inspection decision"
```

## 4. Current repo state vs. target state (updated Aug 22, Person 5)

**What exists and works right now:**
- `src/RailTrackDashboard.jsx` + `src/lib/trackDataService.js` — the
  frontend is **no longer mock-only**. CSV upload works against the
  locked schema. Dashboard, Trend Projection, and Report views all run
  against real uploaded historical multi-date data — verified with the
  43,272-row, 12-date `cleaned_data.csv`. `generateDataset()` mock data
  is now a fallback, not the only data path.
- `docs/`, `tests/`, `results/` — created and populated (this doc, data
  format contract, integration checklist, benchmark/scalability
  scripts, benchmark/scalability results).

**What's still missing at repo root:**
- `backend/` — not created yet (Person 2 working on it). No live
  `/tracks`, `/alerts`, `/analytics`, `/priority` API yet — the
  frontend's CSV upload + client-side processing is standing in for
  this for now.
- `data/` — not created yet as a formal folder (Person 3 working on it;
  `cleaned_data.csv` has been shared and verified by Person 5, but not
  yet committed to a `data/processed/` folder, and sized 1k/10k/50k/100k
  variants for scalability testing haven't been shared yet either)
- `analytics/` — not created yet (Person 4 working on it). No
  server-side `alert_engine.py`/`trend_analysis.py`/threshold-sourcing
  yet — severity classification currently only happens client-side in
  the frontend, using the same locked threshold table.

**Note:** this section reflects what the team has reported as working.
Person 5 has not done a line-by-line review of the updated `src/`
frontend code (out of scope — that's Person 1's folder); the CSV-level
facts above (row/date counts, schema) are independently verified against
`cleaned_data.csv`, the UI behavior claims are as reported by the team.

**Open architectural question:** the frontend prototype is a single
1274-line file, not the `lib/`/`components/`/`pages/`/`services/` split
described in the team's original folder plan. The team needs to decide
whether to refactor into that structure before wiring up the real
backend, or keep the single-file version and adapt the plan. This
affects how Person 2's `services/api.js` consumption layer gets built.

## 5. Why the pipeline is ordered this way

Data has to be **cleaned before it's analyzed** (garbage in, garbage
alerts out). Analysis has to happen **before the backend serves it**
(the backend's job is to serve pre-computed insight, not compute
statistics on every request — that's why `/analytics` and `/priority`
are planned to just read Person 4's output rather than recalculating
live). The target design is for the frontend to never parse raw data
directly — only talk to the backend's already-shaped JSON.

**Current interim state:** since `backend/` and `analytics/` don't
exist yet, the frontend's CSV upload path (`src/lib/trackDataService.js`)
is temporarily doing its own parsing, schema validation, and
severity/trend logic client-side, straight from the uploaded CSV. This
is why Dashboard/Trend/Report already work end-to-end even with no
backend — but it means severity thresholds and trend logic currently
live in exactly one place (the frontend), not the intended two
(frontend display copy + backend/analytics source of truth). Once
`backend/`+`analytics/` exist, this client-side path should be replaced
by real API calls per the target design above, not kept as a permanent
second implementation of the same logic.

This separation is also what makes each person's work independently
testable: you can validate Person 4's alerts against `cleaned_data.csv`
without a backend or frontend running at all, which is exactly what
`tests/backend.test.js` and `tests/analytics.test.py` will do once
those layers exist.

## 6. Where Person 5's work fits in

- `tests/integration_test.md` — the checklist proving every arrow in the
  diagram above actually works, not just that each box works alone.
- `tests/benchmark_test.py` / `tests/scalability_test.py` — measure how
  long each arrow takes, at increasing data volume.
- `docs/data_format.md` — the contract that keeps every box speaking the
  same language (field names, thresholds, severity logic, alert shape).
- `docs/threshold_validation.md`, `docs/validation_method.md` — the
  evidence that the ANALYTICS box's outputs are actually correct, not
  just plausible-looking.
- `docs/demo_plan.md` — how this whole diagram gets narrated to judges
  in the time available.

## 7. Open items (tracked in more detail in data_format.md §7)

- [x] `results/` folder now exists (benchmark + scalability results).
- [ ] `backend/`, `data/`, `analytics/` folders not yet created in the
      repo — biggest remaining gap.
- [ ] Frontend single-file vs. planned folder-split decision still open
- [ ] API response shapes not yet documented (waiting on Person 2 stub)
- [x] `cleaned_data.csv` verified 2026-08-22 (Person 5) — actually has
      12 dates (monthly, Oct 2025–Sep 2026), 43,272 rows, all 6 locked
      params, no schema/duplicate issues. Trend calculations are **not**
      blocked. One flag for Person 3: the newest date is after today's
      date — confirm intentional. See `tests/integration_test.md` Stage 1.
- [x] Frontend CSV upload, Dashboard, Trend Projection, and Report now
      work against real uploaded historical multi-date data (as
      reported by the team; see §4 above for verification scope).
- [ ] IRPWM threshold sourcing not yet documented — see
      `docs/threshold_validation.md` (currently a stub, nothing sourced
      yet).
- [ ] Alert/severity validation method not yet documented — see
      `docs/validation_method.md` (currently a stub, no ground truth
      exists yet).
