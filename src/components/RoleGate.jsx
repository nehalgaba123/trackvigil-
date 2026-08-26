import { useAuth } from "../lib/AuthContext";
import { hasPermission } from "../lib/roles";

/**
 * Wrap any UI that requires a permission. Renders `fallback` (default:
 * nothing) if the current role doesn't have that permission.
 *
 * NOTE: this alone is not a security boundary -- it's UI hygiene only.
 * Once a backend exists, every action gated here must ALSO be checked
 * server-side (see rbac.js middleware spec in docs), because a user can
 * always bypass client-side JS.
 */
export default function RoleGate({ permission, children, fallback = null }) {
  const { user } = useAuth();
  return hasPermission(user.role, permission) ? children : fallback;
}
