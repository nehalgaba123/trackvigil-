# Threshold Validation — TrackVigil (SIH 2026)

Tracks whether the warning/critical thresholds in `docs/data_format.md`
§3 are backed by a real, citable source (IRPWM or otherwise) — required
before the demo, since judges are expected to ask "why these numbers?"
(`docs/demo_plan.md` §5).

**Status as of Aug 22: not yet sourced.** This is a stub. Nothing below
is invented — sections are left blank rather than filled with a
plausible-looking number, per team rule ("never invent").

## 1. Current thresholds (as implemented)

| Parameter    | Warning | Critical | Source |
|--------------|---------|----------|--------|
| gauge        | 5       | 9        | *not yet cited* |
| alignment    | 5       | 10       | *not yet cited* |
| twist        | 4       | 7        | *not yet cited* |
| unevenness   | 8       | 13       | *not yet cited* |
| crossLevel   | 6       | 10       | *not yet cited* |
| railWear     | 8       | 12       | *not yet cited* |

These values are currently only known to be **hardcoded and consistent**
across the frontend (`src/lib/trackDataService.js` /
`RailTrackDashboard.jsx`) — that consistency has been verified. Whether
they're numerically correct against a real standard has not been
verified by anyone on the team yet.

## 2. What's needed (Person 4 owns this)

- [ ] Confirm whether IRPWM (Indian Railways Permanent Way Manual) is
      the intended source, or a different official standard.
- [ ] Pull the actual clause/table reference per parameter, not just a
      round number that looks plausible.
- [ ] Confirm whether thresholds vary by track class / speed class, and
      if so, which class the prototype's thresholds correspond to.
- [ ] Update the table above with real citations once sourced. If a
      sourced value differs from what's currently hardcoded, that's a
      **locked contract change** — must be flagged to the whole team
      per `docs/data_format.md` §3, not changed silently.

## 3. If sourcing isn't possible before the demo

Say so plainly rather than presenting the numbers as officially
sourced. Honest framing per `docs/demo_plan.md` §5: these are
representative/illustrative threshold values for prototype purposes,
pending formal validation — not yet confirmed against IRPWM or another
standard.
