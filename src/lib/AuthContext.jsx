/**
 * AuthContext.jsx
 * TEMPORARY: role switcher stands in for real login until Person 2's
 * backend issues JWTs with a role claim. Swap `switchRole` for a real
 * POST /auth/login call -- nothing else in the app should need to
 * change, since components only ever read `role` from this context,
 * never a hardcoded value.
 */
import React, { createContext, useContext, useState } from "react";
import { ROLES } from "./roles";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState({
    id: "demo-user",
    name: "Demo User",
    role: ROLES.FIELD_INSPECTOR, // least-privilege default
  });

  const switchRole = (role) => setUser((u) => ({ ...u, role }));

  return (
    <AuthContext.Provider value={{ user, switchRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
