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

## 4. Current repo state vs. target state (as of Aug 22)

**What exists right now:**
- `src/RailTrackDashboard.jsx` — single-file frontend prototype, running
  entirely on in-browser generated mock data (`generateDataset()`).
  No backend, no real data, no analytics behind it yet.
- `docs/`, `tests/` — now created and populated (this doc, data format
  contract, integration checklist, benchmark/scalability scripts).

**What's still missing at repo root:**
- `backend/` — not created yet (Person 2 working on it)
- `data/` — not created yet (Person 3 working on it; one sample
  `cleaned_data.csv` has been shared in the group but not yet committed
  to a `data/processed/` folder)
- `analytics/` — not created yet (Person 4 working on it)
- `results/` — not created yet, will hold benchmark/scalability CSV
  output and screenshots once the pipeline is testable end-to-end

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
just read Person 4's output rather than recalculating live). The
frontend never parses raw data at all — it only ever talks to the
backend's already-shaped JSON. This separation is also what makes each
person's work independently testable: you can validate Person 4's
alerts against `cleaned_data.csv` without a backend or frontend running
at all, which is exactly what `tests/backend.test.js` and
`tests/analytics.test.py` will do once those layers exist.

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

## 7. Open items (tracked in more detail in data_format.md §12)

- [ ] `backend/`, `data/`, `analytics/`, `results/` folders not yet
      created in the repo
- [ ] Frontend single-file vs. planned folder-split decision still open
- [ ] API response shapes not yet documented (waiting on Person 2 stub)
- [ ] `cleaned_data.csv` only has one date — blocks trend calculations
- [ ] IRPWM threshold sourcing not yet documented
