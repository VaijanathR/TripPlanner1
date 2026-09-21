import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../api/auth";
import { useAuth } from "../auth/useAuth";

export default function Account() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);

  async function handleDelete(e) {
    e.preventDefault();
    if (!confirmation || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await authApi.deleteAccount(confirmation);
    } catch (err) {
      // A wrong confirmation, a lock ("try again in N minutes"), or the server being away.
      setError(err.message);
      setDeleting(false);
      return;
    }
    logout();
    navigate("/login", { replace: true, state: { notice: "Your account was deleted." } });
  }

  return (
    <main className="page account-page">
      <h1>Account</h1>
      <p>
        Signed in as <strong>{user.email}</strong>
      </p>

      <section className="danger-zone" aria-labelledby="delete-account-heading">
        <h2 id="delete-account-heading">Delete my account</h2>
        {user.is_admin ? (
          <p>
            Administrator accounts can&apos;t be deleted here. Ask the person running the site to remove this address
            from the administrator list first.
          </p>
        ) : (
          <>
            <p>
              This permanently deletes your account, all of your trips and their share links. It cannot be undone.
            </p>
            <form onSubmit={handleDelete}>
              <label>
                {user.has_password ? "Confirm with your password" : "Type your email address to confirm"}
                <input
                  type={user.has_password ? "password" : "text"}
                  autoComplete={user.has_password ? "current-password" : "off"}
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  disabled={deleting}
                />
              </label>
              <button type="submit" className="delete-button" disabled={!confirmation || deleting}>
                {deleting ? "Deleting…" : "Delete my account"}
              </button>
              {error && (
                <p className="inline-error" role="alert">
                  {error}
                </p>
              )}
            </form>
          </>
        )}
      </section>
    </main>
  );
}
