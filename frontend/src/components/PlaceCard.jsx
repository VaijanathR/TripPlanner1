import { useState } from "react";
import { shortDate } from "../utils/format";
import Photo from "./Photo";

// One popular place, with a control to drop it into a day of the itinerary.
export default function PlaceCard({ place, days, onAdd }) {
  const [dayId, setDayId] = useState("");
  const [adding, setAdding] = useState(false);
  const selectedDay = dayId || String(days[0]?.id ?? "");

  async function handleAdd() {
    setAdding(true);
    try {
      await onAdd(place, Number(selectedDay));
    } finally {
      setAdding(false);
    }
  }

  return (
    <article className="place-card">
      <Photo className="place-photo" src={place.image_url} alt={place.name} />
      <div className="place-body">
        <h4>{place.name}</h4>
        <p className="place-meta">
          {place.type && <span className="chip">{place.type}</span>}
          {place.distance_km != null && <span>{place.distance_km} km from the center</span>}
        </p>
        {place.description && <p className="place-desc">{place.description}</p>}
        {place.credit_url && (
          <a className="credit" href={place.credit_url} target="_blank" rel="noopener noreferrer">
            Photo credit
          </a>
        )}
        {days.length === 0 ? (
          <p className="hint">Add a day below to plan this place.</p>
        ) : (
          <div className="place-add">
            <select
              aria-label={`Day for ${place.name}`}
              value={selectedDay}
              onChange={(e) => setDayId(e.target.value)}
              disabled={adding}
            >
              {days.map((d, i) => (
                <option key={d.id} value={d.id}>
                  {`Day ${i + 1} · ${shortDate(d.date)}`}
                </option>
              ))}
            </select>
            <button type="button" aria-label={`Add ${place.name} to itinerary`} onClick={handleAdd} disabled={adding}>
              {adding ? "Adding…" : "Add to itinerary"}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
