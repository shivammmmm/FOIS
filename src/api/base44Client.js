import { apiClient } from "./apiClient";

const localUser = {
  id: "local-user",
  email: "local@example.com",
  full_name: "Local User",
  role: "admin",
};

export const base44 = {
  ...apiClient,

  auth: {
    me: async () => {
      const token = window.localStorage.getItem("token") ||
        window.localStorage.getItem("base44_access_token");

      const response = await fetch("/api/auth/me", {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });

      if (!response.ok) {
        // Let AuthContext decide on auth-required state
        throw new Error(`Auth request failed: ${response.status}`);
      }

      return response.json();
    },

    login: async ({ identifier, username, email, password } = /** @type {any} */ ({})) => {
      const ident = identifier || username || email;
      if (!ident || !password) {
        throw new Error("identifier/username/email and password are required");
      }

      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: ident, password }),
      });

      if (!response.ok) {
        const details = await response.json().catch(() => ({}));
        throw new Error(details.error || "Login failed");
      }

      const data = await response.json();
      const token = data?.token;
      if (!token) throw new Error("Login failed: token missing");

      // Store JWT so protected requests can attach it
      base44.auth.setToken(token);

      return data;
    },
    requestPasswordReset: async (identifier) => {
      const response = await fetch('/api/auth/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Unable to request password reset');
      return data;
    },
    resetPassword: async ({ identifier, code, password }) => {
      const response = await fetch('/api/auth/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, code, password }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Unable to reset password');
      return data;
    },

    updateMe: async (updates = /** @type {any} */ ({})) => {
      // Backend currently doesn't implement PATCH /api/auth/me.
      // Keep a safe fallback for any UI that calls this.
      try {
        const response = await fetch("/api/auth/me", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates || {}),
        });
        if (!response.ok) throw new Error("Auth update failed");
        return response.json();
      } catch {
        return { ...localUser, ...(updates || {}) };
      }
    },

    signup: async ({ username, email, password } = /** @type {any} */ ({})) => {
      if (!username || !email || !password) {
        throw new Error("username, email, password are required");
      }

      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password }),
      });

      if (!response.ok) {
        const details = await response.json().catch(() => ({}));
        throw new Error(details.error || "Signup failed");
      }

      return response.json();
    },

    isAuthenticated: () => Promise.resolve(true),
    logout: () => {
      window.localStorage.removeItem("base44_access_token");
      window.localStorage.removeItem("token");
    },
    redirectToLogin: () => {},
    setToken: (token /** @type {any} */ = /** @type {any} */ (undefined)) => {
      if (!token) return;
      window.localStorage.setItem("token", token);
      window.localStorage.setItem("base44_access_token", token);
    },
  },
};

export default base44;
