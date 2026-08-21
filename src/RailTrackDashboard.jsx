import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from "recharts";
import {
  UploadCloud, LayoutDashboard, Search, TrendingUp, FileText, Settings, Train,
  AlertTriangle, CheckCircle2, XCircle, ChevronRight, SlidersHorizontal, Download,
  MapPin, Clock, Filter, ArrowUpDown, X, RotateCcw, FileCheck2, Ruler, Waves,
  RefreshCw, Activity, ArrowLeftRight, TrendingDown, Radio, ChevronDown, Printer,
} from "lucide-react";

/* ============================================================================
   DESIGN TOKENS
   ============================================================================ */
const C = {
  bg: "#12151A",
  bgRaised: "#171B21",
  panel: "#1A1F26",
  panelAlt: "#20262E",
  border: "#2A313A",
  borderLight: "#37404B",
  textPrimary: "#E7EBEF",
  textSecondary: "#8D96A1",
  textDim: "#5A6470",
  accent: "#3FA9F5",
  accentDim: "#1E4E6E",
  accentBg: "rgba(63,169,245,0.10)",
  ok: "#33B27C",
  okBg: "rgba(51,178,124,0.10)",
  warning: "#E0A324",
  warningBg: "rgba(224,163,36,0.12)",
  critical: "#E24A44",
  criticalBg: "rgba(226,74,68,0.14)",
};

const FONT_MONO = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace";
const FONT_SANS = "'IBM Plex Sans', -apple-system, 'Segoe UI', sans-serif";

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap');`;

/* ============================================================================
   DOMAIN CONSTANTS
   ============================================================================ */
const CHAINAGE_START = 0;
const CHAINAGE_END = 60;
const STEP = 0.1; // 100m resolution

const PARAM_META = {
  gauge: { label: "Gauge", short: "GAU", unit: "mm", nominal: 1676, icon: Ruler, desc: "Distance between rail faces (nominal 1676mm broad gauge)" },
  alignment: { label: "Alignment", short: "ALN", unit: "mm", nominal: 0, icon: Waves, desc: "Lateral deviation of rail from design line (versine)" },
  twist: { label: "Twist", short: "TWS", unit: "mm", nominal: 0, icon: RefreshCw, desc: "Rate of change of cross-level over a defined base" },
  unevenness: { label: "Unevenness", short: "UNV", unit: "mm", nominal: 0, icon: Activity, desc: "Vertical irregularity of the running surface" },
  crossLevel: { label: "Cross-Level", short: "XLV", unit: "mm", nominal: 0, icon: ArrowLeftRight, desc: "Relative height difference between the two rails" },
  railWear: { label: "Rail Wear", short: "WER", unit: "mm", nominal: 0, icon: TrendingDown, desc: "Vertical + lateral material loss on the rail head" },
};
const PARAM_KEYS = Object.keys(PARAM_META);
const PARAM_SEED = { gauge: 0.4, alignment: 1.3, twist: 2.6, unevenness: 3.9, crossLevel: 5.2, railWear: 6.5 };

const DEFAULT_THRESHOLDS = {
  gauge: { warning: 5, critical: 9 },
  alignment: { warning: 5, critical: 10 },
  twist: { warning: 4, critical: 7 },
  unevenness: { warning: 8, critical: 13 },
  crossLevel: { warning: 6, critical: 10 },
  railWear: { warning: 8, critical: 12 },
};

const CLUSTERS = [
  { id: "c1", param: "gauge", center: 12.4, width: 0.55, peakSeverity: "critical", label: "Gauge widening — curve exit", zone: "Sector A" },
  { id: "c2", param: "alignment", center: 27.8, width: 0.9, peakSeverity: "warning", label: "Alignment drift — embankment", zone: "Sector B" },
  { id: "c3", param: "crossLevel", center: 41.2, width: 0.4, peakSeverity: "critical", label: "Cross-level fault — level crossing", zone: "Sector C" },
  { id: "c4", param: "railWear", center: 8.1, width: 1.2, peakSeverity: "warning", label: "Rail wear zone — high-tonnage section", zone: "Sector D" },
  { id: "c5", param: "twist", center: 52.6, width: 0.5, peakSeverity: "critical", label: "Twist fault — sharp curve", zone: "Sector E" },
  { id: "c6", param: "unevenness", center: 35.0, width: 0.7, peakSeverity: "warning", label: "Unevenness patch — bridge approach", zone: "Sector F" },
];

/* ============================================================================
   PURE HELPERS
   ============================================================================ */
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const fmt = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toFixed(d);

function generateDataset() {
  const rand = mulberry32(42);
  const n = Math.round((CHAINAGE_END - CHAINAGE_START) / STEP) + 1;
  const points = [];
  for (let i = 0; i < n; i++) {
    const chainage = +(CHAINAGE_START + i * STEP).toFixed(1);
    const reading = { chainage };
    PARAM_KEYS.forEach((param) => {
      const warn = DEFAULT_THRESHOLDS[param].warning;
      const crit = DEFAULT_THRESHOLDS[param].critical;
      let base = warn * 0.20 * (0.5 + 0.5 * Math.sin(chainage * 0.31 + PARAM_SEED[param] * 3)) + warn * 0.16 * rand();
      let bump = 0;
      CLUSTERS.filter((c) => c.param === param).forEach((c) => {
        const target = c.peakSeverity === "critical" ? crit * 1.18 : warn * 1.32;
        const g = Math.exp(-((chainage - c.center) ** 2) / (2 * c.width * c.width));
        bump += (target - base) * g;
      });
      reading[param] = Math.max(0, +(base + bump).toFixed(2));
    });
    points.push(reading);
  }
  return points;
}

function getSeverity(param, value, thresholds) {
  const t = thresholds[param];
  if (value >= t.critical) return "critical";
  if (value >= t.warning) return "warning";
  return "ok";
}
function worstSeverity(reading, thresholds) {
  let worst = "ok";
  for (const p of PARAM_KEYS) {
    const s = getSeverity(p, reading[p], thresholds);
    if (s === "critical") return "critical";
    if (s === "warning") worst = "warning";
  }
  return worst;
}
function worstParam(reading, thresholds) {
  let worst = "ok", worstP = null, rank = { ok: 0, warning: 1, critical: 2 };
  for (const p of PARAM_KEYS) {
    const s = getSeverity(p, reading[p], thresholds);
    if (rank[s] > rank[worst]) { worst = s; worstP = p; }
  }
  return worstP;
}
function severityColor(s) {
  return s === "critical" ? C.critical : s === "warning" ? C.warning : C.ok;
}
function severityBg(s) {
  return s === "critical" ? C.criticalBg : s === "warning" ? C.warningBg : C.okBg;
}

function computeAlerts(readings, thresholds) {
  const alerts = [];
  PARAM_KEYS.forEach((param) => {
    let run = null;
    readings.forEach((r, idx) => {
      const sev = getSeverity(param, r[param], thresholds);
      if (sev !== "ok") {
        if (!run) run = { param, start: r.chainage, end: r.chainage, peak: r[param], sev };
        else {
          run.end = r.chainage;
          if (r[param] > run.peak) run.peak = r[param];
          if (sev === "critical") run.sev = "critical";
        }
      } else if (run) {
        alerts.push(run);
        run = null;
      }
      if (run && idx === readings.length - 1) alerts.push(run);
    });
  });
  return alerts
    .map((a, i) => ({ ...a, id: `${a.param}-${i}-${a.start}` }))
    .sort((a, b) => (a.sev === b.sev ? a.start - b.start : a.sev === "critical" ? -1 : 1));
}

function nearestReading(readings, chainage) {
  const idx = clamp(Math.round((chainage - CHAINAGE_START) / STEP), 0, readings.length - 1);
  return readings[idx];
}

function generateTrendHistories(readings) {
  const rand = mulberry32(99);
  const now = new Date(2026, 7, 1); // Aug 2026
  return CLUSTERS.map((c) => {
    const current = nearestReading(readings, c.center)[c.param];
    const growth = current * 0.085;
    const history = [];
    for (let m = -7; m <= 0; m++) {
      const value = Math.max(0, current + growth * m + (rand() - 0.5) * current * 0.10);
      const d = new Date(now.getFullYear(), now.getMonth() + m, 1);
      history.push({ m, label: d.toLocaleString("en-US", { month: "short" }), value: +value.toFixed(2) });
    }
    return { ...c, history, growth, current };
  });
}

function linearRegression(points) {
  const n = points.length;
  const sumX = points.reduce((s, p) => s + p.m, 0);
  const sumY = points.reduce((s, p) => s + p.value, 0);
  const sumXY = points.reduce((s, p) => s + p.m * p.value, 0);
  const sumXX = points.reduce((s, p) => s + p.m * p.m, 0);
  const denom = n * sumXX - sumX * sumX || 1e-6;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

/* ============================================================================
   SMALL UI PRIMITIVES
   ============================================================================ */
function SeverityIcon({ sev, size = 14 }) {
  if (sev === "critical") return <XCircle size={size} color={C.critical} />;
  if (sev === "warning") return <AlertTriangle size={size} color={C.warning} />;
  return <CheckCircle2 size={size} color={C.ok} />;
}

function Badge({ sev, children }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wide"
      style={{ background: severityBg(sev), color: severityColor(sev), fontFamily: FONT_MONO, letterSpacing: "0.04em" }}
    >
      {children}
    </span>
  );
}

function Panel({ title, icon: Icon, right, children, className = "" }) {
  return (
    <div className={`rounded-md border ${className}`} style={{ background: C.panel, borderColor: C.border }}>
      {title && (
        <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: C.border }}>
          <div className="flex items-center gap-2">
            {Icon && <Icon size={13} color={C.textSecondary} />}
            <span className="text-xs font-semibold uppercase" style={{ color: C.textSecondary, letterSpacing: "0.06em" }}>
              {title}
            </span>
          </div>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div
      className="fixed bottom-5 right-5 z-50 px-4 py-3 rounded-md border shadow-lg flex items-center gap-2"
      style={{ background: C.panelAlt, borderColor: C.accentDim, color: C.textPrimary, fontFamily: FONT_SANS }}
    >
      <FileCheck2 size={16} color={C.accent} />
      <span className="text-sm">{toast}</span>
    </div>
  );
}

/* ============================================================================
   CHAINAGE SCRUBBER (signature interaction)
   ============================================================================ */
function ChainageScrubber({ value, onChange, clusters }) {
  const trackRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const pct = ((value - CHAINAGE_START) / (CHAINAGE_END - CHAINAGE_START)) * 100;

  const updateFromEvent = useCallback((e) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const x = clamp(e.clientX - rect.left, 0, rect.width);
    const raw = CHAINAGE_START + (x / rect.width) * (CHAINAGE_END - CHAINAGE_START);
    onChange(+clamp(Math.round(raw / STEP) * STEP, CHAINAGE_START, CHAINAGE_END).toFixed(1));
  }, [onChange]);

  useEffect(() => {
    if (!dragging) return;
    const move = (e) => updateFromEvent(e);
    const up = () => setDragging(false);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [dragging, updateFromEvent]);

  const ticks = [];
  for (let k = 0; k <= CHAINAGE_END; k += 5) ticks.push(k);

  return (
    <div className="px-4 py-3">
      <div className="flex items-baseline justify-between mb-2">
        <div className="flex items-center gap-2">
          <Radio size={14} color={C.accent} />
          <span className="text-xs uppercase font-semibold" style={{ color: C.textSecondary, letterSpacing: "0.08em" }}>
            Chainage Position
          </span>
        </div>
        <div className="flex items-baseline gap-1" style={{ fontFamily: FONT_MONO }}>
          <span className="text-2xl font-semibold" style={{ color: C.accent }}>{fmt(value, 1)}</span>
          <span className="text-xs" style={{ color: C.textSecondary }}>km</span>
        </div>
      </div>
      <div
        ref={trackRef}
        className="relative h-8 rounded cursor-pointer select-none"
        style={{ background: C.bgRaised, border: `1px solid ${C.border}` }}
        onMouseDown={(e) => { setDragging(true); updateFromEvent(e); }}
      >
        {/* tick marks */}
        {ticks.map((t) => (
          <div key={t} className="absolute top-0 bottom-0 flex flex-col items-center" style={{ left: `${(t / CHAINAGE_END) * 100}%` }}>
            <div className="w-px h-full" style={{ background: C.border }} />
          </div>
        ))}
        {/* cluster markers */}
        {clusters.map((c) => (
          <div
            key={c.id}
            title={c.label}
            className="absolute bottom-0 w-1.5 h-1.5 rounded-full"
            style={{
              left: `calc(${((c.center - CHAINAGE_START) / (CHAINAGE_END - CHAINAGE_START)) * 100}% - 3px)`,
              bottom: 2,
              background: c.peakSeverity === "critical" ? C.critical : C.warning,
            }}
          />
        ))}
        {/* thumb */}
        <div
          className="absolute top-[-3px] bottom-[-3px] w-[3px] rounded pointer-events-none"
          style={{ left: `calc(${pct}% - 1.5px)`, background: C.accent, boxShadow: `0 0 8px ${C.accent}` }}
        />
        <div
          className="absolute rounded-full pointer-events-none"
          style={{
            left: `calc(${pct}% - 7px)`, top: "50%", transform: "translateY(-50%)",
            width: 14, height: 14, background: C.accent, border: `2px solid ${C.bg}`,
            boxShadow: `0 0 0 3px ${C.accentBg}`,
          }}
        />
      </div>
      <div className="flex justify-between mt-1">
        {ticks.map((t) => (
          <span key={t} className="text-[10px]" style={{ color: C.textDim, fontFamily: FONT_MONO }}>{t}</span>
        ))}
      </div>
    </div>
  );
}

/* ============================================================================
   HEATMAP STRIP
   ============================================================================ */
function HeatmapStrip({ readings, thresholds, focusChainage, onChange }) {
  const trackRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const blocks = useMemo(
    () => readings.map((r) => ({ chainage: r.chainage, sev: worstSeverity(r, thresholds) })),
    [readings, thresholds]
  );

  const updateFromEvent = useCallback((e) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const x = clamp(e.clientX - rect.left, 0, rect.width);
    const raw = CHAINAGE_START + (x / rect.width) * (CHAINAGE_END - CHAINAGE_START);
    onChange(+clamp(Math.round(raw / STEP) * STEP, CHAINAGE_START, CHAINAGE_END).toFixed(1));
  }, [onChange]);

  useEffect(() => {
    if (!dragging) return;
    const move = (e) => updateFromEvent(e);
    const up = () => setDragging(false);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [dragging, updateFromEvent]);

  const pct = ((focusChainage - CHAINAGE_START) / (CHAINAGE_END - CHAINAGE_START)) * 100;
  const counts = useMemo(() => {
    const c = { ok: 0, warning: 0, critical: 0 };
    blocks.forEach((b) => c[b.sev]++);
    return c;
  }, [blocks]);

  return (
    <Panel
      title="Track Heatmap Strip — 100m segments"
      icon={MapPin}
      right={
        <div className="flex items-center gap-3 text-[11px]" style={{ fontFamily: FONT_MONO }}>
          <span style={{ color: C.ok }}>{counts.ok} OK</span>
          <span style={{ color: C.warning }}>{counts.warning} WARN</span>
          <span style={{ color: C.critical }}>{counts.critical} CRIT</span>
        </div>
      }
    >
      <div className="p-3">
        <div
          ref={trackRef}
          className="relative h-10 rounded overflow-hidden cursor-pointer select-none flex"
          onMouseDown={(e) => { setDragging(true); updateFromEvent(e); }}
        >
          {blocks.map((b, i) => (
            <div key={i} style={{ flex: "1 0 auto", width: `${100 / blocks.length}%`, background: severityColor(b.sev) === C.ok ? "#1F3A2F" : severityColor(b.sev), opacity: b.sev === "ok" ? 0.55 : 0.9 }} />
          ))}
          <div
            className="absolute top-[-2px] bottom-[-2px] w-[2px] pointer-events-none"
            style={{ left: `calc(${pct}% - 1px)`, background: "#fff", boxShadow: `0 0 6px #fff` }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[10px]" style={{ color: C.textDim, fontFamily: FONT_MONO }}>KM {CHAINAGE_START}</span>
          <span className="text-[10px]" style={{ color: C.textDim, fontFamily: FONT_MONO }}>KM {CHAINAGE_END}</span>
        </div>
      </div>
    </Panel>
  );
}

/* ============================================================================
   MULTI-PARAMETER CHARTS
   ============================================================================ */
function ParamChart({ param, readings, thresholds, focusChainage, onChartClick }) {
  const meta = PARAM_META[param];
  const t = thresholds[param];
  const current = nearestReading(readings, focusChainage);
  const sev = getSeverity(param, current[param], thresholds);
  const Icon = meta.icon;

  return (
    <Panel className="overflow-hidden">
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <div className="flex items-center gap-1.5">
          <Icon size={12} color={C.textSecondary} />
          <span className="text-xs font-semibold" style={{ color: C.textPrimary, fontFamily: FONT_SANS }}>{meta.label}</span>
          <span className="text-[10px]" style={{ color: C.textDim }}>({meta.unit})</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold" style={{ color: severityColor(sev), fontFamily: FONT_MONO }}>
            {fmt(current[param], 1)}
          </span>
          <SeverityIcon sev={sev} size={12} />
        </div>
      </div>
      <div style={{ height: 130 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={readings}
            margin={{ top: 4, right: 10, left: -18, bottom: 0 }}
            onClick={(e) => { if (e && e.activeLabel != null) onChartClick(+e.activeLabel); }}
          >
            <CartesianGrid stroke={C.border} strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="chainage" tick={{ fontSize: 9, fill: C.textDim, fontFamily: FONT_MONO }} tickLine={false} axisLine={{ stroke: C.border }} interval={99} />
            <YAxis tick={{ fontSize: 9, fill: C.textDim, fontFamily: FONT_MONO }} tickLine={false} axisLine={false} width={30} />
            <Tooltip
              contentStyle={{ background: C.panelAlt, border: `1px solid ${C.border}`, borderRadius: 4, fontFamily: FONT_MONO, fontSize: 11 }}
              labelStyle={{ color: C.textSecondary }}
              formatter={(v) => [`${fmt(v, 2)} ${meta.unit}`, meta.label]}
              labelFormatter={(l) => `KM ${fmt(l, 1)}`}
            />
            <ReferenceLine y={t.warning} stroke={C.warning} strokeDasharray="3 3" strokeOpacity={0.7} />
            <ReferenceLine y={t.critical} stroke={C.critical} strokeDasharray="3 3" strokeOpacity={0.7} />
            <ReferenceLine x={focusChainage} stroke={C.accent} strokeWidth={1.5} />
            <Line type="monotone" dataKey={param} stroke={C.accent} strokeWidth={1.3} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

/* ============================================================================
   ALERTS PANEL
   ============================================================================ */
function AlertsPanel({ alerts, onSelect, focusChainage }) {
  const [severityFilter, setSeverityFilter] = useState("all");
  const [sortBy, setSortBy] = useState("severity");

  const filtered = useMemo(() => {
    let list = alerts.filter((a) => severityFilter === "all" || a.sev === severityFilter);
    if (sortBy === "chainage") list = [...list].sort((a, b) => a.start - b.start);
    else list = [...list].sort((a, b) => (a.sev === b.sev ? a.start - b.start : a.sev === "critical" ? -1 : 1));
    return list;
  }, [alerts, severityFilter, sortBy]);

  return (
    <Panel
      title={`Active Alerts (${filtered.length})`}
      icon={AlertTriangle}
      right={
        <div className="flex items-center gap-1">
          <button onClick={() => setSortBy(sortBy === "severity" ? "chainage" : "severity")} className="p-1 rounded hover:bg-white/5" title="Toggle sort">
            <ArrowUpDown size={12} color={C.textSecondary} />
          </button>
        </div>
      }
    >
      <div className="flex gap-1 px-2 pt-2">
        {["all", "critical", "warning"].map((s) => (
          <button
            key={s}
            onClick={() => setSeverityFilter(s)}
            className="px-2 py-0.5 rounded text-[10px] uppercase font-semibold"
            style={{
              fontFamily: FONT_MONO,
              background: severityFilter === s ? (s === "all" ? C.accentBg : severityBg(s)) : "transparent",
              color: severityFilter === s ? (s === "all" ? C.accent : severityColor(s)) : C.textDim,
              border: `1px solid ${severityFilter === s ? (s === "all" ? C.accent : severityColor(s)) : C.border}`,
            }}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="max-h-[420px] overflow-y-auto px-2 py-2 space-y-1.5">
        {filtered.length === 0 && (
          <div className="text-xs py-6 text-center" style={{ color: C.textDim }}>No alerts match this filter.</div>
        )}
        {filtered.map((a) => {
          const meta = PARAM_META[a.param];
          const mid = (a.start + a.end) / 2;
          const active = Math.abs(mid - focusChainage) < STEP;
          return (
            <button
              key={a.id}
              onClick={() => onSelect(mid)}
              className="w-full text-left rounded px-2.5 py-2 transition-colors"
              style={{
                background: active ? C.accentBg : C.panelAlt,
                border: `1px solid ${active ? C.accent : C.border}`,
              }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <SeverityIcon sev={a.sev} size={12} />
                  <span className="text-xs font-medium" style={{ color: C.textPrimary }}>{meta.label}</span>
                </div>
                <Badge sev={a.sev}>{a.sev}</Badge>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[11px]" style={{ color: C.textSecondary, fontFamily: FONT_MONO }}>
                  KM {fmt(a.start, 1)}–{fmt(a.end, 1)}
                </span>
                <span className="text-[11px]" style={{ color: severityColor(a.sev), fontFamily: FONT_MONO }}>
                  {fmt(a.peak, 1)}{meta.unit}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

/* ============================================================================
   SECTION DRILL-DOWN
   ============================================================================ */
function SectionDrillDown({ reading, thresholds }) {
  return (
    <Panel title={`Section Readout — KM ${fmt(reading.chainage, 1)}`} icon={Activity}>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 p-3">
        {PARAM_KEYS.map((p) => {
          const meta = PARAM_META[p];
          const t = thresholds[p];
          const val = reading[p];
          const sev = getSeverity(p, val, thresholds);
          const pctOfCrit = clamp((val / t.critical) * 100, 0, 100);
          const Icon = meta.icon;
          return (
            <div key={p} className="rounded p-2" style={{ background: C.panelAlt, border: `1px solid ${C.border}` }}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1">
                  <Icon size={11} color={C.textSecondary} />
                  <span className="text-[10px] uppercase font-semibold" style={{ color: C.textSecondary, letterSpacing: "0.04em" }}>{meta.short}</span>
                </div>
                <SeverityIcon sev={sev} size={11} />
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-lg font-semibold" style={{ color: severityColor(sev), fontFamily: FONT_MONO }}>{fmt(val, 2)}</span>
                <span className="text-[10px]" style={{ color: C.textDim }}>{meta.unit}</span>
              </div>
              <div className="h-1 rounded-full mt-1.5 overflow-hidden" style={{ background: C.border }}>
                <div className="h-full rounded-full" style={{ width: `${pctOfCrit}%`, background: severityColor(sev) }} />
              </div>
              <div className="text-[9px] mt-1" style={{ color: C.textDim, fontFamily: FONT_MONO }}>
                warn {t.warning} / crit {t.critical}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/* ============================================================================
   THRESHOLDS DRAWER (configurable thresholds — live)
   ============================================================================ */
function ThresholdsDrawer({ open, onClose, thresholds, setThresholds }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div
        className="w-full max-w-sm h-full overflow-y-auto"
        style={{ background: C.panel, borderLeft: `1px solid ${C.border}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: C.border }}>
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={15} color={C.accent} />
            <span className="text-sm font-semibold" style={{ color: C.textPrimary }}>Threshold Configuration</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/5"><X size={16} color={C.textSecondary} /></button>
        </div>
        <div className="p-4 space-y-4">
          <p className="text-xs" style={{ color: C.textSecondary }}>
            Adjust warning and critical limits per parameter. Charts, the heatmap, and alerts update immediately.
          </p>
          {PARAM_KEYS.map((p) => {
            const meta = PARAM_META[p];
            const t = thresholds[p];
            return (
              <div key={p} className="rounded p-3" style={{ background: C.panelAlt, border: `1px solid ${C.border}` }}>
                <div className="flex items-center gap-1.5 mb-2">
                  <meta.icon size={12} color={C.textSecondary} />
                  <span className="text-xs font-semibold" style={{ color: C.textPrimary }}>{meta.label}</span>
                  <span className="text-[10px]" style={{ color: C.textDim }}>({meta.unit})</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase font-semibold" style={{ color: C.warning }}>Warning</span>
                    <input
                      type="number" step="0.5" value={t.warning}
                      onChange={(e) => setThresholds((prev) => ({ ...prev, [p]: { ...prev[p], warning: +e.target.value } }))}
                      className="rounded px-2 py-1 text-sm outline-none"
                      style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.textPrimary, fontFamily: FONT_MONO }}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase font-semibold" style={{ color: C.critical }}>Critical</span>
                    <input
                      type="number" step="0.5" value={t.critical}
                      onChange={(e) => setThresholds((prev) => ({ ...prev, [p]: { ...prev[p], critical: +e.target.value } }))}
                      className="rounded px-2 py-1 text-sm outline-none"
                      style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.textPrimary, fontFamily: FONT_MONO }}
                    />
                  </label>
                </div>
              </div>
            );
          })}
          <button
            onClick={() => setThresholds(DEFAULT_THRESHOLDS)}
            className="w-full flex items-center justify-center gap-2 rounded py-2 text-xs font-semibold"
            style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}
          >
            <RotateCcw size={12} /> Reset to defaults
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   UPLOAD / INGEST VIEW
   ============================================================================ */
function UploadView({ onDone }) {
  const [stage, setStage] = useState("idle"); // idle | dragging | processing | done
  const [counts, setCounts] = useState({ processed: 0, flagged: 0, accepted: 0 });
  const targets = { total: 612, flagged: 7 };

  useEffect(() => {
    if (stage !== "processing") return;
    let processed = 0;
    const id = setInterval(() => {
      processed += Math.ceil(targets.total / 24);
      if (processed >= targets.total) {
        processed = targets.total;
        setCounts({ processed, flagged: targets.flagged, accepted: targets.total - targets.flagged });
        clearInterval(id);
        setTimeout(() => setStage("done"), 400);
      } else {
        const flaggedSoFar = Math.round((processed / targets.total) * targets.flagged);
        setCounts({ processed, flagged: flaggedSoFar, accepted: processed - flaggedSoFar });
      }
    }, 60);
    return () => clearInterval(id);
  }, [stage]);

  const start = () => { setCounts({ processed: 0, flagged: 0, accepted: 0 }); setStage("processing"); };

  return (
    <div className="max-w-2xl mx-auto mt-10">
      <div className="text-center mb-6">
        <div className="text-xs uppercase font-semibold tracking-widest mb-1" style={{ color: C.accent, fontFamily: FONT_MONO }}>Ingest Pipeline</div>
        <h1 className="text-xl font-semibold" style={{ color: C.textPrimary }}>Upload Track Recording / Inspection Data</h1>
        <p className="text-sm mt-1" style={{ color: C.textSecondary }}>CSV or JSON with gauge, alignment, twist, unevenness, cross-level, and rail wear readings per chainage.</p>
      </div>

      {(stage === "idle" || stage === "dragging") && (
        <div
          onDragOver={(e) => { e.preventDefault(); setStage("dragging"); }}
          onDragLeave={() => setStage("idle")}
          onDrop={(e) => { e.preventDefault(); start(); }}
          className="rounded-lg border-2 border-dashed flex flex-col items-center justify-center py-14 transition-colors"
          style={{ borderColor: stage === "dragging" ? C.accent : C.border, background: stage === "dragging" ? C.accentBg : C.panel }}
        >
          <UploadCloud size={36} color={stage === "dragging" ? C.accent : C.textSecondary} />
          <p className="mt-3 text-sm" style={{ color: C.textPrimary }}>Drag & drop a .csv or .json file here</p>
          <p className="text-xs mt-1" style={{ color: C.textDim }}>or</p>
          <button
            onClick={start}
            className="mt-3 px-4 py-2 rounded text-sm font-semibold"
            style={{ background: C.accent, color: "#0A1520" }}
          >
            Use Sample Dataset
          </button>
        </div>
      )}

      {stage === "processing" && (
        <Panel title="Validating Upload" icon={FileCheck2}>
          <div className="p-5 space-y-4">
            {[
              { label: "Rows processed", value: counts.processed, total: targets.total, color: C.accent },
              { label: "Rows flagged (malformed)", value: counts.flagged, total: targets.flagged, color: C.warning },
              { label: "Rows accepted", value: counts.accepted, total: targets.total - targets.flagged, color: C.ok },
            ].map((row) => (
              <div key={row.label}>
                <div className="flex justify-between text-xs mb-1">
                  <span style={{ color: C.textSecondary }}>{row.label}</span>
                  <span style={{ color: row.color, fontFamily: FONT_MONO }}>{row.value} / {row.total}</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: C.border }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${(row.value / row.total) * 100}%`, background: row.color }} />
                </div>
              </div>
            ))}
            <p className="text-[11px] pt-1" style={{ color: C.textDim }}>Upload → Validate → Store</p>
          </div>
        </Panel>
      )}

      {stage === "done" && (
        <Panel title="Validation Complete" icon={CheckCircle2}>
          <div className="p-5">
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="rounded p-3 text-center" style={{ background: C.panelAlt, border: `1px solid ${C.border}` }}>
                <div className="text-xl font-semibold" style={{ color: C.textPrimary, fontFamily: FONT_MONO }}>{targets.total}</div>
                <div className="text-[10px] uppercase" style={{ color: C.textDim }}>Processed</div>
              </div>
              <div className="rounded p-3 text-center" style={{ background: C.warningBg, border: `1px solid ${C.border}` }}>
                <div className="text-xl font-semibold" style={{ color: C.warning, fontFamily: FONT_MONO }}>{targets.flagged}</div>
                <div className="text-[10px] uppercase" style={{ color: C.textDim }}>Malformed</div>
              </div>
              <div className="rounded p-3 text-center" style={{ background: C.okBg, border: `1px solid ${C.border}` }}>
                <div className="text-xl font-semibold" style={{ color: C.ok, fontFamily: FONT_MONO }}>{targets.total - targets.flagged}</div>
                <div className="text-[10px] uppercase" style={{ color: C.textDim }}>Accepted</div>
              </div>
            </div>
            <p className="text-xs mb-4" style={{ color: C.textSecondary }}>
              60.0 km of chainage stored at 100m resolution across 6 parameters. Dataset ready for analysis.
            </p>
            <button
              onClick={onDone}
              className="w-full flex items-center justify-center gap-2 rounded py-2.5 text-sm font-semibold"
              style={{ background: C.accent, color: "#0A1520" }}
            >
              View Dashboard <ChevronRight size={15} />
            </button>
          </div>
        </Panel>
      )}
    </div>
  );
}

/* ============================================================================
   DASHBOARD VIEW
   ============================================================================ */
function DashboardView({ readings, thresholds, focusChainage, setFocusChainage, alerts, clusters }) {
  const reading = nearestReading(readings, focusChainage);
  return (
    <div className="space-y-3">
      <Panel><ChainageScrubber value={focusChainage} onChange={setFocusChainage} clusters={clusters} /></Panel>
      <HeatmapStrip readings={readings} thresholds={thresholds} focusChainage={focusChainage} onChange={setFocusChainage} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {PARAM_KEYS.map((p) => (
              <ParamChart key={p} param={p} readings={readings} thresholds={thresholds} focusChainage={focusChainage} onChartClick={setFocusChainage} />
            ))}
          </div>
          <SectionDrillDown reading={reading} thresholds={thresholds} />
        </div>
        <div>
          <AlertsPanel alerts={alerts} onSelect={setFocusChainage} focusChainage={focusChainage} />
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   GLOBAL SEARCH VIEW
   ============================================================================ */
function SearchView({ alerts, onJump }) {
  const [param, setParam] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [range, setRange] = useState([CHAINAGE_START, CHAINAGE_END]);

  const filtered = useMemo(() => {
    return alerts.filter((a) => {
      if (param !== "all" && a.param !== param) return false;
      if (severity !== "all" && a.sev !== severity) return false;
      if (a.start < range[0] || a.end > range[1]) return false;
      return true;
    }).sort((a, b) => (a.sev === b.sev ? a.start - b.start : a.sev === "critical" ? -1 : 1));
  }, [alerts, param, severity, range]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
      <Panel title="Filters" icon={Filter} className="h-fit">
        <div className="p-3 space-y-4">
          <div>
            <div className="text-[10px] uppercase font-semibold mb-1.5" style={{ color: C.textSecondary }}>Parameter</div>
            <select
              value={param} onChange={(e) => setParam(e.target.value)}
              className="w-full rounded px-2 py-1.5 text-sm outline-none"
              style={{ background: C.bgRaised, border: `1px solid ${C.border}`, color: C.textPrimary }}
            >
              <option value="all">All parameters</option>
              {PARAM_KEYS.map((p) => <option key={p} value={p}>{PARAM_META[p].label}</option>)}
            </select>
          </div>
          <div>
            <div className="text-[10px] uppercase font-semibold mb-1.5" style={{ color: C.textSecondary }}>Severity</div>
            <div className="flex gap-1.5">
              {["all", "warning", "critical"].map((s) => (
                <button
                  key={s} onClick={() => setSeverity(s)}
                  className="flex-1 px-2 py-1 rounded text-[11px] uppercase font-semibold"
                  style={{
                    background: severity === s ? (s === "all" ? C.accentBg : severityBg(s)) : "transparent",
                    color: severity === s ? (s === "all" ? C.accent : severityColor(s)) : C.textDim,
                    border: `1px solid ${severity === s ? (s === "all" ? C.accent : severityColor(s)) : C.border}`,
                  }}
                >{s}</button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase font-semibold mb-1.5" style={{ color: C.textSecondary }}>Chainage Range (km)</div>
            <div className="flex items-center gap-2">
              <input type="number" value={range[0]} min={0} max={range[1]} onChange={(e) => setRange([+e.target.value, range[1]])}
                className="w-full rounded px-2 py-1 text-sm outline-none" style={{ background: C.bgRaised, border: `1px solid ${C.border}`, color: C.textPrimary, fontFamily: FONT_MONO }} />
              <span style={{ color: C.textDim }}>–</span>
              <input type="number" value={range[1]} min={range[0]} max={CHAINAGE_END} onChange={(e) => setRange([range[0], +e.target.value])}
                className="w-full rounded px-2 py-1 text-sm outline-none" style={{ background: C.bgRaised, border: `1px solid ${C.border}`, color: C.textPrimary, fontFamily: FONT_MONO }} />
            </div>
          </div>
          <button
            onClick={() => { setParam("all"); setSeverity("all"); setRange([CHAINAGE_START, CHAINAGE_END]); }}
            className="w-full text-xs py-1.5 rounded" style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}
          >Clear filters</button>
        </div>
      </Panel>

      <div className="lg:col-span-3">
        <Panel title={`Results (${filtered.length})`} icon={Search}>
          <div className="max-h-[560px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left" style={{ borderBottom: `1px solid ${C.border}` }}>
                  {["Parameter", "Chainage", "Severity", "Peak Value", ""].map((h) => (
                    <th key={h} className="px-3 py-2 text-[10px] uppercase font-semibold" style={{ color: C.textDim }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => {
                  const meta = PARAM_META[a.param];
                  return (
                    <tr key={a.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <meta.icon size={12} color={C.textSecondary} />
                          <span style={{ color: C.textPrimary }}>{meta.label}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2" style={{ color: C.textSecondary, fontFamily: FONT_MONO }}>KM {fmt(a.start, 1)}–{fmt(a.end, 1)}</td>
                      <td className="px-3 py-2"><Badge sev={a.sev}>{a.sev}</Badge></td>
                      <td className="px-3 py-2" style={{ color: severityColor(a.sev), fontFamily: FONT_MONO }}>{fmt(a.peak, 1)} {meta.unit}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => onJump((a.start + a.end) / 2)}
                          className="text-xs px-2 py-1 rounded font-semibold"
                          style={{ color: C.accent, border: `1px solid ${C.accentDim}` }}
                        >View <ChevronRight size={11} className="inline" /></button>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-8 text-center text-xs" style={{ color: C.textDim }}>No flagged sections match these filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}

/* ============================================================================
   TREND PROJECTION VIEW
   ============================================================================ */
function TrendView({ trendSections, thresholds, selectedId, setSelectedId }) {
  const section = trendSections.find((s) => s.id === selectedId) || trendSections[0];
  const meta = PARAM_META[section.param];
  const t = thresholds[section.param];

  const { slope, intercept } = useMemo(() => linearRegression(section.history), [section]);

  const monthsToBreach = useMemo(() => {
    if (slope <= 0.001) return null;
    const m = (t.critical - intercept) / slope;
    return m > 0 ? m : 0;
  }, [slope, intercept, t.critical]);

  const projectionHorizon = 6;
  const chartData = useMemo(() => {
    const data = section.history.map((h) => ({ m: h.m, label: h.label, actual: h.value }));
    for (let m = 1; m <= projectionHorizon; m++) {
      const d = new Date(2026, 7 + m, 1);
      data.push({ m, label: d.toLocaleString("en-US", { month: "short" }), projected: +(intercept + slope * m).toFixed(2) });
    }
    // bridge point so lines connect visually at m=0
    data[section.history.length - 1].projected = data[section.history.length - 1].actual;
    return data;
  }, [section, slope, intercept]);

  const breachDate = useMemo(() => {
    if (monthsToBreach == null) return null;
    const d = new Date(2026, 7 + Math.ceil(monthsToBreach), 1);
    return d.toLocaleString("en-US", { month: "long", year: "numeric" });
  }, [monthsToBreach]);

  return (
    <div className="space-y-3">
      <Panel title="Select Section" icon={TrendingUp}>
        <div className="p-3 flex flex-wrap gap-2">
          {trendSections.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelectedId(s.id)}
              className="px-3 py-1.5 rounded text-xs font-medium flex items-center gap-1.5"
              style={{
                background: s.id === section.id ? C.accentBg : C.panelAlt,
                border: `1px solid ${s.id === section.id ? C.accent : C.border}`,
                color: s.id === section.id ? C.accent : C.textSecondary,
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: 99, background: s.peakSeverity === "critical" ? C.critical : C.warning, display: "inline-block" }} />
              {s.zone} · {PARAM_META[s.param].label}
            </button>
          ))}
        </div>
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2">
          <Panel title={`${section.zone} — ${meta.label} Trend (KM ${fmt(section.center, 1)})`} icon={Activity}>
            <div style={{ height: 300 }} className="p-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={C.border} strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: C.textDim, fontFamily: FONT_MONO }} tickLine={false} axisLine={{ stroke: C.border }} />
                  <YAxis tick={{ fontSize: 10, fill: C.textDim, fontFamily: FONT_MONO }} tickLine={false} axisLine={false} width={34} />
                  <Tooltip contentStyle={{ background: C.panelAlt, border: `1px solid ${C.border}`, borderRadius: 4, fontFamily: FONT_MONO, fontSize: 11 }} />
                  <ReferenceLine y={t.warning} stroke={C.warning} strokeDasharray="3 3" label={{ value: "WARN", position: "insideTopRight", fill: C.warning, fontSize: 9 }} />
                  <ReferenceLine y={t.critical} stroke={C.critical} strokeDasharray="3 3" label={{ value: "CRIT", position: "insideTopRight", fill: C.critical, fontSize: 9 }} />
                  <ReferenceLine x="Aug" stroke={C.textDim} strokeDasharray="2 2" label={{ value: "now", position: "insideTop", fill: C.textDim, fontSize: 9 }} />
                  <Line type="monotone" dataKey="actual" stroke={C.accent} strokeWidth={2} dot={{ r: 2.5, fill: C.accent }} isAnimationActive={false} name="Actual" />
                  <Line type="monotone" dataKey="projected" stroke={C.textSecondary} strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} name="Projected" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </div>
        <div className="space-y-3">
          <Panel title="Projection Summary" icon={Clock}>
            <div className="p-3 space-y-3">
              <div>
                <div className="text-[10px] uppercase" style={{ color: C.textDim }}>Current reading</div>
                <div className="text-lg font-semibold" style={{ color: C.textPrimary, fontFamily: FONT_MONO }}>{fmt(section.current, 2)} {meta.unit}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase" style={{ color: C.textDim }}>Monthly drift rate</div>
                <div className="text-sm font-semibold" style={{ color: slope > 0 ? C.warning : C.ok, fontFamily: FONT_MONO }}>
                  {slope >= 0 ? "+" : ""}{fmt(slope, 3)} {meta.unit}/mo
                </div>
              </div>
              <div className="pt-2 border-t" style={{ borderColor: C.border }}>
                {monthsToBreach == null ? (
                  <div className="flex items-start gap-2">
                    <CheckCircle2 size={15} color={C.ok} className="mt-0.5" />
                    <p className="text-xs" style={{ color: C.textSecondary }}>Trend is stable or improving — no critical breach projected at current rate.</p>
                  </div>
                ) : (
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={15} color={C.critical} className="mt-0.5" />
                    <p className="text-xs" style={{ color: C.textSecondary }}>
                      Projected to breach the critical threshold ({t.critical} {meta.unit}) by{" "}
                      <span style={{ color: C.critical, fontWeight: 600 }}>{breachDate}</span>, in approximately{" "}
                      <span style={{ color: C.critical, fontFamily: FONT_MONO }}>{fmt(monthsToBreach, 1)}</span> months.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   REPORT VIEW
   ============================================================================ */
function ReportView({ trendSections, alerts, thresholds, selectedId, setSelectedId, onExport }) {
  const section = trendSections.find((s) => s.id === selectedId) || trendSections[0];
  const meta = PARAM_META[section.param];
  const relatedAlerts = alerts.filter((a) => Math.abs(((a.start + a.end) / 2) - section.center) < 3);
  const status = section.peakSeverity;

  return (
    <div className="max-w-3xl mx-auto space-y-3">
      <Panel title="Select Section for Report" icon={FileText}>
        <div className="p-3 flex flex-wrap gap-2">
          {trendSections.map((s) => (
            <button
              key={s.id} onClick={() => setSelectedId(s.id)}
              className="px-3 py-1.5 rounded text-xs font-medium"
              style={{
                background: s.id === section.id ? C.accentBg : C.panelAlt,
                border: `1px solid ${s.id === section.id ? C.accent : C.border}`,
                color: s.id === section.id ? C.accent : C.textSecondary,
              }}
            >{s.zone}</button>
          ))}
        </div>
      </Panel>

      <div className="rounded-md border" style={{ background: C.panel, borderColor: C.border }}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: C.border }}>
          <div>
            <div className="text-[11px] uppercase font-semibold tracking-widest" style={{ color: C.accent, fontFamily: FONT_MONO }}>Inspection Report</div>
            <h2 className="text-lg font-semibold mt-0.5" style={{ color: C.textPrimary }}>{section.zone} · {section.label}</h2>
            <p className="text-xs mt-0.5" style={{ color: C.textSecondary, fontFamily: FONT_MONO }}>Chainage KM {fmt(section.center - 1.5, 1)} – {fmt(section.center + 1.5, 1)} · Generated {new Date(2026, 7, 16).toLocaleDateString("en-IN")}</p>
          </div>
          <Badge sev={status}>{status}</Badge>
        </div>

        <div className="p-5 space-y-5">
          <div>
            <div className="text-xs uppercase font-semibold mb-2" style={{ color: C.textSecondary }}>Active Alerts in Section</div>
            <div className="space-y-1.5">
              {relatedAlerts.length === 0 && <p className="text-xs" style={{ color: C.textDim }}>No active alerts recorded for this section.</p>}
              {relatedAlerts.map((a) => (
                <div key={a.id} className="flex items-center justify-between text-xs rounded px-2.5 py-1.5" style={{ background: C.panelAlt, border: `1px solid ${C.border}` }}>
                  <span style={{ color: C.textPrimary }}>{PARAM_META[a.param].label} — KM {fmt(a.start, 1)}–{fmt(a.end, 1)}</span>
                  <span style={{ color: severityColor(a.sev), fontFamily: FONT_MONO }}>{fmt(a.peak, 1)} {PARAM_META[a.param].unit}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs uppercase font-semibold mb-2" style={{ color: C.textSecondary }}>Trend Snapshot — {meta.label}</div>
            <div style={{ height: 150 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={section.history} margin={{ top: 4, right: 10, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke={C.border} strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: C.textDim, fontFamily: FONT_MONO }} tickLine={false} axisLine={{ stroke: C.border }} />
                  <YAxis tick={{ fontSize: 9, fill: C.textDim, fontFamily: FONT_MONO }} tickLine={false} axisLine={false} width={28} />
                  <ReferenceLine y={thresholds[section.param].critical} stroke={C.critical} strokeDasharray="3 3" />
                  <Line type="monotone" dataKey="value" stroke={C.accent} strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 pt-2 border-t" style={{ borderColor: C.border }}>
            <div>
              <div className="text-[10px] uppercase" style={{ color: C.textDim }}>Latest Reading</div>
              <div className="text-sm font-semibold" style={{ color: C.textPrimary, fontFamily: FONT_MONO }}>{fmt(section.current, 2)} {meta.unit}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase" style={{ color: C.textDim }}>Warning Limit</div>
              <div className="text-sm font-semibold" style={{ color: C.warning, fontFamily: FONT_MONO }}>{thresholds[section.param].warning} {meta.unit}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase" style={{ color: C.textDim }}>Critical Limit</div>
              <div className="text-sm font-semibold" style={{ color: C.critical, fontFamily: FONT_MONO }}>{thresholds[section.param].critical} {meta.unit}</div>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-t flex justify-end gap-2" style={{ borderColor: C.border }}>
          <button
            onClick={onExport}
            className="flex items-center gap-2 px-4 py-2 rounded text-sm font-semibold"
            style={{ background: C.accent, color: "#0A1520" }}
          >
            <Download size={14} /> Export PDF
          </button>
          <button
            onClick={() => window.print && window.print()}
            className="flex items-center gap-2 px-4 py-2 rounded text-sm font-semibold"
            style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}
          >
            <Printer size={14} /> Print
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   ROOT APP
   ============================================================================ */
const NAV = [
  { id: "upload", label: "Ingest", icon: UploadCloud },
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "search", label: "Global Search", icon: Search },
  { id: "trend", label: "Trend Projection", icon: TrendingUp },
  { id: "report", label: "Report", icon: FileText },
];

export default function RailTrackDashboard() {
  const [view, setView] = useState("upload");
  const [thresholds, setThresholds] = useState(DEFAULT_THRESHOLDS);
  const [showThresholds, setShowThresholds] = useState(false);
  const [focusChainage, setFocusChainage] = useState(12.4);
  const [selectedTrendId, setSelectedTrendId] = useState("c1");
  const [toast, setToast] = useState(null);

  const readings = useMemo(() => generateDataset(), []);
  const alerts = useMemo(() => computeAlerts(readings, thresholds), [readings, thresholds]);
  const trendSections = useMemo(() => generateTrendHistories(readings), [readings]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(id);
  }, [toast]);

  const jumpToDashboard = (chainage) => {
    setFocusChainage(chainage);
    setView("dashboard");
  };

  const activeAlertCount = alerts.filter((a) => a.sev === "critical").length;

  return (
    <div className="w-full h-full flex" style={{ background: C.bg, fontFamily: FONT_SANS, minHeight: 640 }}>
      <style>{`
        ${FONT_IMPORT}
        input[type=number]::-webkit-inner-spin-button { opacity: 0.6; }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-track { background: ${C.bg}; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 4px; }
      `}</style>

      {/* Sidebar */}
      <div className="w-16 md:w-52 flex flex-col border-r shrink-0" style={{ borderColor: C.border, background: C.bgRaised }}>
        <div className="flex items-center gap-2 px-3 md:px-4 h-14 border-b" style={{ borderColor: C.border }}>
          <div className="w-8 h-8 rounded flex items-center justify-center shrink-0" style={{ background: C.accentBg }}>
            <Train size={16} color={C.accent} />
          </div>
          <div className="hidden md:block leading-tight">
            <div className="text-sm font-semibold" style={{ color: C.textPrimary }}>TrackVigil</div>
            <div className="text-[10px]" style={{ color: C.textDim, fontFamily: FONT_MONO }}>SIH · Track Geometry</div>
          </div>
        </div>
        <nav className="flex-1 py-3 px-2 space-y-1">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => setView(n.id)}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded text-sm font-medium justify-center md:justify-start"
              style={{
                background: view === n.id ? C.accentBg : "transparent",
                color: view === n.id ? C.accent : C.textSecondary,
              }}
            >
              <n.icon size={16} />
              <span className="hidden md:inline">{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="p-2 border-t" style={{ borderColor: C.border }}>
          <button
            onClick={() => setShowThresholds(true)}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded text-sm font-medium justify-center md:justify-start"
            style={{ color: C.textSecondary }}
          >
            <SlidersHorizontal size={16} />
            <span className="hidden md:inline">Thresholds</span>
          </button>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="h-14 flex items-center justify-between px-4 border-b shrink-0" style={{ borderColor: C.border, background: C.bgRaised }}>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold" style={{ color: C.textPrimary }}>{NAV.find((n) => n.id === view)?.label || "TrackVigil"}</span>
            {view !== "upload" && (
              <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ color: C.textDim, background: C.panelAlt, fontFamily: FONT_MONO }}>
                KM {CHAINAGE_START}–{CHAINAGE_END} · Northern Division
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {activeAlertCount > 0 && (
              <div className="flex items-center gap-1.5 text-xs" style={{ color: C.critical }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: C.critical, boxShadow: `0 0 6px ${C.critical}` }} />
                {activeAlertCount} critical alerts
              </div>
            )}
            <div className="hidden sm:flex items-center gap-1.5 text-xs" style={{ color: C.textDim, fontFamily: FONT_MONO }}>
              <Clock size={12} /> Last sync 16 Aug 2026, 09:12 IST
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {view === "upload" && <UploadView onDone={() => setView("dashboard")} />}
          {view === "dashboard" && (
            <DashboardView
              readings={readings} thresholds={thresholds}
              focusChainage={focusChainage} setFocusChainage={setFocusChainage}
              alerts={alerts} clusters={CLUSTERS}
            />
          )}
          {view === "search" && <SearchView alerts={alerts} onJump={jumpToDashboard} />}
          {view === "trend" && (
            <TrendView trendSections={trendSections} thresholds={thresholds} selectedId={selectedTrendId} setSelectedId={setSelectedTrendId} />
          )}
          {view === "report" && (
            <ReportView
              trendSections={trendSections} alerts={alerts} thresholds={thresholds}
              selectedId={selectedTrendId} setSelectedId={setSelectedTrendId}
              onExport={() => setToast("Report generated — ready to download.")}
            />
          )}
        </div>
      </div>

      <ThresholdsDrawer open={showThresholds} onClose={() => setShowThresholds(false)} thresholds={thresholds} setThresholds={setThresholds} />
      <Toast toast={toast} />
    </div>
  );
}
