# Integration Test Checklist — TrackVigil

Living checklist. Update status as each piece comes online — don't wait
until the end to run this. Re-run relevant sections any time someone
changes a shared contract (CSV schema, thresholds, API shape).

Legend: ⬜ not started · 🟡 partial/stubbed · ✅ passing

---

## Stage 1 — Data (Person 3)

- ✅ `cleaned_data.csv` exists and matches locked schema
      (`chainage,date,parameter,value`) — verified 2026-08-22 against the
      copy Person 3 shared in the group (43,272 rows). Ran it through
      `tests/benchmark_test.py`'s `process_dataset()` schema assertion and
      it passed with no errors.
- ✅ Only the 6 locked parameter names appear (`gauge`, `alignment`,
      `twist`, `unevenness`, `crossLevel`, `railWear`) — no typos/aliases.
      Confirmed exactly 7,212 rows per parameter (601 chainage points × 12
      dates), evenly split, no unexpected values.
- ✅ No missing/duplicate/invalid rows in the "cleaned" output — checked
      for duplicate `(chainage, date, parameter)` keys (0 found) and ran
      the full file through the parser with zero rows rejected.
- 🟡 Date format confirmed and consistent — all 12 dates are valid
      `YYYY-MM-DD` ISO 8601 and evenly spaced ~monthly (2025-10-19 through
      2026-09-25). **Flag for Person 3:** the last date (2026-09-25) is
      after today's date (2026-08-22) — confirm that's intentional
      (e.g. a deliberately future-dated "next inspection" placeholder)
      and not a typo, before it goes in front of judges.
- ⬜ Real data documented with source, OR synthetic data clearly labeled
      as synthetic (not presented as real) — **not yet confirmed with
      Person 3**; needed for the demo pitch (`docs/demo_plan.md` §5).
- 🟡 1k / 10k / 50k / 100k row versions generated for scalability
      testing — not yet provided by Person 3. `tests/scalability_test.py
      --generate-temp` was used to validate the *harness* only
      (`results/scalability_results.csv`, clearly TEMP-labeled) — those
      numbers must NOT go in the final PPT. Re-run with
      `--data-dir data/processed` once Person 3's real sized files land.
- ✅ Multi-date / trend-readiness — new `tests/data_contract_test.py`
      (added 2026-08-22) confirms: 12 distinct dates present, all
      3,606 chainage×parameter pairs have 2+ dates (fully trend-eligible),
      chainage stays within the locked 0–60km range at every date. Run:
      `python tests/data_contract_test.py --csv <path>` — 7/7 checks
      passed, exit code 0.

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

- 🟡 Dashboard renders against **real uploaded data**, not just
      `generateDataset()` mock (mock kept only as fallback) — confirmed
      working via CSV upload (reported by team, 2026-08-22). Note: this
      is real *uploaded* data, not real *backend* data — `backend/`
      still doesn't exist, so the original criterion ("real backend
      data") isn't literally met yet, just the practical equivalent for
      demo purposes.
- 🟡 Trend Projection shows a working view against uploaded historical
      data (reported by team, 2026-08-22) — **not independently
      verified** by Person 5 that it specifically surfaces all of:
      current value, rate of change, critical threshold, estimated time
      to critical, predicted date, urgency ranking. Person 1 to confirm
      which of these fields are actually present.
- 🟡 Report view works against uploaded data (reported by team,
      2026-08-22) — contents not independently itemized/verified.
- ❓ `MaintenancePriorityList.jsx` — status not confirmed as of this
      update. Do not assume built/working; check with Person 1 before
      demo day.
- ⬜ Data source/status indicator visible (real vs. fallback/demo data)
      — not confirmed either way.
- ⬜ No "AI" language anywhere in UI copy — use "threshold-based
      monitoring and statistical trend analysis" — not independently
      reviewed this pass.
- ⬜ Thresholds displayed in UI match `docs/data_format.md` table exactly
      — not independently reviewed this pass.

## Stage 5 — End-to-end sanity checks

- 🚫 BLOCKED (environment): **Perturbation test** — designed and ready
      (pick one row in `cleaned_data.csv`, push its value past critical,
      confirm the alert appears). Not executed this pass — requires a
      running browser/frontend session, which Person 5's current
      environment doesn't have. Someone with the dev server running
      needs to actually click through this.
- ❓ A section known to be near-critical shows up correctly ranked in
      Maintenance Priority List — blocked on Priority List status itself
      (Stage 4) being unconfirmed.
- 🚫 BLOCKED (environment): Chainage search/drill-down consistency
      across Dashboard, Trend, and Report — same reason as above, needs
      a live browser session to click through, not just CSV-level
      checks.
- 🟡 Full pipeline run on all 4 dataset sizes without crashing — the
      *data-contract and benchmark harness* has been run without
      crashing (`tests/benchmark_test.py`, `tests/data_contract_test.py`,
      real CSV + `--generate-temp`), but this is data/backend-stub level
      only, not the full frontend pipeline, and not yet at the real
      1k/10k/50k/100k sizes (still synthetic placeholders for those).

## Stage 6 — Benchmarking (Person 5)

Table to fill with **measured**, not target, numbers:

| Dataset Size | Processing Time | Alert Generation | API Response | Chainage Query |
|---------------|------------------|-------------------|----------------|------------------|
| 1,000         |                  |                   |                |                  |
| 10,000        |                  |                   |                |                  |
| 50,000        |                  |                   |                |                  |
| 100,000       |                  |                   |                |                  |

Only measured results go in the final PPT — no projected/target numbers.

**Status (2026-08-22):** Harness (`tests/benchmark_test.py`,
`tests/scalability_test.py`) is verified working end-to-end:
- Ran against the real `cleaned_data.csv` (43,272 rows, all 12 dates) →
  `results/benchmark_results.csv`. Real, measured numbers — safe to cite
  for "does it work on real data" but it's not one of the 4 target sizes.
- Ran `--generate-temp` to prove the 1k/10k/50k/100k table format works
  → `results/scalability_results.csv`, rows clearly marked as temp/dev
  data. **Do not use these numbers in the PPT** — waiting on Person 3's
  real sized files, then re-run with `--data-dir`.

---

## Known blockers right now (updated Aug 22)

- `backend/`, `data/`, `analytics/` folders still don't exist —
  Stage 2 (Analytics) and Stage 3 (Backend) checklists remain entirely
  ⬜ and can't start until those land. This is the single biggest
  remaining gap.
- No API response shapes documented yet from Person 2.
- Frontend (Stage 4) has real reported progress — CSV upload, Dashboard,
  Trend Projection, and Report all reportedly work against real
  uploaded historical data — but Person 5 could only verify this at the
  **data level** (schema, dates, chainage×parameter trend-eligibility
  via `tests/data_contract_test.py`), not by actually running the app in
  a browser. Stage 5's browser-dependent checks are marked BLOCKED
  (environment) rather than assumed passing.
- Maintenance Priority List status is unconfirmed — don't assume it
  exists for the demo until Person 1 confirms.
