import { useAuth } from "../lib/AuthContext";
import { hasPermission, PERMISSIONS } from "../lib/roles";
import { getAuditLog, getAuditFile } from "../lib/auditLog";

function downloadAuditFile(entryId) {
  const file = getAuditFile(entryId);
  if (!file) return;
  const blob = new Blob([file.text], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.filename || "audit-file.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function AuditLogPanel() {
  const { user } = useAuth();
  if (!hasPermission(user.role, PERMISSIONS.VIEW_AUDIT_LOG)) {
    return (
      <p className="text-sm text-gray-400 p-4">
        Not authorized to view the audit log. Switch to the Auditor role to preview this panel.
      </p>
    );
  }
  const entries = [...getAuditLog()].reverse();
  return (
    <div className="p-4">
      <h2 className="text-sm font-semibold mb-3 text-gray-200">
        Audit Log ({entries.length} entries)
      </h2>
      {entries.length === 0 ? (
        <p className="text-xs text-gray-500">
          No events logged yet. Try editing a threshold or closing an alert
          (as a role permitted to do so) to generate entries.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-400">
                <th className="pr-3 py-1">Time</th>
                <th className="pr-3">Actor</th>
                <th className="pr-3">Role</th>
                <th className="pr-3">Action</th>
                <th className="pr-3">Target</th>
                <th className="pr-3">Before → After</th>
                <th className="pr-3">Reason</th>
                <th>File</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const file = e.action === "CERTIFY_DATA" ? getAuditFile(e.id) : null;
                return (
                  <tr key={e.id} className="border-t border-gray-700 text-gray-200">
                    <td className="pr-3 py-1 whitespace-nowrap">
                      {new Date(e.timestamp).toLocaleString()}
                    </td>
                    <td className="pr-3">{e.actor}</td>
                    <td className="pr-3">{e.role}</td>
                    <td className="pr-3">{e.action}</td>
                    <td className="pr-3">{e.target}</td>
                    <td className="pr-3">
                      {JSON.stringify(e.before)} → {JSON.stringify(e.after)}
                    </td>
                    <td className="pr-3">{e.reason || "—"}</td>
                    <td>
                      {file ? (
                        <button
                          onClick={() => downloadAuditFile(e.id)}
                          className="underline text-blue-400 hover:text-blue-300"
                          title={file.truncated ? "File was truncated for storage — showing first ~2MB" : "Download the exact file that was certified"}
                        >
                          Download{file.truncated ? " (partial)" : ""}
                        </button>
                      ) : e.action === "CERTIFY_DATA" ? (
                        <span className="text-gray-500" title="File content wasn't stored (too large, or logged before this feature existed)">
                          unavailable
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
