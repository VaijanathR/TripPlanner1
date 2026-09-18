import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { tripsApi } from "../api/trips";

export default function TripList() {
  const navigate = useNavigate();
  const [trips, setTrips] = useState(null);
  const [error, setError] = useState(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [deleteErrors, setDeleteErrors] = useState({});
  const [deletingId, setDeletingId] = useState(null);

  function load() {
    setError(null);
    setTrips(null);
    tripsApi
      .list()
      .then((body) => setTrips(body.trips))
      .catch((err) => setError(err.message));
  }

  useEffect(load, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const trip = await tripsApi.create(newName.trim());
      navigate(`/trips/${trip.id}`);
    } catch (err) {
      setCreateError(err.message);
      setCreating(false);
    }
  }

  async function handleDelete(tripId) {
    if (!window.confirm("Delete this trip? This cannot be undone.")) return;
    setDeletingId(tripId);
    setDeleteErrors((prev) => ({ ...prev, [tripId]: null }));
    try {
      await tripsApi.remove(tripId);
      setTrips((prev) => prev.filter((t) => t.id !== tripId));
    } catch (err) {
      setDeleteErrors((prev) => ({ ...prev, [tripId]: err.message }));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="page">
      <h1>Trip Planner</h1>

      <form className="create-trip-form" onSubmit={handleCreate}>
        <input
          type="text"
          placeholder="New trip name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          disabled={creating}
        />
        <button type="submit" disabled={creating || !newName.trim()}>
          {creating ? "Creating…" : "Create trip"}
        </button>
        {createError && <p className="inline-error">{createError}</p>}
      </form>

      {trips === null && !error && (
        <ul className="trip-list" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="trip-card skeleton" />
          ))}
        </ul>
      )}

      {error && (
        <div className="error-state">
          <p>Couldn't load your trips: {error}</p>
          <button onClick={load}>Retry</button>
        </div>
      )}

      {trips !== null && !error && trips.length === 0 && (
        <div className="empty-state">
          <p>No trips yet.</p>
          <p>Create your first trip above to get started.</p>
        </div>
      )}

      {trips !== null && !error && trips.length > 0 && (
        <ul className="trip-list">
          {trips.map((trip) => (
            <li key={trip.id} className="trip-card">
              <Link to={`/trips/${trip.id}`}>
                <strong>{trip.name}</strong>
                <span>
                  {trip.day_count === 0
                    ? "No days yet"
                    : `${trip.start_date} – ${trip.end_date} · ${trip.day_count} day${trip.day_count === 1 ? "" : "s"}`}
                </span>
              </Link>
              <button
                className="delete-button"
                onClick={() => handleDelete(trip.id)}
                disabled={deletingId === trip.id}
              >
                {deletingId === trip.id ? "Deleting…" : "Delete"}
              </button>
              {deleteErrors[trip.id] && (
                <p className="inline-error">{deleteErrors[trip.id]}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
