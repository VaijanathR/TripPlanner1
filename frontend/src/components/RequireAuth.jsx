import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import UserBar from "./UserBar";

// Wraps a page that needs a login: waits for the stored token to be checked,
// sends anonymous visitors to /login (remembering where they were headed), and
// shows a Retry -- not a login screen -- if the server just couldn't be reached.
export default function RequireAuth({ children }) {
  const { status, error, retry, notice } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return (
      <div className="page">
        <div className="day-list skeleton-list" aria-busy="true" aria-label="Checking your session">
          <div className="day-editor skeleton" />
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="page">
        <div className="error-state">
          <p>Couldn't check your session: {error}</p>
          <button type="button" onClick={retry}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (status === "anon") {
    // No "return to" page after an account deletion: there is no account to return as.
    return <Navigate to="/login" replace state={notice ? undefined : { from: location.pathname + location.search }} />;
  }

  return (
    <>
      <UserBar />
      {children}
    </>
  );
}
