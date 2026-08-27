import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from "recharts";
import {
  UploadCloud, LayoutDashboard, Search, TrendingUp, FileText, Settings, Train,
  AlertTriangle, CheckCircle2, XCircle, ChevronRight, SlidersHorizontal,
  MapPin, Clock, Filter, ArrowUpDown, X, RotateCcw, FileCheck2, Ruler, Waves,
  RefreshCw, Activity, ArrowLeftRight, TrendingDown, Radio, ChevronDown, Printer,
} from "lucide-react";
import {
  PARAM_KEYS, DEFAULT_THRESHOLDS, CHAINAGE_START, CHAINAGE_END, STEP,
  loadSampleDataset, loadFromUpload, loadFromApi,
  getAvailableDates, computeSnapshotDiff,
} from "./lib/trackDataService";
import { AuthProvider, useAuth } from "./lib/AuthContext";
import { ROLES, PERMISSIONS, hasPermission } from "./lib/roles";
import RoleGate from "./components/RoleGate";
import AuditLogPanel from "./components/AuditLogPanel";
import { logAuditEvent, saveAuditFile } from "./lib/auditLog";

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
   Locked schema (chainage/date/parameter/value) and the 6 parameter keys
   now live in ./lib/trackDataService.js — this file only owns UI-facing
   metadata (labels, icons, units) keyed off the same PARAM_KEYS.
   ============================================================================ */
const PARAM_META = {
  gauge: { label: "Gauge", short: "GAU", unit: "mm", nominal: 1676, icon: Ruler, desc: "Distance between rail faces (nominal 1676mm broad gauge)" },
  alignment: { label: "Alignment", short: "ALN", unit: "mm", nominal: 0, icon: Waves, desc: "Lateral deviation of rail from design line (versine)" },
  twist: { label: "Twist", short: "TWS", unit: "mm", nominal: 0, icon: RefreshCw, desc: "Rate of change of cross-level over a defined base" },
  unevenness: { label: "Unevenness", short: "UNV", unit: "mm", nominal: 0, icon: Activity, desc: "Vertical irregularity of the running surface" },
  crossLevel: { label: "Cross-Level", short: "XLV", unit: "mm", nominal: 0, icon: ArrowLeftRight, desc: "Relative height difference between the two rails" },
  railWear: { label: "Rail Wear", short: "WER", unit: "mm", nominal: 0, icon: TrendingDown, desc: "Vertical + lateral material loss on the rail head" },
};

/* ============================================================================
   PURE HELPERS (threshold-based monitoring / anomaly detection utilities)
   These operate on whatever readings array is loaded — sample or uploaded —
   so they are reused unchanged regardless of data source.
   ============================================================================ */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const fmt = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toFixed(d);

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
function AlertsPanel({ alerts, onSelect, focusChainage, closedAlerts, onCloseAlert }) {
  const { user } = useAuth();
  const [severityFilter, setSeverityFilter] = useState("all");
  const [sortBy, setSortBy] = useState("severity");

  const filtered = useMemo(() => {
    let list = alerts
      .filter((a) => !closedAlerts[a.id])
      .filter((a) => severityFilter === "all" || a.sev === severityFilter);
    if (sortBy === "chainage") list = [...list].sort((a, b) => a.start - b.start);
    else list = [...list].sort((a, b) => (a.sev === b.sev ? a.start - b.start : a.sev === "critical" ? -1 : 1));
    return list;
  }, [alerts, severityFilter, sortBy, closedAlerts]);

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
            <React.Fragment key={a.id}>
            <button
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
            <RoleGate permission={PERMISSIONS.CLOSE_ALERT}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const reason = window.prompt("Reason for closing this alert:");
                  if (!reason) return;
                  logAuditEvent({
                    actor: user.name, role: user.role, action: "close_alert",
                    target: `${a.param}@${fmt(a.start, 1)}-${fmt(a.end, 1)}`,
                    before: a.sev, after: "closed", reason,
                  });
                  onCloseAlert(a, reason);
                }}
                className="w-full text-[10px] uppercase font-semibold py-1 rounded mt-1"
                style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}
              >
                Close Alert
              </button>
            </RoleGate>
            </React.Fragment>
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
  const { user } = useAuth();
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
                      onChange={(e) => {
                        const before = t.warning;
                        const after = +e.target.value;
                        setThresholds((prev) => ({ ...prev, [p]: { ...prev[p], warning: after } }));
                        logAuditEvent({
                          actor: user.name, role: user.role, action: "edit_threshold",
                          target: `${p}.warning`, before, after,
                          reason: window.prompt("Reason for this threshold change (cite IRPWM ref if applicable):"),
                        });
                      }}
                      className="rounded px-2 py-1 text-sm outline-none"
                      style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.textPrimary, fontFamily: FONT_MONO }}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase font-semibold" style={{ color: C.critical }}>Critical</span>
                    <input
                      type="number" step="0.5" value={t.critical}
                      onChange={(e) => {
                        const before = t.critical;
                        const after = +e.target.value;
                        setThresholds((prev) => ({ ...prev, [p]: { ...prev[p], critical: after } }));
                        logAuditEvent({
                          actor: user.name, role: user.role, action: "edit_threshold",
                          target: `${p}.critical`, before, after,
                          reason: window.prompt("Reason for this threshold change (cite IRPWM ref if applicable):"),
                        });
                      }}
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
function UploadView({ onDatasetReady }) {
  const { user } = useAuth();
  const canUploadProduction = hasPermission(user.role, PERMISSIONS.UPLOAD_DATA);
  const [stage, setStage] = useState("idle"); // idle | dragging | processing | done | error
  const [counts, setCounts] = useState({ processed: 0, flagged: 0, accepted: 0 });
  const [result, setResult] = useState(null); // full { readings, trendSections, validation, meta }
  const [errorMsg, setErrorMsg] = useState("");
  const fileInputRef = useRef(null);

  const targets = result
    ? { total: result.validation.total, flagged: result.validation.invalidCount }
    : { total: 0, flagged: 0 };

  useEffect(() => {
    if (stage !== "processing" || !result) return;
    let processed = 0;
    const total = Math.max(targets.total, 1);
    const id = setInterval(() => {
      processed += Math.max(1, Math.ceil(total / 24));
      if (processed >= total) {
        processed = total;
        setCounts({ processed, flagged: targets.flagged, accepted: total - targets.flagged });
        clearInterval(id);
        setTimeout(() => setStage("done"), 400);
      } else {
        const flaggedSoFar = Math.round((processed / total) * targets.flagged);
        setCounts({ processed, flagged: flaggedSoFar, accepted: processed - flaggedSoFar });
      }
    }, 30);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, result]);

  const startWithResult = (loaded) => {
    setErrorMsg("");
    setResult(loaded);
    setCounts({ processed: 0, flagged: 0, accepted: 0 });
    setStage("processing");
  };

  const useSample = () => startWithResult(loadSampleDataset());

  const [apiLoading, setApiLoading] = useState(false);
  const [apiError, setApiError] = useState("");

  const useBackend = async () => {
    setErrorMsg("");
    setApiError("");
    setApiLoading(true);
    try {
      const loaded = await loadFromApi();
      setApiLoading(false);
      startWithResult(loaded);
    } catch (err) {
      setApiLoading(false);
      setApiError(err.message || "Could not reach the backend API.");
    }
  };

  const handleFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const loaded = loadFromUpload(String(e.target.result || ""), file.name);
        if (loaded.readings.length === 0) {
          setErrorMsg("No valid rows found in this file — check it matches chainage,date,parameter,value.");
          setStage("idle");
          return;
        }
        startWithResult(loaded);
      } catch (err) {
        setErrorMsg("Could not parse this file. Falling back to sample dataset is recommended.");
        setStage("idle");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="max-w-2xl mx-auto mt-10">
      <div className="text-center mb-6">
        <div className="text-xs uppercase font-semibold tracking-widest mb-1" style={{ color: C.accent, fontFamily: FONT_MONO }}>Ingest Pipeline</div>
        <h1 className="text-xl font-semibold" style={{ color: C.textPrimary }}>Upload Track Recording / Inspection Data</h1>
        <p className="text-sm mt-1" style={{ color: C.textSecondary }}>
          Locked format: <code style={{ fontFamily: FONT_MONO, color: C.accent }}>chainage,date,parameter,value</code> — parameter one of gauge, alignment, twist, unevenness, crossLevel, railWear.
        </p>
      </div>

      {(stage === "idle" || stage === "dragging") && (
        <div
          onDragOver={(e) => { if (canUploadProduction) { e.preventDefault(); setStage("dragging"); } }}
          onDragLeave={() => setStage("idle")}
          onDrop={(e) => { e.preventDefault(); if (!canUploadProduction) return; setStage("idle"); handleFile(e.dataTransfer.files?.[0]); }}
          className="rounded-lg border-2 border-dashed flex flex-col items-center justify-center py-14 transition-colors"
          style={{ borderColor: stage === "dragging" ? C.accent : C.border, background: stage === "dragging" ? C.accentBg : C.panel }}
        >
          <UploadCloud size={36} color={stage === "dragging" ? C.accent : C.textSecondary} />
          {canUploadProduction ? (
            <>
              <p className="mt-3 text-sm" style={{ color: C.textPrimary }}>Drag & drop a .csv or .json file here</p>
              <p className="text-xs mt-1" style={{ color: C.textDim }}>or</p>
              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 rounded text-sm font-semibold"
                  style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}
                >
                  Choose File
                </button>
                <button
                  onClick={useSample}
                  className="px-4 py-2 rounded text-sm font-semibold"
                  style={{ background: C.accent, color: "#0A1520" }}
                >
                  Use Sample Dataset
                </button>
                <button
                  onClick={useBackend}
                  disabled={apiLoading}
                  className="px-4 py-2 rounded text-sm font-semibold"
                  style={{ border: `1px solid ${C.accent}`, color: C.accent, opacity: apiLoading ? 0.6 : 1 }}
                >
                  {apiLoading ? "Connecting…" : "Connect to Backend"}
                </button>
              </div>
              <input
                ref={fileInputRef} type="file" accept=".csv,.json" className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
            </>
          ) : (
            <>
              <p className="mt-3 text-sm text-center max-w-xs" style={{ color: C.textPrimary }}>
                Only the Data &amp; Analytics Owner role can upload and certify production track data.
              </p>
              <p className="text-xs mt-1 text-center max-w-xs" style={{ color: C.textDim }}>
                Your role ({user.role.replace(/_/g, " ")}) can preview the app with the sample dataset instead.
              </p>
              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={useSample}
                  className="px-4 py-2 rounded text-sm font-semibold"
                  style={{ background: C.accent, color: "#0A1520" }}
                >
                  Use Sample Dataset
                </button>
                <button
                  onClick={useBackend}
                  disabled={apiLoading}
                  className="px-4 py-2 rounded text-sm font-semibold"
                  style={{ border: `1px solid ${C.accent}`, color: C.accent, opacity: apiLoading ? 0.6 : 1 }}
                >
                  {apiLoading ? "Connecting…" : "Connect to Backend"}
                </button>
              </div>
            </>
          )}
          {errorMsg && (
            <p className="text-xs mt-3 px-3 text-center" style={{ color: C.critical }}>{errorMsg}</p>
          )}
          {apiError && (
            <p className="text-xs mt-3 px-3 text-center" style={{ color: C.critical }}>{apiError}</p>
          )}
        </div>
      )}

      {stage === "processing" && (
        <Panel title="Validating Upload" icon={FileCheck2}>
          <div className="p-5 space-y-4">
            {[
              { label: "Rows processed", value: counts.processed, total: targets.total, color: C.accent },
              { label: "Rows flagged (malformed)", value: counts.flagged, total: Math.max(targets.flagged, 1), color: C.warning },
              { label: "Rows accepted", value: counts.accepted, total: Math.max(targets.total - targets.flagged, 1), color: C.ok },
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

      {stage === "done" && result && (
        <Panel title="Validation Complete" icon={CheckCircle2}>
          <div className="p-5">
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="rounded p-3 text-center" style={{ background: C.panelAlt, border: `1px solid ${C.border}` }}>
                <div className="text-xl font-semibold" style={{ color: C.textPrimary, fontFamily: FONT_MONO }}>{result.validation.total}</div>
                <div className="text-[10px] uppercase" style={{ color: C.textDim }}>Processed</div>
              </div>
              <div className="rounded p-3 text-center" style={{ background: C.warningBg, border: `1px solid ${C.border}` }}>
                <div className="text-xl font-semibold" style={{ color: C.warning, fontFamily: FONT_MONO }}>{result.validation.invalidCount}</div>
                <div className="text-[10px] uppercase" style={{ color: C.textDim }}>Malformed</div>
              </div>
              <div className="rounded p-3 text-center" style={{ background: C.okBg, border: `1px solid ${C.border}` }}>
                <div className="text-xl font-semibold" style={{ color: C.ok, fontFamily: FONT_MONO }}>{result.validation.validCount}</div>
                <div className="text-[10px] uppercase" style={{ color: C.textDim }}>Accepted</div>
              </div>
            </div>
            <div className="flex items-center gap-2 mb-3">
              <span
                className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded"
                style={{ background: C.accentBg, color: C.accent, fontFamily: FONT_MONO, letterSpacing: "0.04em" }}
              >
                {result.meta.label}
              </span>
            </div>
            <p className="text-xs mb-4" style={{ color: C.textSecondary }}>
              {result.readings.length} chainage points stored across 6 parameters. {result.meta.note}
            </p>
            <button
              onClick={() => {
                // Only real uploads are certification-worthy events; loading the
                // built-in sample/demo dataset doesn't touch production data and
                // isn't logged.
                if (result.meta.source !== "sample" && canUploadProduction) {
                  const entry = logAuditEvent({
                    actor: user.name,
                    role: user.role,
                    action: "CERTIFY_DATA",
                    target: result.meta.label || "uploaded dataset",
                    before: null,
                    after: {
                      rows: result.validation.total,
                      accepted: result.validation.validCount,
                      flagged: result.validation.invalidCount,
                    },
                    reason: `Certified as production dataset (${result.validation.validCount}/${result.validation.total} rows accepted).`,
                  });
                  const saveResult = saveAuditFile(entry.id, result.meta.filename, result.meta.rawText);
                  if (!saveResult.stored) {
                    console.warn(`Audit file storage failed for ${result.meta.filename}: ${saveResult.reason}`);
                    window.alert(
                      `Dataset certified and logged, but the file itself couldn't be attached to the audit entry ` +
                      `(${saveResult.reason}). This usually means browser storage is full from earlier test uploads — ` +
                      `the CERTIFY_DATA log entry with row counts is still recorded, just without a downloadable copy.`
                    );
                  } else if (saveResult.evicted) {
                    console.info(`Audit file store evicted older entries to make room for ${result.meta.filename}.`);
                  }
                }
                onDatasetReady(result);
              }}
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
function DashboardView({ readings, thresholds, focusChainage, setFocusChainage, alerts, clusters, closedAlerts, onCloseAlert }) {
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
          <AlertsPanel alerts={alerts} onSelect={setFocusChainage} focusChainage={focusChainage} closedAlerts={closedAlerts} onCloseAlert={onCloseAlert} />
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
function ReportView({ trendSections, alerts, thresholds, selectedId, setSelectedId }) {
  const section = trendSections.find((s) => s.id === selectedId) || trendSections[0];
  const meta = PARAM_META[section.param];
  const relatedAlerts = alerts.filter((a) => Math.abs(((a.start + a.end) / 2) - section.center) < 3);
  const status = section.peakSeverity;

  return (
    <div className="max-w-3xl mx-auto space-y-3">
      <Panel title="Select Section for Report" icon={FileText}>
        <div className="p-3 flex flex-wrap gap-2 no-print">
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

      <div id="printable-report" className="rounded-md border" style={{ background: C.panel, borderColor: C.border }}>
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

        <div className="px-5 py-4 border-t flex justify-end gap-2 no-print" style={{ borderColor: C.border }}>
          <button
            onClick={() => window.print && window.print()}
            className="flex items-center gap-2 px-4 py-2 rounded text-sm font-semibold"
            style={{ background: C.accent, color: "#0A1520" }}
          >
            <Printer size={14} /> Print / Save as PDF
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   ROOT APP
   ============================================================================ */
function NoDatasetState({ onGoToIngest }) {
  return (
    <div className="max-w-md mx-auto mt-16 text-center">
      <FileCheck2 size={28} color={C.textDim} className="mx-auto mb-3" />
      <p className="text-sm" style={{ color: C.textSecondary }}>No dataset loaded yet.</p>
      <p className="text-xs mt-1" style={{ color: C.textDim }}>Load the sample dataset or upload inspection data to view this screen.</p>
      <button
        onClick={onGoToIngest}
        className="mt-4 px-4 py-2 rounded text-sm font-semibold"
        style={{ background: C.accent, color: "#0A1520" }}
      >
        Go to Ingest
      </button>
    </div>
  );
}

function EmptyTrendState() {
  return (
    <div className="max-w-md mx-auto mt-16 text-center">
      <TrendingUp size={28} color={C.textDim} className="mx-auto mb-3" />
      <p className="text-sm" style={{ color: C.textSecondary }}>No historical readings in this dataset.</p>
      <p className="text-xs mt-1" style={{ color: C.textDim }}>Trend projection needs multiple dated passes per section. The sample dataset includes these — a single-pass upload won't.</p>
    </div>
  );
}

/* ============================================================================
   SNAPSHOT COMPARISON VIEW
   Track-wide diff between two dates in the dataset — separate from Trend
   Projection, which follows one section over time. This follows the whole
   60km between exactly two passes: what got worse, what recovered, what's
   still unresolved. Reuses computeSnapshotDiff() from trackDataService.js
   (which itself reuses classifySeverity(), not a new threshold check) and
   the same jumpToDashboard() every other view already uses for navigation.
   ============================================================================ */
const DIFF_GROUPS = [
  { key: "newlyCritical", label: "Newly critical", sevFor: () => "critical" },
  { key: "newlyWarning", label: "Newly warning", sevFor: () => "warning" },
  { key: "recovered", label: "Recovered", sevFor: () => "ok" },
  { key: "unresolved", label: "Unresolved (still flagged)", sevFor: (e) => e.to },
];

// A snapshot diff row and a closed alert are different kinds of "resolved" —
// this only tells you an engineer dismissed the alert, NOT that the value
// went down (that's what "Recovered" already means, from real data). Used to
// flag rows in Unresolved / Newly Critical / Newly Warning so it's visible
// when a spot is still bad in the data despite being marked closed.
function findClosedAlertAt(chainage, param, closedAlerts) {
  return Object.values(closedAlerts).find(
    (c) => c.param === param && chainage >= c.start - 1e-9 && chainage <= c.end + 1e-9
  );
}

function SnapshotComparisonView({ validRows, thresholds, onJump, closedAlerts = {} }) {
  const dates = useMemo(() => getAvailableDates(validRows), [validRows]);
  const [dateA, setDateA] = useState(dates[0] || "");
  const [dateB, setDateB] = useState(dates[dates.length - 1] || "");

  // Re-sync selected dates whenever the available date list changes (e.g. a
  // new file is uploaded). Without this, dateA/dateB keep whatever string
  // they were initialized with, which can silently stop matching any date
  // in a newly-loaded dataset and make every diff group render empty.
  useEffect(() => {
    if (dates.length === 0) return;
    setDateA((prev) => (dates.includes(prev) ? prev : dates[0]));
    setDateB((prev) => (dates.includes(prev) ? prev : dates[dates.length - 1]));
  }, [dates]);

  const diff = useMemo(() => {
    if (!dateA || !dateB || dateA === dateB) return null;
    return computeSnapshotDiff(validRows, dateA, dateB, thresholds);
  }, [validRows, dateA, dateB, thresholds]);

  if (dates.length < 2) {
    return (
      <div className="max-w-md mx-auto mt-16 text-center">
        <ArrowLeftRight size={28} color={C.textDim} className="mx-auto mb-3" />
        <p className="text-sm" style={{ color: C.textSecondary }}>Not enough dates to compare.</p>
        <p className="text-xs mt-1" style={{ color: C.textDim }}>Snapshot Comparison needs 2+ distinct dates in the dataset.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Panel title="Compare two dates" icon={ArrowLeftRight}>
        <div className="p-3 flex items-center gap-3">
          <select value={dateA} onChange={(e) => setDateA(e.target.value)}
            className="rounded px-2 py-1.5 text-sm outline-none"
            style={{ background: C.bgRaised, border: `1px solid ${C.border}`, color: C.textPrimary, fontFamily: FONT_MONO }}>
            {dates.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <span style={{ color: C.textDim }}>vs</span>
          <select value={dateB} onChange={(e) => setDateB(e.target.value)}
            className="rounded px-2 py-1.5 text-sm outline-none"
            style={{ background: C.bgRaised, border: `1px solid ${C.border}`, color: C.textPrimary, fontFamily: FONT_MONO }}>
            {dates.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          {dateA === dateB && (
            <span className="text-xs" style={{ color: C.textDim }}>Pick two different dates.</span>
          )}
        </div>
      </Panel>

      {diff && DIFF_GROUPS.map(({ key, label }) => (
        <Panel key={key} title={`${label} (${diff[key].length})`} icon={ArrowLeftRight}>
          {diff[key].length === 0 ? (
            <p className="px-3 py-4 text-xs" style={{ color: C.textDim }}>None.</p>
          ) : (
            <div className="max-h-[320px] overflow-y-auto">
              <table className="w-full text-sm">
                <tbody>
                  {diff[key].map((e, i) => {
                    const closed = key !== "recovered" ? findClosedAlertAt(e.chainage, e.param, closedAlerts) : null;
                    return (
                    <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td className="px-3 py-2" style={{ color: C.textPrimary }}>{e.param}</td>
                      <td className="px-3 py-2" style={{ color: C.textSecondary, fontFamily: FONT_MONO }}>KM {e.chainage}</td>
                      <td className="px-3 py-2"><Badge sev={e.from}>{e.from}</Badge></td>
                      <td className="px-3 py-2 text-center" style={{ color: C.textDim }}>→</td>
                      <td className="px-3 py-2"><Badge sev={e.to}>{e.to}</Badge></td>
                      <td className="px-3 py-2">
                        {closed && (
                          <span
                            className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded"
                            style={{ color: C.textSecondary, border: `1px solid ${C.border}` }}
                            title={`Closed by alert dismissal: "${closed.reason}". Data still shows this as ${e.to} — no new inspection pass has confirmed a fix.`}
                          >
                            Closed (unconfirmed)
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => onJump(e.chainage)}
                          className="text-xs px-2 py-1 rounded font-semibold"
                          style={{ color: C.accent, border: `1px solid ${C.accentDim}` }}>
                          View <ChevronRight size={11} className="inline" />
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      ))}
    </div>
  );
}

const NAV = [
  { id: "upload", label: "Ingest", icon: UploadCloud },
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "search", label: "Global Search", icon: Search },
  { id: "trend", label: "Trend Projection", icon: TrendingUp },
  { id: "snapshot", label: "Snapshot Comparison", icon: ArrowLeftRight },
  { id: "report", label: "Report", icon: FileText },
];

function DashboardInner() {
  const { user, switchRole } = useAuth();
  const [view, setView] = useState("upload");
  const [thresholds, setThresholds] = useState(DEFAULT_THRESHOLDS);
  const [showThresholds, setShowThresholds] = useState(false);
  const [focusChainage, setFocusChainage] = useState(0);
  const [selectedTrendId, setSelectedTrendId] = useState(null);
  const [toast, setToast] = useState(null);

  // dataset = { readings, trendSections, validation, meta } once loaded via
  // UploadView (sample or real file). Stays null until then — this is the
  // seam that gets swapped for loadFromApi() once the backend is connected.
  const [dataset, setDataset] = useState(null);
  const readings = dataset?.readings ?? [];
  const trendSections = dataset?.trendSections ?? [];
  const alerts = useMemo(() => (dataset ? (dataset.alerts ?? computeAlerts(readings, thresholds)) : []), [dataset, readings, thresholds]);

  // Closed alerts, keyed by alert id -> { param, start, end, sev, reason, closedAt }.
  // Lifted up here (rather than living inside AlertsPanel's own useState) so
  // switching tabs — which unmounts AlertsPanel — doesn't wipe the closures.
  // Persisted to localStorage so a page refresh doesn't lose them either.
  // Snapshot Comparison also reads this, so it can flag a still-critical spot
  // as "administratively closed" without pretending the track was repaired.
  const CLOSED_ALERTS_KEY = "trackvigil_closed_alerts";
  const [closedAlerts, setClosedAlerts] = useState(() => {
    try {
      const raw = localStorage.getItem(CLOSED_ALERTS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(CLOSED_ALERTS_KEY, JSON.stringify(closedAlerts));
    } catch {
      // storage unavailable (private browsing, quota) — closures just won't
      // survive a refresh; nothing else in the app depends on this succeeding.
    }
  }, [closedAlerts]);

  const closeAlert = (alert, reason) => {
    setClosedAlerts((prev) => ({
      ...prev,
      [alert.id]: { param: alert.param, start: alert.start, end: alert.end, sev: alert.sev, reason, closedAt: new Date().toISOString() },
    }));
  };

  const handleDatasetReady = (loaded) => {
    setDataset(loaded);
    const firstSection = loaded.trendSections[0];
    setFocusChainage(firstSection ? firstSection.center : (loaded.readings[0]?.chainage ?? 0));
    setSelectedTrendId(firstSection ? firstSection.id : null);
    setView("dashboard");
  };

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
          {/* TEMPORARY role switcher — replace with real login once backend auth exists */}
          <select
            value={user.role}
            onChange={(e) => switchRole(e.target.value)}
            className="w-full mb-2 text-xs rounded px-2 py-1"
            style={{ background: C.bgRaised, border: `1px solid ${C.border}`, color: C.textPrimary }}
          >
            {Object.values(ROLES).map((r) => (
              <option key={r} value={r}>{r.replace(/_/g, " ")}</option>
            ))}
          </select>
          <RoleGate permission={PERMISSIONS.EDIT_THRESHOLDS}>
            <button
              onClick={() => setShowThresholds(true)}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded text-sm font-medium justify-center md:justify-start"
              style={{ color: C.textSecondary }}
            >
              <SlidersHorizontal size={16} />
              <span className="hidden md:inline">Thresholds</span>
            </button>
          </RoleGate>
          <RoleGate permission={PERMISSIONS.VIEW_AUDIT_LOG}>
            <button
              onClick={() => setView("audit")}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded text-sm font-medium justify-center md:justify-start"
              style={{ color: C.textSecondary }}
            >
              <FileCheck2 size={16} />
              <span className="hidden md:inline">Audit Log</span>
            </button>
          </RoleGate>
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
            {dataset && (
              <span
                title={dataset.meta.note}
                className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded"
                style={{ color: C.accent, background: C.accentBg, fontFamily: FONT_MONO, letterSpacing: "0.04em" }}
              >
                {dataset.meta.source === "sample" ? "Sample / Demo Data" : "Uploaded Data"}
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

        <div className="flex-1 overflow-y-auto p-4 app-scroll-area">
          {view === "upload" && <UploadView onDatasetReady={handleDatasetReady} />}
          {view !== "upload" && !dataset && (
            <NoDatasetState onGoToIngest={() => setView("upload")} />
          )}
          {view === "dashboard" && dataset && (
            <DashboardView
              readings={readings} thresholds={thresholds}
              focusChainage={focusChainage} setFocusChainage={setFocusChainage}
              alerts={alerts} clusters={trendSections}
              closedAlerts={closedAlerts} onCloseAlert={closeAlert}
            />
          )}
          {view === "search" && dataset && <SearchView alerts={alerts} onJump={jumpToDashboard} />}
          {view === "snapshot" && dataset && (
            <SnapshotComparisonView validRows={dataset.validRows ?? []} thresholds={thresholds} onJump={jumpToDashboard} closedAlerts={closedAlerts} />
          )}
          {view === "trend" && dataset && (
            trendSections.length > 0 ? (
              <TrendView trendSections={trendSections} thresholds={thresholds} selectedId={selectedTrendId} setSelectedId={setSelectedTrendId} />
            ) : (
              <EmptyTrendState />
            )
          )}
          {view === "report" && dataset && (
            trendSections.length > 0 ? (
              <ReportView
                trendSections={trendSections} alerts={alerts} thresholds={thresholds}
                selectedId={selectedTrendId} setSelectedId={setSelectedTrendId}
              />
            ) : (
              <EmptyTrendState />
            )
          )}
          {view === "audit" && <AuditLogPanel />}
        </div>
      </div>

      <ThresholdsDrawer open={showThresholds} onClose={() => setShowThresholds(false)} thresholds={thresholds} setThresholds={setThresholds} />
      <Toast toast={toast} />
    </div>
  );
}

export default function RailTrackDashboard() {
  return (
    <AuthProvider>
      <DashboardInner />
    </AuthProvider>
  );
}
