# Validation Method — TrackVigil (SIH 2026)

How we know the alerts/severity classifications are actually correct,
not just plausible-looking. Required for the anticipated judge question
"How do you validate the alerts are correct?" (`docs/demo_plan.md` §5).

**Status as of Aug 22: no ground-truth dataset exists.** No
precision/recall numbers exist and none should be stated until real
ground truth is available. This is a stub — filled in only with what's
actually been checked so far.

## 1. What has been verified so far (Person 5, data/logic level)

- Schema conformance: `cleaned_data.csv` (43,272 rows) matches the
  locked `chainage,date,parameter,value` schema exactly, with only the
  6 locked parameter names present — no typos/aliases. (See
  `tests/integration_test.md` Stage 1.)
- Severity boundary logic (`value >= critical` / `value >= warning`,
  both inclusive) was run against the real CSV via
  `tests/benchmark_test.py`'s `classify()` — produced 1,911
  contiguous-run alerts with no runtime errors. This confirms the logic
  *runs correctly end-to-end on real data*, not that the resulting
  alerts are *correct* in the sense of matching real track conditions.
- No comparison against real inspector-flagged sections or known-fault
  ground truth has been done — none exists yet.

## 2. What "correct" would need to mean here

Two different claims get conflated if we're not careful — keep them
separate in the demo:

1. **Logic correctness** — does the code correctly implement the
   locked severity rule on the data it's given? *This has been checked*
   (see §1).
2. **Real-world correctness** — do the thresholds/alerts actually
   correspond to genuinely at-risk track sections? *This has not been
   checked*, because it requires either real inspection records to
   compare against, or a domain expert to review flagged sections.

## 3. Current validation approach (until real ground truth exists)

- No fabricated precision/recall. If asked, say plainly: no ground
  truth dataset exists yet, so precision/recall aren't reported.
- What we can show instead: the perturbation test in
  `tests/integration_test.md` Stage 5 — deliberately push one value in
  `cleaned_data.csv` past a critical threshold and confirm the
  corresponding alert appears — demonstrates the logic responds
  correctly to known inputs, which is a weaker but honest form of
  validation.
- If Person 3/4 can source even a small set of known-fault sections
  (real or documented-synthetic "these X sections are known bad"),
  that becomes the real ground truth for `evaluate.py`
  (`docs/architecture.md` §3) and this doc should be updated with
  actual precision/recall at that point — not before.

## 4. Open items

- [ ] Ground truth dataset — does one exist or can one be constructed?
      (Person 3/4)
- [ ] `evaluate.py` — not yet implemented (Person 4)
- [ ] Perturbation test (Stage 5) — designed but not yet executed
      against a live pipeline (needs backend/analytics online first, or
      can be run at the frontend/data level in the meantime)
