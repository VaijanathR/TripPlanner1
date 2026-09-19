import { useEffect, useRef, useState } from "react";

// Shows one day's maps/weather conditions. `load` returns a promise for the
// conditions response. Any failure -- an "unavailable" response, a network
// error, a timeout -- collapses to the same "unavailable" badge, so the rest
// of the day always renders. Remount with a new `key` to reload.
export default function ConditionsPanel({ load, location }) {
  const [state, setState] = useState({ status: "loading" });
  // Loads once per mount; the ref keeps an inline `load` from re-triggering it.
  const loadRef = useRef(load);

  useEffect(() => {
    let cancelled = false;
    loadRef.current()
      .then((result) => {
        if (!cancelled) setState(result?.status === "ok" && result.data ? result : { status: "unavailable" });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "unavailable" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") {
    return (
      <div className="conditions-panel" aria-busy="true">
        <span className="conditions-loading">Loading conditions…</span>
      </div>
    );
  }

  if (state.status === "unavailable") {
    return (
      <div className="conditions-panel">
        <span className="unavailable-badge" role="status">
          Conditions unavailable
        </span>
      </div>
    );
  }

  const { temperature_c, condition, map_url, map_embed_url } = state.data;
  return (
    <div className="conditions-panel">
      <p className="conditions-summary">
        {temperature_c}°C, {condition}
      </p>
      {map_embed_url && (
        <iframe
          className="conditions-map"
          title={`Map of ${location}`}
          src={map_embed_url}
          loading="lazy"
        />
      )}
      {map_url && (
        <a href={map_url} target="_blank" rel="noopener noreferrer">
          View larger map
        </a>
      )}
    </div>
  );
}
