import { useState } from "react";
import PlaceSearch from "./PlaceSearch";

// The Editor's "Where are you going?". `onChoose(geonameId)` saves the choice;
// if it throws, the message is shown here.
export default function DestinationPicker({ onChoose, onCancel }) {
  const [choosingId, setChoosingId] = useState(null);
  const [error, setError] = useState(null);

  async function handleChoose(candidate) {
    setChoosingId(candidate.geoname_id);
    setError(null);
    try {
      await onChoose(candidate.geoname_id);
    } catch (err) {
      setError(`Couldn't set the destination: ${err.message}`);
      setChoosingId(null);
    }
  }

  return (
    <section className="destination-picker" aria-label="Choose a destination">
      <h2>Where are you going?</h2>
      <p className="hint">Enter a city, and add its state and country if you like to narrow it down.</p>
      <PlaceSearch pendingId={choosingId} onPick={handleChoose}>
        {onCancel && (
          <button type="button" className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </PlaceSearch>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
