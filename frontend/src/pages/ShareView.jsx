import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { sharingApi } from "../api/sharing";
import Brand from "../components/Brand";
import ConditionsPanel from "../components/ConditionsPanel";
import { HeroScene } from "../components/Illustrations";

// HH:MM:SS from the API -> HH:MM for display.
const shortTime = (t) => (t ?? "").slice(0, 5);

// Public, read-only view of a shared trip. Deliberately renders no inputs,
// no edit/add/delete controls, and never calls a mutating endpoint.
export default function ShareView() {
  const { token } = useParams();
  const [result, setResult] = useState({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    sharingApi
      .read(token)
      .then((trip) => {
        if (!cancelled) setResult({ status: "ok", trip });
      })
      .catch((err) => {
        if (cancelled) return;
        // 404 = invalid, never-generated, or deleted; the API deliberately
        // doesn't distinguish them.
        setResult(
          err.status === 404
            ? { status: "unavailable" }
            : { status: "error", message: err.message }
        );
      });
    return () => {
      cancelled = true;
    };
  }, [token, attempt]);

  function handleRetry() {
    setResult({ status: "loading" });
    setAttempt((n) => n + 1);
  }

  if (result.status === "loading") {
    return (
      <div className="page">
        <div className="day-list skeleton-list" aria-busy="true" aria-label="Loading itinerary">
          <div className="day-editor skeleton" />
          <div className="day-editor skeleton" />
        </div>
      </div>
    );
  }

  if (result.status === "unavailable") {
    return (
      <div className="page">
        <div className="error-state">
          <h1>This itinerary is unavailable</h1>
          <p>The link may be invalid, or the trip may have been deleted.</p>
        </div>
      </div>
    );
  }

  if (result.status === "error") {
    return (
      <div className="page">
        <div className="error-state">
          <p>Couldn't load this itinerary: {result.message}</p>
          <button type="button" onClick={handleRetry}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const { trip } = result;
  return (
    <div className="share-view">
      <div className="share-header">
        <Brand />
      </div>
      <header className="trip-hero">
        <HeroScene className="hero-art" />
        <div className="hero-inner">
          <p className="eyebrow">Shared itinerary</p>
          <h1>{trip.name}</h1>
        </div>
      </header>
      <div className="page">

      {trip.days.length === 0 && (
        <div className="empty-state">
          <p>No days have been added to this trip yet.</p>
        </div>
      )}

      <div className="day-list">
        {trip.days.map((day) => (
          <section key={day.id} className="day-editor share-day" aria-label={day.location}>
            <h2>{day.location}</h2>
            <p className="share-day-date">{day.date}</p>
            {day.notes && <p className="share-day-notes">{day.notes}</p>}

            <ConditionsPanel
              key={day.location}
              location={day.location}
              load={() => sharingApi.conditions(token, day.id)}
            />

            <h3>Activities</h3>
            {day.activities.length === 0 ? (
              <p className="empty-state">No activities yet.</p>
            ) : (
              <ul className="activity-list">
                {day.activities.map((a) => (
                  <li key={a.id} className="share-activity">
                    <strong>{a.title}</strong>{" "}
                    <span>
                      {shortTime(a.start_time)}–{shortTime(a.end_time)}
                    </span>
                    {a.notes && <span className="share-activity-notes"> — {a.notes}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
      </div>
    </div>
  );
}
