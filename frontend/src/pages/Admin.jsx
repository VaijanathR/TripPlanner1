import { useEffect, useState } from "react";
import { adminApi } from "../api/admin";
import { useAuth } from "../auth/useAuth";

const NOT_ALLOWED = "You aren't allowed to see this page.";

export default function Admin() {
  const { user } = useAuth();
  const [users, setUsers] = useState(null);
  const [error, setError] = useState(null);
  const [notAllowed, setNotAllowed] = useState(false);
  const [deleteErrors, setDeleteErrors] = useState({});
  const [deletingId, setDeletingId] = useState(null);

  function load() {
    setError(null);
    setUsers(null);
    adminApi
      .users()
      .then((body) => setUsers(body.users))
      .catch((err) => (err.status === 403 ? setNotAllowed(true) : setError(err.message)));
  }

  // Never ask the server for the list unless we already know we are an administrator.
  useEffect(() => {
    if (user.is_admin) load();
  }, [user.is_admin]);

  async function handleDelete(account) {
    const trips = account.trip_count === 1 ? "1 trip" : `${account.trip_count} trips`;
    if (!window.confirm(`Delete the account ${account.email} and its ${trips}? This cannot be undone.`)) return;
    setDeletingId(account.id);
    setDeleteErrors((prev) => ({ ...prev, [account.id]: null }));
    try {
      await adminApi.remove(account.id);
      setUsers((prev) => prev.filter((u) => u.id !== account.id));
    } catch (err) {
      setDeleteErrors((prev) => ({ ...prev, [account.id]: err.message }));
    } finally {
      setDeletingId(null);
    }
  }

  if (!user.is_admin || notAllowed) {
    return (
      <main className="page admin-page">
        <h1>Admin</h1>
        <p className="inline-error" role="alert">
          {NOT_ALLOWED}
        </p>
      </main>
    );
  }

  return (
    <main className="page admin-page">
      <h1>Admin</h1>
      <p>Every account on this site. Deleting one also deletes its trips.</p>

      {error && (
        <div className="error-state">
          <p>Couldn&apos;t load the accounts: {error}</p>
          <button type="button" onClick={load}>
            Retry
          </button>
        </div>
      )}

      {users === null && !error && <p aria-busy="true">Loading accounts…</p>}

      {users !== null && (
        <ul className="admin-users" aria-label="Accounts">
          {users.map((account) => (
            <li key={account.id}>
              <div className="admin-user-main">
                <strong>{account.email}</strong>
                {account.is_admin && <span className="badge">Admin</span>}
                <span className="admin-user-meta">
                  Joined {account.created_at.slice(0, 10)} · {account.trip_count === 1 ? "1 trip" : `${account.trip_count} trips`}
                </span>
              </div>
              {!account.is_admin && (
                <button
                  type="button"
                  className="delete-button"
                  aria-label={`Delete account ${account.email}`}
                  onClick={() => handleDelete(account)}
                  disabled={deletingId === account.id}
                >
                  {deletingId === account.id ? "Deleting…" : "Delete"}
                </button>
              )}
              {deleteErrors[account.id] && (
                <p className="inline-error" role="alert">
                  {deleteErrors[account.id]}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
