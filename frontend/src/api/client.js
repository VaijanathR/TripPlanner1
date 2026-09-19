import { tokenStore } from "../auth/tokenStore";

// Backend origin, injected at build time (set VITE_API_URL in Vercel).
// Falls back to the local dev server.
const API_ORIGIN = (import.meta.env.VITE_API_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
const API_BASE = `${API_ORIGIN}/api`;

export class ApiError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields ?? null;
  }
}

// Called when a request that carried a login token comes back 401 (expired or
// revoked), so the app can drop the session and send the user to /login.
let unauthorizedHandler = null;
export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler;
}

async function request(path, options = {}) {
  const token = tokenStore.get();
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...options,
    });
  } catch {
    throw new ApiError(0, "network_error", "Could not reach the server");
  }

  if (response.status === 204) return null;

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    // /auth/* answers 401 for wrong credentials -- that is not a dead session.
    if (response.status === 401 && token && !path.startsWith("/auth/")) {
      unauthorizedHandler?.();
    }
    const error = body?.error;
    throw new ApiError(
      response.status,
      error?.code ?? "unknown_error",
      error?.message ?? "Something went wrong",
      error?.fields
    );
  }

  return body;
}

export const api = {
  get: (path) => request(path),
  post: (path, data) => request(path, { method: "POST", body: JSON.stringify(data) }),
  put: (path, data) => request(path, { method: "PUT", body: JSON.stringify(data) }),
  del: (path) => request(path, { method: "DELETE" }),
};
