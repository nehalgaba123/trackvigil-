# Demo Plan — TrackVigil (SIH 2026)

Rough draft. This gets more concrete as backend/analytics come online —
right now it's the skeleton so nothing gets forgotten under time pressure
on demo day. Update the `[TBD]` markers as real pieces land.

**Status as of Aug 22 (Person 5):** the CSV upload → Dashboard → Trend
Projection → Report flow works end-to-end against real uploaded
historical multi-date data — this is the confirmed-working core of the
live demo right now. `backend/` and `analytics/` still don't exist, so
there is **no live API** yet; everything currently runs client-side off
the uploaded CSV. Maintenance Priority List status is not confirmed as
of this update — check with Person 1 before assuming row 5 below is
ready.

---

## 1. The pitch (30 seconds, memorize this)

**Problem:** Track Recording Cars generate huge volumes of geometry data
(gauge, alignment, twist, unevenness, cross-level, rail wear), but
turning that into "which section do I inspect first" is still manual and
slow.

**What we built:** TrackVigil ingests that data, flags sections that
cross safety thresholds, predicts *when* a worsening section will become
critical using trend analysis, and ranks everything into a single
maintenance priority list — so an inspector knows exactly where to go
next, not just that "something somewhere" is wrong.

**Say "threshold-based monitoring, anomaly detection, and statistical
trend analysis." Never say "AI."** (team rule — judges may probe this)

## 2. Demo flow — what gets shown, in order

| # | Screen/action | What you say | Status | Who presents |
|---|---|---|---|---|
| 1 | CSV upload | "Here's real/synthetic TRC data being ingested — [TBD: real or synthetic, must say correctly]" | ✅ works | [TBD] |
| 2 | Dashboard overview | "Every 100m of track, 6 parameters, live severity coloring" | ✅ works | [TBD] |
| 3 | An alert / chainage drill-down | "Here's a section that's crossed the critical threshold for cross-level — here's exactly where and by how much" | ✅ works (part of Dashboard) | [TBD] |
| 4 | Trend Projection | "This section isn't just bad now — it's getting worse. Based on the rate of change, we estimate it reaches critical in ~X days" | ✅ works, driven by uploaded historical dates | [TBD] |
| 5 | Report | "Exports/summarizes the current inspection pass" | ✅ works | [TBD] |
| 6 | Maintenance Priority List | "All flagged sections, ranked by urgency — this is the actionable output" | ❓ not confirmed — check with Person 1 before including | [TBD] |
| 7 | Scalability numbers | "Tested at 1k up to 100k readings — here's how processing time holds up" | 🟡 harness proven, real sized-data numbers still pending Person 3 (see `results/scalability_results.csv`) | You (Person 5) |
| 8 | Close | Restate the pitch, mention what's threshold-based vs. statistical, invite questions | — | [TBD] |

**Note:** there is currently no live backend, so the whole live-clicking
part of the demo (rows 1–6) runs off a CSV uploaded directly into the
frontend — there's no separate "is the backend up" risk yet, but there's
also no server-side analytics to point to if asked what's computed where.

**Not decided yet:** who presents which section — worth assigning this
once the frontend is stable enough to rehearse against.

## 3. Numbers to have ready (must be REAL, measured — no estimates)

- [ ] Rows processed per dataset size (1k/10k/50k/100k) — `results/scalability_results.csv`
- [ ] Alert generation time at each size
- [ ] API response time at each size (once backend exists)
- [ ] Chainage query time at each size
- [ ] Precision/recall — **only if real ground truth exists**; otherwise
      have the validation-method explanation ready instead (see §5)

## 4. Live demo failure fallback

Hackathon wifi/laptops fail — have a plan before it happens, not during:

- [ ] Screen-recorded backup video of the full flow, made the night before
- [ ] Screenshots of every key screen (dashboard, alert, trend, priority
      list) saved locally, not just cloud
- [ ] Since there's no backend yet, the live demo depends on the CSV
      upload working on the demo laptop — have `cleaned_data.csv` saved
      locally (not just cloud) as the upload file, and rehearse the
      upload step specifically, not just the views after it
- [ ] If upload/frontend fails live: fall back to explaining the
      architecture diagram (`docs/architecture.md`) instead of
      live-clicking through it. Once backend exists, add "if backend is
      down" as a separate fallback case.
- [ ] Know in advance: is there a deployed/hosted version, or does this
      only run on one laptop? [TBD — confirm with Person 1/2]

## 5. Anticipated judge questions (prep answers now, don't improvise)

- **"Is this AI?"** → No — threshold-based rule engine + statistical
  trend analysis (linear regression) + anomaly detection (Isolation
  Forest) for outliers the fixed thresholds miss. Be ready to explain
  the difference simply.
- **"Is this real data?"** → Answer honestly based on what actually
  happened: [TBD — depends on whether Person 3 sourced real data or
  used documented synthetic data]. Never claim synthetic data is real.
- **"How do you validate the alerts are correct?"** → Point to
  `evaluate.py` results. If no ground truth exists, say so plainly and
  explain the validation method used instead — don't invent precision/
  recall numbers.
- **"Does this scale?"** → Point to the scalability numbers (§3),
  actual measured times at 100k rows.
- **"What happens with missing/bad sensor data?"** → [TBD — confirm
  with Person 3/4 how gaps and invalid readings are actually handled]
- **"Why these threshold values?"** → `docs/threshold_validation.md`
  exists now but is still a stub — IRPWM (or another standard) hasn't
  been sourced yet. If asked before that's done, say so honestly:
  representative/illustrative values for the prototype, pending formal
  validation.

## 6. Things to NOT say or show

- Never call it "AI" — say threshold-based monitoring / anomaly
  detection / statistical trend analysis.
- Never present synthetic data as real, or vice versa — check which one
  is actually being shown before saying anything about it.
- Never state precision/recall numbers that weren't actually measured
  against real ground truth.
- Don't show the mock/fallback data (`generateDataset()`) as if it's the
  real pipeline output, once real data is available — the UI's
  data-source indicator should make this obvious to the team and judges
  alike.

## 7. Timing budget

Total demo time: **[TBD — confirm actual slot length from SIH schedule]**

Rough split for a ~5 minute demo (adjust once actual slot is known):
- Pitch: 30s
- Live walkthrough (§2): ~3 min
- Numbers/validation: ~1 min
- Close + buffer for questions: remaining

## 8. Pre-demo checklist (night before / morning of)

- [ ] Full pipeline run once, start to finish, on a clean machine
- [ ] Backup video recorded
- [ ] Screenshots saved locally
- [ ] Laptop charged, backup charger packed
- [ ] Confirm wifi/hotspot fallback if venue wifi is unreliable
- [ ] Everyone knows their speaking part and the order (§2)
- [ ] Numbers in §3 filled in with final measured results, not
      placeholders

---

## Open items

- [ ] Assign presenter per demo section (§2)
- [ ] Confirm real vs. synthetic data status before finalizing pitch
      language
- [ ] Confirm actual SIH demo slot length
- [ ] Confirm deployed/hosted vs. local-only demo setup
