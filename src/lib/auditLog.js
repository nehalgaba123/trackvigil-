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

/**
 * Companion store for the raw content of files referenced by audit
 * entries (currently: uploaded/certified CSVs). Kept as a SEPARATE
 * localStorage key from the log itself so the log stays small and fast
 * to read even if a file is large or missing.
 *
 * Content is deduped by a lightweight hash: re-certifying the exact same
 * file (a common thing to do while testing) reuses the existing stored
 * copy instead of writing a new multi-MB duplicate every time.
 *
 * TEMPORARY, same caveat as the rest of this file: localStorage has a
 * ~5-10MB per-origin quota, so this only works for demo-scale files/
 * history. In the real backend, this should write the file to the same
 * object/blob storage the ingestion pipeline uses, and the audit entry
 * should store a reference (path or hash) instead of the full content.
 */
const FILES_STORAGE_KEY = "trackvigil_audit_files_TEMP";
const MAX_STORED_FILE_CHARS = 2_000_000; // ~2MB of text per file; keeps quota headroom

// Small, fast, non-cryptographic hash -- good enough for "is this the
// same content we already stored", not for security purposes.
function hashText(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = (h * 33) ^ text.charCodeAt(i);
  }
  return (h >>> 0).toString(36) + ":" + text.length;
}

export function saveAuditFile(entryId, filename, text) {
  if (!text) return { stored: false, reason: "no content" };
  const truncated = text.length > MAX_STORED_FILE_CHARS;
  const stored_text = truncated ? text.slice(0, MAX_STORED_FILE_CHARS) : text;
  const hash = hashText(stored_text);

  const attempt = () => {
    const store = getFilesStore();
    // Dedup: if this exact content is already stored under some other
    // entry, just point this entryId at it -- don't write it twice.
    if (!store.blobs[hash]) {
      store.blobs[hash] = { filename, text: stored_text, truncated, size: text.length };
    }
    store.index[entryId] = hash;
    localStorage.setItem(FILES_STORAGE_KEY, JSON.stringify(store));
  };

  try {
    attempt();
    return { stored: true, truncated, deduped: false };
  } catch (err) {
    // Likely QuotaExceededError. Evict the oldest-inserted blobs (by
    // insertion order in the object) one at a time and retry, instead of
    // silently giving up on the newest file the way the earlier version
    // did -- an audit trail that quietly drops recent entries under load
    // is worse than one that evicts old ones with a clear reason.
    try {
      const store = getFilesStore();
      const hashes = Object.keys(store.blobs);
      for (const oldHash of hashes) {
        delete store.blobs[oldHash];
        for (const [eid, h] of Object.entries(store.index)) {
          if (h === oldHash) delete store.index[eid];
        }
        try {
          store.blobs[hash] = { filename, text: stored_text, truncated, size: text.length };
          store.index[entryId] = hash;
          localStorage.setItem(FILES_STORAGE_KEY, JSON.stringify(store));
          return { stored: true, truncated, deduped: false, evicted: true };
        } catch {
          // still doesn't fit, evict another and loop
        }
      }
    } catch {
      // fall through to failure below
    }
    return { stored: false, reason: err?.message || "storage quota exceeded" };
  }
}

export function getAuditFile(entryId) {
  const store = getFilesStore();
  const hash = store.index[entryId];
  return hash ? store.blobs[hash] || null : null;
}

function getFilesStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(FILES_STORAGE_KEY) || "null");
    if (raw && raw.blobs && raw.index) return raw;
  } catch {
    // fall through to fresh store
  }
  return { blobs: {}, index: {} };
}
