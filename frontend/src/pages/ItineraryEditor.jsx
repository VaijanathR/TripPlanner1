import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { tripsApi } from "../api/trips";
import { daysApi } from "../api/days";
import DayEditor from "../components/DayEditor";
import ShareLink from "../components/ShareLink";

export default function ItineraryEditor() {
  const { tripId } = useParams();
  const [trip, setTrip] = useState(null);
  const [error, setError] = useState(null);

  const [newDate, setNewDate] = useState("");
  const [newLocation, setNewLocation] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [addingDay, setAddingDay] = useState(false);
  const [addDayError, setAddDayError] = useState(null);

  const [reorderError, setReorderError] = useState(null);

  function load() {
    setError(null);
    setTrip(null);
    tripsApi
      .get(tripId)
      .then((body) => setTrip(body))
      .catch((err) => setError(err.message));
  }

  useEffect(load, [tripId]);

  async function handleAddDay(e) {
    e.preventDefault();
    if (!newDate || !newLocation.trim()) return;
    setAddingDay(true);
    setAddDayError(null);
    try {
      const day = await daysApi.create(tripId, {
        date: newDate,
        location: newLocation.trim(),
        notes: newNotes || null,
      });
      setTrip((prev) => ({ ...prev, days: [...prev.days, day] }));
      setNewDate("");
      setNewLocation("");
      setNewNotes("");
    } catch (err) {
      setAddDayError(err.message);
    } finally {
      setAddingDay(false);
    }
  }

  function handleDaySaved(updatedDay) {
    setTrip((prev) => ({
      ...prev,
      days: prev.days.map((d) => (d.id === updatedDay.id ? updatedDay : d)),
    }));
  }

  function handleDayDeleted(dayId) {
    setTrip((prev) => ({ ...prev, days: prev.days.filter((d) => d.id !== dayId) }));
  }

  async function handleMove(index, direction) {
    const days = trip.days;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= days.length) return;

    const reordered = [...days];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
    const dayIds = reordered.map((d) => d.id);

    setReorderError(null);
    try {
      await daysApi.reorder(tripId, dayIds);
      setTrip((prev) => ({ ...prev, days: reordered }));
    } catch (err) {
      setReorderError(err.message);
    }
  }

  if (error) {
    return (
      <div className="page">
        <Link to="/">← Trip List</Link>
        <div className="error-state">
          <p>Couldn't load this trip: {error}</p>
          <button onClick={load}>Retry</button>
        </div>
      </div>
    );
  }

  if (trip === null) {
    return (
      <div className="page">
        <Link to="/">← Trip List</Link>
        <div className="day-list skeleton-list" aria-busy="true">
          <div className="day-editor skeleton" />
          <div className="day-editor skeleton" />
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <Link to="/">← Trip List</Link>
      <h1>{trip.name}</h1>
      <ShareLink tripId={tripId} />

      {reorderError && <p className="inline-error">Couldn't reorder days: {reorderError}</p>}

      {trip.days.length === 0 && (
        <div className="empty-state">
          <p>No days added yet.</p>
        </div>
      )}

      <div className="day-list">
        {trip.days.map((day, index) => (
          <DayEditor
            key={day.id}
            tripId={tripId}
            day={day}
            index={index}
            dayCount={trip.days.length}
            onSaved={handleDaySaved}
            onDeleted={handleDayDeleted}
            onMove={handleMove}
          />
        ))}
      </div>

      <form className="add-day-form" onSubmit={handleAddDay}>
        <h3>Add a day</h3>
        <label>
          Date
          <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} disabled={addingDay} />
        </label>
        <label>
          Location
          <input
            type="text"
            value={newLocation}
            onChange={(e) => setNewLocation(e.target.value)}
            disabled={addingDay}
          />
        </label>
        <label>
          Notes
          <input type="text" value={newNotes} onChange={(e) => setNewNotes(e.target.value)} disabled={addingDay} />
        </label>
        <button type="submit" disabled={addingDay || !newDate || !newLocation.trim()}>
          {addingDay ? "Adding…" : "Add day"}
        </button>
        {addDayError && <p className="inline-error">{addDayError}</p>}
      </form>
    </div>
  );
}
