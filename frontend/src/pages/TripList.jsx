import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { tripsApi } from "../api/trips";
import { CalendarIcon, PinIcon, TrashIcon } from "../components/Icons";
import { EmptyTrips, HeroScene } from "../components/Illustrations";
import { coverGradient } from "../utils/cover";

// How long the "trip deleted" confirmation stays visible.
export const NOTICE_MS = 3000;

export default function TripList() {
  const navigate = useNavigate();
  const [trips, setTrips] = useState(null);
  const [error, setError] = useState(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [deleteErrors, setDeleteErrors] = useState({});
  const [deletingId, setDeletingId] = useState(null);
  const [notice, setNotice] = useState(null);
  const nameInputRef = useRef(null);

  function load() {
    setError(null);
    setTrips(null);
    tripsApi
      .list()
      .then((body) => setTrips(body.trips))
      .catch((err) => setError(err.message));
  }

  useEffect(load, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

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
      const removed = trips.find((t) => t.id === tripId);
      setTrips((prev) => prev.filter((t) => t.id !== tripId));
      setNotice(`Deleted “${removed?.name ?? "trip"}”`);
    } catch (err) {
      setDeleteErrors((prev) => ({ ...prev, [tripId]: err.message }));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
    <header className="hero">
      <HeroScene className="hero-art" />
      <div className="hero-inner">
        <p className="eyebrow">Trip Planner</p>
        <h1>Where to next?</h1>
        <p className="hero-sub">
          Plan every day, discover what is worth seeing, and share your itinerary with a link.
        </p>

      <form className="create-trip-form" onSubmit={handleCreate}>
        <input
          ref={nameInputRef}
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
      </div>
    </header>

    <div className="page">

      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}

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
          <EmptyTrips className="empty-illustration" />
          <p>No trips yet.</p>
          <button type="button" onClick={() => nameInputRef.current?.focus()}>
            Create your first trip
          </button>
        </div>
      )}

      {trips !== null && !error && trips.length > 0 && (
        <ul className="trip-list">
          {trips.map((trip) => (
            <li key={trip.id} className="trip-card">
              <Link to={`/trips/${trip.id}`}>
                <div
                  className="trip-cover"
                  style={{
                    // The gradient sits under the photo, so a slow or missing
                    // image still leaves a finished-looking card.
                    backgroundImage: trip.cover_image_url
                      ? `url("${trip.cover_image_url}"), ${coverGradient(trip.name)}`
                      : coverGradient(trip.name),
                  }}
                >
                  <PinIcon />
                </div>
                <div className="trip-card-body">
                  <strong>{trip.name}</strong>
                  {trip.destination && (
                    <span className="trip-destination">
                      {[trip.destination.city, trip.destination.country].filter(Boolean).join(", ")}
                    </span>
                  )}
                  <span>
                    <CalendarIcon width={15} height={15} />
                    {trip.day_count === 0
                      ? "No days yet"
                      : `${trip.start_date} – ${trip.end_date} · ${trip.day_count} day${trip.day_count === 1 ? "" : "s"}`}
                  </span>
                </div>
              </Link>
              <div className="trip-card-actions">
                <button
                  className="delete-button"
                  onClick={() => handleDelete(trip.id)}
                  disabled={deletingId === trip.id}
                >
                  <TrashIcon width={15} height={15} />
                  {deletingId === trip.id ? "Deleting…" : "Delete"}
                </button>
              </div>
              {deleteErrors[trip.id] && (
                <p className="inline-error">{deleteErrors[trip.id]}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
    </>
  );
}
