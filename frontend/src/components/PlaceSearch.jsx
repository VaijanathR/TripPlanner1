import { useState } from "react";
import { destinationsApi } from "../api/destinations";
import { describePlace } from "../utils/place";
import { PinIcon } from "./Icons";

function CandidateList({ label, places, selectedId, pendingId, locked, onPick }) {
  return (
    <ul className="candidate-list" aria-label={label}>
      {places.map((c) => (
        <li key={c.geoname_id}>
          <button
            type="button"
            className={`candidate${c.geoname_id === selectedId ? " selected" : ""}`}
            aria-pressed={selectedId === undefined ? undefined : c.geoname_id === selectedId}
            onClick={() => onPick(c)}
            disabled={locked || pendingId != null}
          >
            <PinIcon width={16} height={16} />
            <span>{describePlace(c)}</span>
            {pendingId === c.geoname_id && <em>Saving…</em>}
            {pendingId !== c.geoname_id && c.geoname_id === selectedId && <em>Chosen</em>}
          </button>
        </li>
      ))}
    </ul>
  );
}

// Country / state / city inputs. "Paris" alone is many places, so this shows
// matching places to pick from instead of guessing. Shared by the Editor's
// "Where are you going?" and the Trip List's Create trip form.
//   onPick(candidate)  the user chose a place
//   onEdit()           the user changed a field (so an earlier choice no longer applies)
//   selectedId         the chosen place, if the caller keeps a selection
//   pendingId          a place that is being saved right now
//   locked             disable everything (e.g. while a trip is being created)
//   children           extra buttons next to "Find" (e.g. Cancel)
export default function PlaceSearch({ findLabel = "Find destination", selectedId, pendingId, locked = false, onPick, onEdit, children }) {
  const [country, setCountry] = useState("");
  const [state, setState] = useState("");
  const [city, setCity] = useState("");
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState(null);
  const [alternatives, setAlternatives] = useState([]);
  const [error, setError] = useState(null);

  const field = (setter) => (e) => {
    setter(e.target.value);
    onEdit?.();
  };

  async function handleSearch(e) {
    e.preventDefault();
    if (city.trim().length < 2) return;
    setSearching(true);
    setError(null);
    setCandidates(null);
    setAlternatives([]);
    try {
      const { candidates: found, alternatives: others } = await destinationsApi.search({ city: city.trim(), state, country });
      setCandidates(found);
      setAlternatives(others ?? []);
    } catch (err) {
      setError(`Couldn't search for places: ${err.message}`);
    } finally {
      setSearching(false);
    }
  }

  const listProps = { selectedId, pendingId, locked, onPick };

  return (
    <div className="place-search">
      <form onSubmit={handleSearch}>
        <div className="destination-fields">
          <label>
            Country
            <input type="text" value={country} onChange={field(setCountry)} placeholder="e.g. Japan, USA, UK" disabled={locked} />
          </label>
          <label>
            State / region
            <input type="text" value={state} onChange={field(setState)} placeholder="e.g. Kyoto" disabled={locked} />
          </label>
          <label>
            City
            <input type="text" value={city} onChange={field(setCity)} placeholder="e.g. Las Vegas" required disabled={locked} />
          </label>
        </div>
        <div className="destination-actions">
          <button type="submit" disabled={locked || searching || city.trim().length < 2}>
            {searching ? "Searching…" : findLabel}
          </button>
          {children}
        </div>
      </form>

      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}

      {candidates !== null && candidates.length === 0 && (
        <p className="empty-note">
          {alternatives.length > 0
            ? `No place called “${city.trim()}” matches that country or region. Did you mean one of these?`
            : "No places match. Check the spelling, or try fewer details."}
        </p>
      )}

      {candidates !== null && candidates.length === 0 && alternatives.length > 0 && (
        <CandidateList label="Places with that name elsewhere" places={alternatives} {...listProps} />
      )}

      {candidates !== null && candidates.length > 0 && (
        <CandidateList label="Matching places" places={candidates} {...listProps} />
      )}
    </div>
  );
}
