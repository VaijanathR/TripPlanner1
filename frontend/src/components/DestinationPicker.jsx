import { useState } from "react";
import { destinationsApi } from "../api/destinations";
import { PinIcon } from "./Icons";

const describe = (c) => [c.city, c.state, c.country].filter(Boolean).join(", ");

function CandidateList({ label, places, choosingId, onChoose }) {
  return (
    <ul className="candidate-list" aria-label={label}>
      {places.map((c) => (
        <li key={c.geoname_id}>
          <button type="button" className="candidate" onClick={() => onChoose(c)} disabled={choosingId !== null}>
            <PinIcon width={16} height={16} />
            <span>{describe(c)}</span>
            {choosingId === c.geoname_id && <em>Saving…</em>}
          </button>
        </li>
      ))}
    </ul>
  );
}

// Country / state / city inputs. "Paris" alone is many places, so this shows
// matching places to pick from instead of guessing. `onChoose(geonameId)` saves
// the choice; if it throws, the message is shown here.
export default function DestinationPicker({ onChoose, onCancel }) {
  const [country, setCountry] = useState("");
  const [state, setState] = useState("");
  const [city, setCity] = useState("");
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState(null);
  const [alternatives, setAlternatives] = useState([]);
  const [choosingId, setChoosingId] = useState(null);
  const [error, setError] = useState(null);

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
      <form onSubmit={handleSearch}>
        <div className="destination-fields">
          <label>
            Country
            <input type="text" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="e.g. Japan, USA, UK" />
          </label>
          <label>
            State / region
            <input type="text" value={state} onChange={(e) => setState(e.target.value)} placeholder="e.g. Kyoto" />
          </label>
          <label>
            City
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="e.g. Las Vegas"
              required
            />
          </label>
        </div>
        <div className="destination-actions">
          <button type="submit" disabled={searching || city.trim().length < 2}>
            {searching ? "Searching…" : "Find destination"}
          </button>
          {onCancel && (
            <button type="button" className="btn-ghost" onClick={onCancel}>
              Cancel
            </button>
          )}
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
        <CandidateList label="Places with that name elsewhere" places={alternatives} choosingId={choosingId} onChoose={handleChoose} />
      )}

      {candidates !== null && candidates.length > 0 && (
        <CandidateList label="Matching places" places={candidates} choosingId={choosingId} onChoose={handleChoose} />
      )}
    </section>
  );
}
