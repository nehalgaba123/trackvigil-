/**
 * roles.js — Separation of Duties definitions for TrackVigil.
 * Single source of truth for role -> permission mapping. Backend must
 * mirror this exact matrix once auth is server-side (see backend spec
 * in docs — this file is frontend-only for the demo).
 */

export const ROLES = {
  FIELD_INSPECTOR: "field_inspector",
  SECTION_ENGINEER: "section_engineer",
  DIVISIONAL_ENGINEER: "divisional_engineer",
  DATA_ANALYTICS_OWNER: "data_analytics_owner",
  SYSTEM_ADMIN: "system_admin",
  AUDITOR: "auditor",
};

export const PERMISSIONS = {
  VIEW_DASHBOARD: "view_dashboard",
  VIEW_ALERTS: "view_alerts",
  CREATE_WORK_ORDER: "create_work_order",
  APPROVE_WORK_ORDER: "approve_work_order",
  CLOSE_ALERT: "close_alert",
  EDIT_THRESHOLDS: "edit_thresholds",
  UPLOAD_DATA: "upload_data",
  CERTIFY_DATA: "certify_data",
  MANAGE_USERS: "manage_users",
  VIEW_AUDIT_LOG: "view_audit_log",
};

// The matrix. Note EDIT_THRESHOLDS and CLOSE_ALERT never share a role --
// that split is the core SoD control (the person who can loosen a
// threshold should never also be the person who can dismiss the alert
// it would have generated).
const ROLE_PERMISSIONS = {
  [ROLES.FIELD_INSPECTOR]: [
    PERMISSIONS.VIEW_DASHBOARD,
    PERMISSIONS.VIEW_ALERTS,
  ],
  [ROLES.SECTION_ENGINEER]: [
    PERMISSIONS.VIEW_DASHBOARD,
    PERMISSIONS.VIEW_ALERTS,
    PERMISSIONS.CREATE_WORK_ORDER,
  ],
  [ROLES.DIVISIONAL_ENGINEER]: [
    PERMISSIONS.VIEW_DASHBOARD,
    PERMISSIONS.VIEW_ALERTS,
    PERMISSIONS.APPROVE_WORK_ORDER,
    PERMISSIONS.CLOSE_ALERT,
  ],
  [ROLES.DATA_ANALYTICS_OWNER]: [
    PERMISSIONS.VIEW_DASHBOARD,
    PERMISSIONS.EDIT_THRESHOLDS,
    PERMISSIONS.UPLOAD_DATA,
    PERMISSIONS.CERTIFY_DATA,
  ],
  [ROLES.SYSTEM_ADMIN]: [
    PERMISSIONS.MANAGE_USERS,
    // Deliberately NO data/threshold/alert permissions -- infra access
    // should never imply domain (track safety) data access.
  ],
  [ROLES.AUDITOR]: [
    PERMISSIONS.VIEW_AUDIT_LOG,
    // Read-only by construction: no other permission is ever added here.
  ],
};

export function hasPermission(role, permission) {
  return (ROLE_PERMISSIONS[role] || []).includes(permission);
}

export function permissionsFor(role) {
  return ROLE_PERMISSIONS[role] || [];
}
