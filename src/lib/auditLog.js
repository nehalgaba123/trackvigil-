/**
 * auditLog.js
 * Client-side audit trail -- TEMPORARY until backend exists. Structured
 * so the only change needed later is swapping the write target from
 * localStorage to `POST /audit-log`. Every entry is append-only from
 * the UI's perspective: there is no exported delete/edit function.
 */
const STORAGE_KEY = "trackvigil_audit_log_TEMP";

export function logAuditEvent({ actor, role, action, target, before, after, reason }) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    actor,
    role,
    action,
    target,
    before,
    after,
    reason: reason || null,
  };
  const existing = getAuditLog();
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...existing, entry]));
  return entry;
}

export function getAuditLog() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}
