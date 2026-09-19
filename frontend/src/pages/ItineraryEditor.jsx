import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { tripsApi } from "../api/trips";
import { daysApi } from "../api/days";
import { destinationsApi } from "../api/destinations";
import DayEditor from "../components/DayEditor";
import DestinationGuide from "../components/DestinationGuide";
import DestinationPicker from "../components/DestinationPicker";
import { PinIcon } from "../components/Icons";
import { HeroScene } from "../components/Illustrations";
import ShareLink from "../components/ShareLink";
import { useGuide } from "../hooks/useGuide";
import { nextSlot } from "../utils/schedule";

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
  const newDateRef = useRef(null);

  const [changingDestination, setChangingDestination] = useState(false);
  // Which tab is showing once a destination is set; null = pick a sensible default.
  const [view, setView] = useState(null);
  const [addMessage, setAddMessage] = useState(null);
  // Which days have edits the user hasn't saved yet (tracked without re-rendering).
  const dirtyDays = useRef(new Set());
  const [dayVersions, setDayVersions] = useState({});
  const handleDirtyChange = useCallback((dayId, dirty) => {
    if (dirty) dirtyDays.current.add(dayId);
    else dirtyDays.current.delete(dayId);
  }, []);

  const destination = trip?.destination ?? null;
  const { guide, error: guideError, retry: retryGuide } = useGuide(tripId, destination?.geoname_id);

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

  async function handleChooseDestination(geonameId) {
    const updated = await destinationsApi.set(tripId, geonameId);
    setTrip((prev) => ({ ...prev, destination: updated.destination }));
    setChangingDestination(false);
  }

  // Adds a popular place to a day as a new activity. Days with unsaved edits are
  // refused: adding would replace what the user has typed.
  async function handleAddPlace(place, dayId) {
    const index = trip.days.findIndex((d) => d.id === dayId);
    const day = trip.days[index];
    setAddMessage(null);
    if (dirtyDays.current.has(dayId)) {
      setAddMessage({ ok: false, text: `Save the changes to Day ${index + 1} first, then add ${place.name}.` });
      return;
    }
    const slot = nextSlot(day.activities);
    const activities = [
      ...day.activities.map((a, i) => ({
        id: a.id,
        title: a.title,
        start_time: a.start_time,
        end_time: a.end_time,
        notes: a.notes,
        order_index: i,
      })),
      { id: null, title: place.name, ...slot, notes: place.description ?? null, order_index: day.activities.length },
    ];
    try {
      const updated = await daysApi.update(tripId, dayId, {
        date: day.date,
        location: day.location,
        notes: day.notes,
        activities,
      });
      handleDaySaved(updated);
      // Re-create that day's editor so it shows the saved activities.
      setDayVersions((prev) => ({ ...prev, [dayId]: (prev[dayId] ?? 0) + 1 }));
      setAddMessage({ ok: true, text: `Added “${place.name}” to Day ${index + 1}.` });
    } catch (err) {
      setAddMessage({ ok: false, text: `Couldn't add ${place.name}: ${err.message}` });
    }
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

  const heroPhoto = guide?.photos?.city?.image_url ?? null;
  // With a destination the page has two tabs. Both stay mounted (just hidden) so
  // switching never throws away what someone has typed into a day.
  const activeView = view ?? (trip.days.length > 0 ? "plan" : "discover");

  return (
    <>
      <header
        className={`trip-hero${heroPhoto ? " has-photo" : ""}`}
        style={heroPhoto ? { backgroundImage: `linear-gradient(rgba(6, 30, 42, 0.35), rgba(6, 30, 42, 0.7)), url("${heroPhoto}")` } : undefined}
      >
        {!heroPhoto && <HeroScene className="hero-art" />}
        <div className="hero-inner">
          <Link className="back-link" to="/">← Trip List</Link>
          <h1>{trip.name}</h1>
          {destination && (
            <p className="hero-destination">
              <PinIcon width={16} height={16} />
              {[destination.city, destination.state, destination.country].filter(Boolean).join(", ")}
              {!changingDestination && (
                <button type="button" className="btn-light" onClick={() => setChangingDestination(true)}>
                  Change destination
                </button>
              )}
            </p>
          )}
          <ShareLink tripId={tripId} />
        </div>
      </header>

    <div className="page">
      {(!destination || changingDestination) && (
        <DestinationPicker
          onChoose={handleChooseDestination}
          onCancel={destination ? () => setChangingDestination(false) : undefined}
        />
      )}
      {addMessage && (
        <p className={addMessage.ok ? "notice" : "inline-error"} role={addMessage.ok ? "status" : "alert"}>
          {addMessage.text}
        </p>
      )}

      {destination && (
        <div className="view-tabs" role="tablist" aria-label="Trip sections">
          <button
            type="button"
            role="tab"
            id="tab-plan"
            aria-selected={activeView === "plan"}
            aria-controls="panel-plan"
            onClick={() => setView("plan")}
          >
            Itinerary
          </button>
          <button
            type="button"
            role="tab"
            id="tab-discover"
            aria-selected={activeView === "discover"}
            aria-controls="panel-discover"
            onClick={() => setView("discover")}
          >
            Discover {destination.city}
          </button>
        </div>
      )}

      {destination && (
        <div id="panel-discover" role="tabpanel" aria-labelledby="tab-discover" hidden={activeView !== "discover"}>
          <DestinationGuide
            destination={destination}
            guide={guide}
            error={guideError}
            onRetry={retryGuide}
            days={trip.days}
            onAddPlace={handleAddPlace}
          />
        </div>
      )}

      <div id="panel-plan" role={destination ? "tabpanel" : undefined} aria-labelledby={destination ? "tab-plan" : undefined} hidden={destination ? activeView !== "plan" : false}>
      {reorderError && <p className="inline-error">Couldn't reorder days: {reorderError}</p>}

      {trip.days.length === 0 && (
        <div className="empty-state">
          <p>No days added yet.</p>
          <button type="button" onClick={() => newDateRef.current?.focus()}>
            Add a day
          </button>
        </div>
      )}

      <div className="day-list">
        {trip.days.map((day, index) => (
          <DayEditor
            key={`${day.id}:${dayVersions[day.id] ?? 0}`}
            tripId={tripId}
            day={day}
            index={index}
            dayCount={trip.days.length}
            onSaved={handleDaySaved}
            onDeleted={handleDayDeleted}
            onMove={handleMove}
            onDirtyChange={handleDirtyChange}
          />
        ))}
      </div>

      <form className="add-day-form" onSubmit={handleAddDay}>
        <h3>Add a day</h3>
        <label>
          Date
          <input
            ref={newDateRef}
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            disabled={addingDay}
          />
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
    </div>
    </>
  );
}
