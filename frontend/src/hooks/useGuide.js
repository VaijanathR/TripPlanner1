import { useEffect, useState } from "react";
import { destinationsApi } from "../api/destinations";

export const POLL_MS = 3000;
export const MAX_POLLS = 60; // ~3 minutes: a first-time guide can take a minute

// Loads a trip's destination guide. While the server is still building it (the
// first person to look up a city waits), keeps asking and shows what has
// arrived so far. Pass a falsy `destinationKey` when the trip has no
// destination and nothing is fetched.
export function useGuide(tripId, destinationKey, pollMs = POLL_MS) {
  const [state, setState] = useState({ guide: null, error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!destinationKey) return;
    let cancelled = false;
    let timer;

    async function load(polls) {
      try {
        const guide = await destinationsApi.guide(tripId);
        if (cancelled) return;
        setState({ guide, error: null });
        if (guide.status === "building" && polls < MAX_POLLS) {
          timer = setTimeout(() => load(polls + 1), pollMs);
        }
      } catch (err) {
        if (!cancelled) setState((prev) => ({ guide: prev.guide, error: err.message }));
      }
    }
    load(0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tripId, destinationKey, pollMs, attempt]);

  return {
    guide: destinationKey ? state.guide : null,
    error: destinationKey ? state.error : null,
    retry: () => {
      setState({ guide: null, error: null });
      setAttempt((n) => n + 1);
    },
  };
}
