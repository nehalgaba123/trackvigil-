/**
 * build-analytics-output.js
 * ---------------------------------------------------------------------------
 * PLACE THIS AT: backend/scripts/build-analytics-output.js
 *
 * This is a one-off / re-run-as-needed data-prep script, NOT an HTTP route
 * and NOT part of the served API. The existing backend has no ingestion
 * endpoint — it only ever reads two static locations from local disk:
 *   - data/processed/cleaned_data.csv        (read by services/data_service.js)
 *   - analytics/output/alerts.json           (read by services/analyticsService.js)
 *
 * This script reads the same cleaned_data.csv that data_service.js reads,
 * and derives alerts.json from its existing `alert` column (ok/warning/
 * critical) — it does NOT recompute severity from thresholds, it trusts the
 * ground-truth label already in the CSV. Output shape:
 *   { source: "uploaded", alerts: [ { id, param, sev, start, end, peak }, ... ] }
 * which is exactly the shape the frontend's normalizeApiAlerts() adapter in
 * trackDataService.js already expects, and exactly the shape AlertsPanel
 * already renders (a.param, a.sev, a.start, a.end, a.peak).
 *
 * This stands in for the analytics pipeline that would normally produce
 * this file (referred to in data_service.js's comments as "Person 4's
 * output directory") — that pipeline's code was not part of this
 * integration's scope, so nothing here changes any existing route,
 * controller, or service.
 *
 * Usage (from the backend/ directory, or adjust the require path):
 *   node scripts/build-analytics-output.js
 * ---------------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// Same relative resolution as data_service.js (backend/src/services/../../../)
// and analyticsService.js, just measured from backend/scripts/ instead.
const CSV_PATH = path.resolve(__dirname, '../../data/processed/cleaned_data.csv');
const OUTPUT_DIR = path.resolve(__dirname, '../../analytics/output');

function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`CSV not found at ${CSV_PATH}. Place cleaned_data.csv there first.`);
    process.exit(1);
  }

  const rows = [];
  fs.createReadStream(CSV_PATH)
    .pipe(csv())
    .on('data', (row) => {
      rows.push({
        chainage: parseFloat(row.chainage),
        date: row.date,
        parameter: row.parameter,
        value: parseFloat(row.value),
        alert: (row.alert || 'ok').trim(),
      });
    })
    .on('end', () => {
      // "Current" pass = the latest date present, same convention the
      // dashboard uses elsewhere for the live snapshot.
      const currentDate = rows.reduce(
        (max, r) => (max === null || r.date > max ? r.date : max),
        null
      );
      const currentRows = rows.filter((r) => r.date === currentDate);

      const alerts = buildAlertsFromLabels(currentRows);

      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
      const outPath = path.join(OUTPUT_DIR, 'alerts.json');
      fs.writeFileSync(outPath, JSON.stringify({ source: 'uploaded', alerts }, null, 2));
      console.log(`Wrote ${alerts.length} alerts to ${outPath} (current pass: ${currentDate})`);
    })
    .on('error', (err) => {
      console.error('Failed to read CSV:', err.message);
      process.exit(1);
    });
}

/**
 * Groups consecutive chainage points (sorted ascending, same 100m-step
 * convention as the rest of the app) per parameter that share the same
 * non-"ok" alert label into a single alert entry — the same "contiguous
 * run" idea as the frontend's computeAlerts() in RailTrackDashboard.jsx,
 * just driven by the CSV's own ground-truth label column instead of
 * re-deriving severity from thresholds.
 */
function buildAlertsFromLabels(currentRows) {
  const byParam = new Map();
  currentRows.forEach((r) => {
    if (!byParam.has(r.parameter)) byParam.set(r.parameter, []);
    byParam.get(r.parameter).push(r);
  });

  const alerts = [];
  byParam.forEach((paramRows, param) => {
    const sorted = [...paramRows].sort((a, b) => a.chainage - b.chainage);
    let run = null;
    sorted.forEach((r, idx) => {
      if (r.alert !== 'ok') {
        if (!run) {
          run = { param, start: r.chainage, end: r.chainage, peak: r.value, sev: r.alert };
        } else {
          run.end = r.chainage;
          if (r.value > run.peak) run.peak = r.value;
          if (r.alert === 'critical') run.sev = 'critical';
        }
      } else if (run) {
        alerts.push(run);
        run = null;
      }
      if (run && idx === sorted.length - 1) alerts.push(run);
    });
  });

  return alerts.map((a, i) => ({ ...a, id: `${a.param}-${i}-${a.start}` }));
}

main();
