import { useCallback, useEffect, useMemo, useState } from "react";
import { authApi } from "../api/auth";
import { setUnauthorizedHandler } from "../api/client";
import { tokenStore } from "./tokenStore";
import { AuthContext } from "./useAuth";

// status: "loading" (checking a stored token) | "anon" | "authed" | "error"
// (couldn't reach the server to check -- distinct from "not logged in").
const ANON = { status: "anon", user: null, error: null, notice: null };

export function AuthProvider({ children }) {
  const [state, setState] = useState(() =>
    tokenStore.get() ? { status: "loading", user: null, error: null, notice: null } : ANON
  );
  const [attempt, setAttempt] = useState(0);

  // Validate a stored token on load (and on Retry).
  useEffect(() => {
    if (!tokenStore.get()) return;
    let cancelled = false;
    authApi
      .me()
      .then((user) => {
        if (!cancelled) setState({ status: "authed", user, error: null, notice: null });
      })
      .catch((err) => {
        if (cancelled) return;
        if (err.status === 401) {
          tokenStore.clear();
          setState(ANON);
        } else {
          setState({ status: "error", user: null, error: err.message });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // A logged-in request that comes back 401 means the session is over.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      tokenStore.clear();
      setState(ANON);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const completeLogin = useCallback((response) => {
    tokenStore.set(response.access_token);
    setState({ status: "authed", user: response.user, error: null, notice: null });
  }, []);

  const value = useMemo(
    () => ({
      status: state.status,
      user: state.user,
      error: state.error,
      notice: state.notice,
      login: async (email, password) => completeLogin(await authApi.login(email, password)),
      register: async (email, password) => completeLogin(await authApi.register(email, password)),
      loginWithGoogle: async (credential) => completeLogin(await authApi.google(credential)),
      // `notice` (optional) is shown on the Login screen, e.g. "Your account was deleted."
      // It lives here, not in the navigation state, because the login guard's own
      // redirect to /login would overwrite anything passed that way.
      logout: (options) => {
        tokenStore.clear();
        setState({ ...ANON, notice: options?.notice ?? null });
      },
      retry: () => {
        setState({ status: "loading", user: null, error: null, notice: null });
        setAttempt((n) => n + 1);
      },
    }),
    [state, completeLogin]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
