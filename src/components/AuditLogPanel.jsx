import { useAuth } from "../lib/AuthContext";
import { hasPermission, PERMISSIONS } from "../lib/roles";
import { getAuditLog } from "../lib/auditLog";

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
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
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
                  <td>{e.reason || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
