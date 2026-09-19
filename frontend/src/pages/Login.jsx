import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import GoogleSignInButton from "../components/GoogleSignInButton";
import { useAuth } from "../auth/useAuth";

const MIN_PASSWORD_LENGTH = 8;

// A readable message from an ApiError. Field errors from the API arrive as
// "Value error, must be ..." -- drop the pydantic prefix.
function describeError(err) {
  const firstField = err.fields ? Object.values(err.fields)[0] : null;
  return (firstField ?? err.message).replace(/^Value error, /, "");
}

export default function Login() {
  const { status, login, register, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const destination = location.state?.from ?? "/";

  if (status === "authed") return <Navigate to={destination} replace />;

  const isRegister = mode === "register";

  async function attempt(action) {
    setSubmitting(true);
    setError(null);
    try {
      await action();
      navigate(destination, { replace: true });
    } catch (err) {
      setError(describeError(err));
      setSubmitting(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (isRegister && password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    attempt(() => (isRegister ? register(email, password) : login(email, password)));
  }

  function switchMode(next) {
    setMode(next);
    setError(null);
  }

  return (
    <div className="page auth-page">
      <h1>Trip Planner</h1>
      <div className="auth-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={!isRegister} onClick={() => switchMode("login")}>
          Log in
        </button>
        <button type="button" role="tab" aria-selected={isRegister} onClick={() => switchMode("register")}>
          Create account
        </button>
      </div>

      <form className="auth-form" onSubmit={handleSubmit}>
        <label>
          Email
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete={isRegister ? "new-password" : "current-password"}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
          />
        </label>
        {isRegister && (
          <p className="hint">At least {MIN_PASSWORD_LENGTH} characters.</p>
        )}
        <button type="submit" disabled={submitting}>
          {submitting ? "Please wait…" : isRegister ? "Create account" : "Log in"}
        </button>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
      </form>

      <GoogleSignInButton onCredential={(credential) => attempt(() => loginWithGoogle(credential))} />
    </div>
  );
}
