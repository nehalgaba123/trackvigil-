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

/* ---------------------------------------------------------------------------
 * Single shared severity classifier — the >= critical / >= warning / else ok
 * check used to be duplicated inline in buildSampleCsvText() and elsewhere.
 * Everything that needs a severity tier (Dashboard, alerts, Snapshot
 * Comparison) should call this instead of re-implementing the comparison.
 * ------------------------------------------------------------------------- */
export function classifySeverity(param, value, thresholds = DEFAULT_THRESHOLDS) {
  const t = thresholds[param];
  if (!t || value === undefined || value === null || Number.isNaN(value)) return null;
  if (value >= t.critical) return "critical";
  if (value >= t.warning) return "warning";
  return "ok";
}

/* ---------------------------------------------------------------------------
 * Distinct dates present in a set of validated long-format rows, sorted
 * ascending. Needed by Snapshot Comparison's two date pickers — nothing
 * before this exposed the dataset's available dates as a standalone list.
 * ------------------------------------------------------------------------- */
export function getAvailableDates(validRows) {
  return Array.from(new Set(validRows.map((r) => r.date))).sort();
}

/* ---------------------------------------------------------------------------
 * PUBLIC: computeSnapshotDiff(validRows, dateA, dateB, thresholds)
 * Track-wide diff between two dates: for every (chainage, parameter) that
 * has a reading on both dates, classify severity on each and report where
 * the TIER changed (ok/warning/critical crossing) — not raw value drift.
 * Reuses classifySeverity() rather than a third copy of the threshold check.
 * ------------------------------------------------------------------------- */
export function computeSnapshotDiff(validRows, dateA, dateB, thresholds = DEFAULT_THRESHOLDS) {
  const key = (c, p) => `${c}|${p}`;
  const atDate = new Map();
  validRows.forEach((r) => {
    if (r.date !== dateA && r.date !== dateB) return;
    const k = key(r.chainage, r.parameter);
    if (!atDate.has(k)) atDate.set(k, {});
    atDate.get(k)[r.date] = r.value;
  });

  const newlyCritical = [];
  const newlyWarning = [];
  const recovered = [];
  const unresolved = [];

  atDate.forEach((byDate, k) => {
    if (!(dateA in byDate) || !(dateB in byDate)) return; // needs both dates
    const [chainage, param] = k.split("|");
    const from = classifySeverity(param, byDate[dateA], thresholds);
    const to = classifySeverity(param, byDate[dateB], thresholds);
    if (!from || !to || from === to) {
      if (from === to && (from === "critical" || from === "warning")) {
        unresolved.push({ chainage: +chainage, param, from, to, valueA: byDate[dateA], valueB: byDate[dateB] });
      }
      return;
    }
    const entry = { chainage: +chainage, param, from, to, valueA: byDate[dateA], valueB: byDate[dateB] };
    const rank = { ok: 0, warning: 1, critical: 2 };
    if (rank[to] > rank[from]) {
      (to === "critical" ? newlyCritical : newlyWarning).push(entry);
    } else {
      recovered.push(entry);
    }
  });

  const byChainage = (a, b) => a.chainage - b.chainage;
  return {
    dateA,
    dateB,
    newlyCritical: newlyCritical.sort(byChainage),
    newlyWarning: newlyWarning.sort(byChainage),
    recovered: recovered.sort(byChainage),
    unresolved: unresolved.sort(byChainage),
  };
}

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
  const freq = new Map();
  validRows.forEach((r) => freq.set(r.date, (freq.get(r.date) || 0) + 1));
  let best = null, bestCount = -1;
  freq.forEach((count, date) => { if (count > bestCount) { best = date; bestCount = count; } });
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
 * RENAMED from buildTrendSections(). Logic is UNCHANGED — still specific to
 * the sample dataset's six hardcoded SAMPLE_SECTIONS_META coordinates.
 * Only used by loadSampleDataset() below.
 * ------------------------------------------------------------------------- */
export function buildTrendSectionsFromSample(validRows, currentDate, wideReadings) {
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
 * NEW: works with ANY valid uploaded dataset (locked schema, any chainages,
 * any of the six parameters). Groups historical readings by the ACTUAL
 * chainage + parameter combinations present in the data, rather than a
 * fixed sample coordinate list. A group only becomes a trend section once
 * it has 2+ distinct dates — a single date cannot show a trend.
 *
 * Ranked by severity (critical > warning > ok) then peak value, and capped
 * at maxSections so a large dataset doesn't try to render one card per
 * chainage-point-per-parameter. Produces the same
 * { history, current, param, center, peakSeverity, zone, label, id } shape
 * TrendView/ReportView already consume — no changes needed there.
 * ------------------------------------------------------------------------- */
export function buildTrendSectionsGeneric(validRows, currentDate, wideReadings, thresholds, maxSections = 24) {
  const historical = validRows.filter((r) => r.date !== currentDate);

  const groups = new Map(); // key: `${chainage}|${parameter}` -> rows[]
  historical.forEach((r) => {
    const key = `${r.chainage}|${r.parameter}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  });

  const candidates = [];
  groups.forEach((rows, key) => {
    const dates = new Set(rows.map((r) => r.date));
    if (dates.size < 2) return; // need 2+ distinct dates to show a trend

    const sorted = [...rows].sort((a, b) => new Date(a.date) - new Date(b.date));
    const [chainageStr, parameter] = key.split("|");
    const chainage = Number(chainageStr);

    const history = sorted.map((r, idx) => {
      const d = new Date(r.date);
      return {
        m: idx - (sorted.length - 1),
        label: d.toLocaleDateString("en-US", { month: "short", day: "2-digit" }),
        value: r.value,
      };
    });

    // Keep the trend's latest point consistent with the current dashboard
    // snapshot at that chainage, same convention as the sample-path function.
    const currentReading = wideReadings.find((r) => Math.abs(r.chainage - chainage) < STEP / 2);
    const current = currentReading ? currentReading[parameter] : history[history.length - 1].value;
    history[history.length - 1] = { ...history[history.length - 1], value: current };

    const t = thresholds[parameter];
    const peak = Math.max(...sorted.map((r) => r.value), current);
    const peakSeverity = peak >= t.critical ? "critical" : peak >= t.warning ? "warning" : "ok";

    candidates.push({
      id: `up-${key}`,
      param: parameter,
      center: chainage,
      peakSeverity,
      peak,
      label: `Historical trend — ${parameter}`,
      zone: `KM ${chainage.toFixed(1)}`,
      history,
      current,
    });
  });

  const rank = { critical: 2, warning: 1, ok: 0 };
  candidates.sort((a, b) => rank[b.peakSeverity] - rank[a.peakSeverity] || b.peak - a.peak);
  return candidates.slice(0, maxSections);
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
  const trendSections = buildTrendSectionsFromSample(valid, currentDate, readings);

  return {
    readings,
    trendSections,
    validRows: valid,
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
  const trendSections = buildTrendSectionsGeneric(valid, currentDate, readings, DEFAULT_THRESHOLDS);

  return {
    readings,
    trendSections,
    validRows: valid,
    validation: { total, validCount: valid.length, invalidCount: invalid.length, invalidRows: invalid },
    meta: {
      source: "upload",
      label: `Uploaded Dataset${filename ? ` (${filename})` : ""}`,
      note: "Anomaly detection and statistical trend analysis run against uploaded inspection data.",
      loadedAt: new Date().toISOString(),
      filename: filename || "upload.csv",
      rawText: text,
    },
  };
}

export const API_BASE_URL = "http://localhost:5001";

/* ---------------------------------------------------------------------------
 * Adapts the backend's GET /alerts payload into the exact
 * { id, param, sev, start, end, peak } shape AlertsPanel already consumes.
 * ------------------------------------------------------------------------- */
function normalizeApiAlerts(alertsJson) {
  const rawList = Array.isArray(alertsJson)
    ? alertsJson
    : Array.isArray(alertsJson?.alerts)
    ? alertsJson.alerts
    : null;
  if (!rawList) return null;

  const out = [];
  rawList.forEach((a, i) => {
    const param = a.param ?? a.parameter;
    const sev = a.sev ?? a.severity;
    const start = Number(a.start ?? a.startChainage ?? a.chainageStart ?? a.chainage);
    const end = Number(a.end ?? a.endChainage ?? a.chainageEnd ?? start);
    const peak = Number(a.peak ?? a.peakValue ?? a.value ?? a.max);

    if (!PARAM_KEYS.includes(param)) return;
    if (sev !== "critical" && sev !== "warning") return;
    if (Number.isNaN(start) || Number.isNaN(peak)) return;

    out.push({
      id: a.id ?? `api-${param}-${i}-${start}`,
      param,
      sev,
      start,
      end: Number.isNaN(end) ? start : end,
      peak,
    });
  });
  return out;
}

/* ---------------------------------------------------------------------------
 * PUBLIC: loadFromApi()
 * Calls the real backend (GET /tracks, GET /alerts). Reshapes the backend's
 * per-parameter history into the same { readings, trendSections, validation,
 * meta } shape as loadSampleDataset()/loadFromUpload(), plus an optional
 * `alerts` field used instead of recomputing thresholds client-side when
 * the backend already supplies them.
 * ------------------------------------------------------------------------- */
export async function loadFromApi(baseUrl = API_BASE_URL) {
  const [tracksRes, alertsRes] = await Promise.all([
    fetch(`${baseUrl}/tracks`),
    fetch(`${baseUrl}/alerts`).catch(() => null),
  ]);

  if (!tracksRes.ok) {
    throw new Error(`Backend GET /tracks failed (${tracksRes.status}). Is the server running on ${baseUrl}?`);
  }
  const tracksJson = await tracksRes.json();
  const tracks = Array.isArray(tracksJson?.tracks) ? tracksJson.tracks : [];

  if (tracks.length === 0) {
    throw new Error("Backend /tracks returned no data — the server may not have a processed dataset yet.");
  }

  const validRows = [];
  tracks.forEach((t) => {
    PARAM_KEYS.forEach((p) => {
      const paramData = t.parameters?.[p];
      (paramData?.history || []).forEach((h) => {
        const value = Number(h.value);
        if (h.date && !Number.isNaN(value)) {
          validRows.push({ chainage: t.chainage, date: h.date, parameter: p, value });
        }
      });
    });
  });

  // Build the current snapshot from each track's own `.current` field
  // (data_service.js already sets this to the latest chronological history
  // entry per parameter) rather than re-deriving "current" via most-
  // frequent-date — that heuristic breaks when every inspection pass has
  // equal row-count, which is the case for a real multi-date dataset.
  const readings = tracks
    .map((t) => {
      const row = { chainage: t.chainage };
      PARAM_KEYS.forEach((p) => { row[p] = t.parameters?.[p]?.current ?? 0; });
      return row;
    })
    .sort((a, b) => a.chainage - b.chainage);

  const currentDate = validRows.reduce(
    (max, r) => (max === null || r.date > max ? r.date : max),
    null
  );
  const trendSections = buildTrendSectionsGeneric(validRows, currentDate, readings, DEFAULT_THRESHOLDS);

  let alerts = null;
  if (alertsRes && alertsRes.ok) {
    try {
      alerts = normalizeApiAlerts(await alertsRes.json());
    } catch {
      alerts = null;
    }
  }

  return {
    readings,
    trendSections,
    validRows,
    alerts,
    validation: { total: validRows.length, validCount: validRows.length, invalidCount: 0, invalidRows: [] },
    meta: {
      source: "api",
      label: "Live Backend Data",
      note: `Connected to TrackVigil backend at ${baseUrl}.`,
      loadedAt: new Date().toISOString(),
    },
  };
}