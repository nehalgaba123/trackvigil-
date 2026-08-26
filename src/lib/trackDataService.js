/**
 * trackDataService.js
 * ---------------------------------------------------------------------------
 * Data-loading layer for TrackVigil, kept separate from the dashboard UI so
 * the source of data can be swapped later without touching any component.
 *
 * LOCKED SCHEMA (matches docs/data_format.md):
 *   chainage, date, parameter, value
 *
 * LOCKED PARAMETER NAMES (case-sensitive):
 *   gauge, alignment, twist, unevenness, crossLevel, railWear
 *
 * This file is the ONLY place that:
 *   - knows the locked long-format schema
 *   - generates the temporary sample/demo dataset
 *   - parses & validates uploaded CSV/JSON against that schema
 *   - converts long-format rows into the wide-format shape the existing
 *     dashboard components already consume ({ chainage, gauge, alignment, ... })
 *
 * Planned future replacement:
 *   loadFromApi() will eventually call the real backend:
 *     GET /tracks     -> current snapshot readings
 *     GET /alerts      -> threshold-based alerts
 *     GET /analytics    -> anomaly detection / statistical trend analysis results
 *     GET /priority      -> priority-ranked sections
 *   Nothing in the dashboard needs to change when that happens — only the
 *   function that RailTrackDashboard.jsx calls to populate `dataset` state.
 * ---------------------------------------------------------------------------
 */

export const LOCKED_COLUMNS = ["chainage", "date", "parameter", "value"];

export const PARAM_KEYS = ["gauge", "alignment", "twist", "unevenness", "crossLevel", "railWear"];

/* ---------------------------------------------------------------------------
 * Locked date format is ISO 8601 (YYYY-MM-DD), matching docs/data_format.md
 * and every date already in cleaned_data.csv. This is checked explicitly
 * during parsing (not just "is it non-empty") because:
 *   - pickCurrentDate() below relies on `new Date(dateStr)` to find the most
 *     recent pass, and non-ISO formats (e.g. DD-MM-YYYY) parse as Invalid
 *     Date / NaN in JS, silently producing zero readings for the WHOLE file
 *     rather than a normal per-row "malformed" count.
 *   - Catching it here means a bad date format shows up as an expected
 *     validation-panel count instead of a hard "could not parse this file"
 *     rejection with no explanation.
 * ------------------------------------------------------------------------- */
function isValidLockedDate(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const t = new Date(dateStr).getTime();
  return !Number.isNaN(t);
}

export const DEFAULT_THRESHOLDS = {
  gauge: { warning: 5, critical: 9 },
  alignment: { warning: 5, critical: 10 },
  twist: { warning: 4, critical: 7 },
  unevenness: { warning: 8, critical: 13 },
  crossLevel: { warning: 6, critical: 10 },
  railWear: { warning: 8, critical: 12 },
};

export const CHAINAGE_START = 0;
export const CHAINAGE_END = 60;
export const STEP = 0.1; // 100m resolution, sample dataset only

// Metadata for the sample dataset's deliberately-injected breach sections.
// Used only to label sample data (zone name, description) — the actual
// numeric values still come from parsing the generated CSV, not from here.
const SAMPLE_SECTIONS_META = [
  { id: "c1", param: "gauge", center: 12.4, width: 0.55, peakSeverity: "critical", label: "Gauge widening — curve exit", zone: "Sector A" },
  { id: "c2", param: "alignment", center: 27.8, width: 0.9, peakSeverity: "warning", label: "Alignment drift — embankment", zone: "Sector B" },
  { id: "c3", param: "crossLevel", center: 41.2, width: 0.4, peakSeverity: "critical", label: "Cross-level fault — level crossing", zone: "Sector C" },
  { id: "c4", param: "railWear", center: 8.1, width: 1.2, peakSeverity: "warning", label: "Rail wear zone — high-tonnage section", zone: "Sector D" },
  { id: "c5", param: "twist", center: 52.6, width: 0.5, peakSeverity: "critical", label: "Twist fault — sharp curve", zone: "Sector E" },
  { id: "c6", param: "unevenness", center: 35.0, width: 0.7, peakSeverity: "warning", label: "Unevenness patch — bridge approach", zone: "Sector F" },
];

const CURRENT_PASS_DATE = "2026-08-16";
const PARAM_SEED = { gauge: 0.4, alignment: 1.3, twist: 2.6, unevenness: 3.9, crossLevel: 5.2, railWear: 6.5 };

/* ---------------------------------------------------------------------------
 * Deterministic PRNG so the "sample dataset" looks the same every run
 * (development-only fallback — not used once a real backend is connected).
 * ------------------------------------------------------------------------- */
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------------------------------------------------------------------
 * TEMPORARY DEV FALLBACK: builds a CSV string in the locked long format.
 * This stands in for a real TRC export file. It also injects a handful of
 * deliberately malformed rows so the validation step below has something
 * real to catch (not simulated counters).
 * ------------------------------------------------------------------------- */
function buildSampleCsvText() {
  const rand = mulberry32(42);
  const rows = [LOCKED_COLUMNS.join(",")];

  // Current inspection pass: every chainage x every parameter.
  const n = Math.round((CHAINAGE_END - CHAINAGE_START) / STEP) + 1;
  for (let i = 0; i < n; i++) {
    const chainage = +(CHAINAGE_START + i * STEP).toFixed(1);
    PARAM_KEYS.forEach((param) => {
      const warn = DEFAULT_THRESHOLDS[param].warning;
      const crit = DEFAULT_THRESHOLDS[param].critical;
      let base = warn * 0.20 * (0.5 + 0.5 * Math.sin(chainage * 0.31 + PARAM_SEED[param] * 3)) + warn * 0.16 * rand();
      let bump = 0;
      SAMPLE_SECTIONS_META.filter((c) => c.param === param).forEach((c) => {
        const target = c.peakSeverity === "critical" ? crit * 1.18 : warn * 1.32;
        const g = Math.exp(-((chainage - c.center) ** 2) / (2 * c.width * c.width));
        bump += (target - base) * g;
      });
      const value = Math.max(0, +(base + bump).toFixed(2));
      rows.push(`${chainage},${CURRENT_PASS_DATE},${param},${value}`);
    });
  }

  // Historical passes for the six flagged sections, used by Trend Projection.
  const histRand = mulberry32(99);
  SAMPLE_SECTIONS_META.forEach((section) => {
    const warn = DEFAULT_THRESHOLDS[section.param].warning;
    const crit = DEFAULT_THRESHOLDS[section.param].critical;
    const target = section.peakSeverity === "critical" ? crit * 1.18 : warn * 1.32;
    const growth = target * 0.085;
    for (let m = -7; m <= -1; m++) {
      const value = Math.max(0, target + growth * m + (histRand() - 0.5) * target * 0.1);
      const d = new Date(2026, 7 + m, 1);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
      rows.push(`${section.center},${dateStr},${section.param},${value.toFixed(2)}`);
    }
  });

  // Deliberately malformed rows — simulates dirty real-world TRC exports.
  rows.push(`14.2,${CURRENT_PASS_DATE},guage,4.1`); // unknown parameter (typo)
  rows.push(`,${CURRENT_PASS_DATE},twist,2.0`); // missing chainage
  rows.push(`22.0,,alignment,3.3`); // missing date
  rows.push(`31.5,${CURRENT_PASS_DATE},railWear,not_a_number`); // non-numeric value
  rows.push(`45.0,${CURRENT_PASS_DATE},crossLevel`); // missing value column
  rows.push(`9.9,${CURRENT_PASS_DATE},unevenness,`); // empty value
  rows.push(`bad_chainage,${CURRENT_PASS_DATE},gauge,2.2`); // non-numeric chainage

  return rows.join("\n");
}

/* ---------------------------------------------------------------------------
 * Validates & parses text in the locked long format (CSV).
 * Kept intentionally simple per project scope — structural checks only.
 * ------------------------------------------------------------------------- */
export function parseLockedCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const dataLines = lines.slice(1); // skip header
  const valid = [];
  const invalid = [];

  dataLines.forEach((line, i) => {
    if (!line.trim()) return;
    const cols = line.split(",").map((c) => c.trim());
    const rowNum = i + 2;

    if (cols.length < 4) {
      invalid.push({ row: rowNum, raw: line, reason: "missing column(s)" });
      return;
    }
    const [chainageRaw, dateRaw, paramRaw, valueRaw] = cols;
    const chainage = Number(chainageRaw);
    const value = Number(valueRaw);

    if (chainageRaw === "" || Number.isNaN(chainage)) {
      invalid.push({ row: rowNum, raw: line, reason: "invalid chainage" });
      return;
    }
    if (!dateRaw) {
      invalid.push({ row: rowNum, raw: line, reason: "missing date" });
      return;
    }
    if (!isValidLockedDate(dateRaw)) {
      invalid.push({ row: rowNum, raw: line, reason: `invalid date "${dateRaw}" — expected YYYY-MM-DD` });
      return;
    }
    if (!PARAM_KEYS.includes(paramRaw)) {
      invalid.push({ row: rowNum, raw: line, reason: `unknown parameter "${paramRaw}"` });
      return;
    }
    if (valueRaw === "" || Number.isNaN(value)) {
      invalid.push({ row: rowNum, raw: line, reason: "non-numeric value" });
      return;
    }
    valid.push({ chainage, date: dateRaw, parameter: paramRaw, value });
  });

  return { valid, invalid, total: valid.length + invalid.length };
}

/* ---------------------------------------------------------------------------
 * Parses uploaded JSON (array of { chainage, date, parameter, value }).
 * ------------------------------------------------------------------------- */
export function parseLockedJson(text) {
  let arr;
  try {
    arr = JSON.parse(text);
  } catch {
    return { valid: [], invalid: [{ row: 0, raw: text.slice(0, 80), reason: "invalid JSON" }], total: 1 };
  }
  if (!Array.isArray(arr)) {
    return { valid: [], invalid: [{ row: 0, raw: "", reason: "JSON root must be an array of rows" }], total: 1 };
  }
  const valid = [];
  const invalid = [];
  arr.forEach((row, i) => {
    const rowNum = i + 1;
    const chainage = Number(row?.chainage);
    const value = Number(row?.value);
    if (row?.chainage === undefined || row?.chainage === "" || Number.isNaN(chainage)) {
      invalid.push({ row: rowNum, raw: JSON.stringify(row), reason: "invalid chainage" });
      return;
    }
    if (!row?.date) {
      invalid.push({ row: rowNum, raw: JSON.stringify(row), reason: "missing date" });
      return;
    }
    if (!isValidLockedDate(row.date)) {
      invalid.push({ row: rowNum, raw: JSON.stringify(row), reason: `invalid date "${row.date}" — expected YYYY-MM-DD` });
      return;
    }
    if (!PARAM_KEYS.includes(row?.parameter)) {
      invalid.push({ row: rowNum, raw: JSON.stringify(row), reason: `unknown parameter "${row?.parameter}"` });
      return;
    }
    if (row?.value === undefined || row?.value === "" || Number.isNaN(value)) {
      invalid.push({ row: rowNum, raw: JSON.stringify(row), reason: "non-numeric value" });
      return;
    }
    valid.push({ chainage, date: row.date, parameter: row.parameter, value });
  });
  return { valid, invalid, total: valid.length + invalid.length };
}

/* ---------------------------------------------------------------------------
 * Converts validated long-format rows into the wide-format shape the
 * existing dashboard components expect:
 *   { chainage, gauge, alignment, twist, unevenness, crossLevel, railWear }
 * Uses the most frequent date in the rows as the "current" inspection pass —
 * any rows on other dates are treated as historical (used for trend only).
 * ------------------------------------------------------------------------- */
function pickCurrentDate(validRows) {
  // "Current snapshot" must mean the most RECENT inspection pass, not
  // whichever date happens to have the most rows. Picking by row-count was
  // silently choosing arbitrary (often the earliest, healthiest) dates on
  // scale-test files where a monthly pass is split across several days —
  // producing a "0 alerts" dashboard even on data with real breaches later
  // in the timeline. See docs/data_format.md for the locked snapshot rule.
  let best = null, bestTime = -Infinity;
  validRows.forEach((r) => {
    const t = new Date(r.date).getTime();
    if (!Number.isNaN(t) && t > bestTime) { bestTime = t; best = r.date; }
  });
  return best;
}

export function longToWide(validRows) {
  if (validRows.length === 0) return { readings: [], currentDate: null };
  const currentDate = pickCurrentDate(validRows);
  const byChainage = new Map();
  validRows
    .filter((r) => r.date === currentDate)
    .forEach((r) => {
      if (!byChainage.has(r.chainage)) byChainage.set(r.chainage, { chainage: r.chainage });
      byChainage.get(r.chainage)[r.parameter] = r.value;
    });
  const readings = Array.from(byChainage.values())
    .map((r) => {
      const full = { chainage: r.chainage };
      PARAM_KEYS.forEach((p) => { full[p] = p in r ? r[p] : 0; });
      return full;
    })
    .sort((a, b) => a.chainage - b.chainage);
  return { readings, currentDate };
}

/* ---------------------------------------------------------------------------
 * Groups historical (non-current-date) rows into per-section monthly
 * history for the Trend Projection view. Falls back gracefully to an
 * empty array if the dataset has no historical passes (e.g. a real single
 * inspection upload) — TrendView/ReportView handle that case explicitly.
 * ------------------------------------------------------------------------- */
export function buildTrendSections(validRows, currentDate, wideReadings) {
  const historical = validRows.filter((r) => r.date !== currentDate);
  const sections = [];

  SAMPLE_SECTIONS_META.forEach((meta) => {
    const rows = historical
      .filter((r) => r.parameter === meta.param && Math.abs(r.chainage - meta.center) < 0.05)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    if (rows.length === 0) return;

    const history = rows.map((r, idx) => {
      const d = new Date(r.date);
      return { m: idx - (rows.length - 1), label: d.toLocaleString("en-US", { month: "short" }), value: r.value };
    });

    // Keep the trend's latest point consistent with the current dashboard
    // snapshot at that exact chainage, if available.
    const currentReading = wideReadings.find((r) => Math.abs(r.chainage - meta.center) < STEP / 2);
    const current = currentReading ? currentReading[meta.param] : history[history.length - 1].value;
    history[history.length - 1] = { ...history[history.length - 1], value: current };

    sections.push({ ...meta, history, current });
  });

  return sections;
}

/* ---------------------------------------------------------------------------
 * PUBLIC: loadSampleDataset()
 * Temporary development fallback until the backend/API is connected.
 * Generates a synthetic locked-format CSV, then runs it through the SAME
 * validation/adapter pipeline a real upload would use — so the "rows
 * flagged as malformed" count on the Ingest screen is real, not simulated.
 * ------------------------------------------------------------------------- */
export function loadSampleDataset() {
  const csvText = buildSampleCsvText();
  const { valid, invalid, total } = parseLockedCsv(csvText);
  const { readings, currentDate } = longToWide(valid);
  const trendSections = buildTrendSections(valid, currentDate, readings);

  return {
    readings,
    trendSections,
    validation: { total, validCount: valid.length, invalidCount: invalid.length, invalidRows: invalid },
    meta: {
      source: "sample",
      label: "Sample / Demo Dataset",
      note: "Synthetic data generated for threshold-based monitoring demonstration — not live TRC data.",
      loadedAt: new Date().toISOString(),
    },
  };
}

/* ---------------------------------------------------------------------------
 * PUBLIC: loadFromUpload(text, filename)
 * Parses a real uploaded CSV/JSON file against the locked schema.
 * ------------------------------------------------------------------------- */
export function loadFromUpload(text, filename) {
  const isJson = filename?.toLowerCase().endsWith(".json");
  const { valid, invalid, total } = isJson ? parseLockedJson(text) : parseLockedCsv(text);
  const { readings, currentDate } = longToWide(valid);
  const trendSections = buildTrendSections(valid, currentDate, readings);

  return {
    readings,
    trendSections,
    validation: { total, validCount: valid.length, invalidCount: invalid.length, invalidRows: invalid },
    meta: {
      source: "upload",
      label: `Uploaded Dataset${filename ? ` (${filename})` : ""}`,
      note: "Anomaly detection and statistical trend analysis run against uploaded inspection data.",
      loadedAt: new Date().toISOString(),
    },
  };
}

/* ---------------------------------------------------------------------------
 * PUBLIC: loadFromApi()
 * Placeholder for the real backend integration. Intentionally throws until
 * Person 5's API (GET /tracks, /alerts, /analytics, /priority) is wired up.
 * When that happens, this is the only function that needs to change —
 * it should return the same { readings, trendSections, validation, meta }
 * shape as loadSampleDataset()/loadFromUpload() above so no dashboard
 * component needs to change.
 * ------------------------------------------------------------------------- */
export async function loadFromApi() {
  throw new Error(
    "Backend API not connected yet. Expected endpoints: GET /tracks, GET /alerts, GET /analytics, GET /priority. " +
    "Use loadSampleDataset() or file upload until this is wired up."
  );
}

