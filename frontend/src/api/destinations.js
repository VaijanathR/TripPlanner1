import { api } from "./client";

export const destinationsApi = {
  search: ({ city, state, country }) => {
    const params = new URLSearchParams({ city });
    if (state?.trim()) params.set("state", state.trim());
    if (country?.trim()) params.set("country", country.trim());
    return api.get(`/destinations/search?${params}`);
  },
  set: (tripId, geonameId) => api.put(`/trips/${tripId}/destination`, { geoname_id: geonameId }),
  clear: (tripId) => api.del(`/trips/${tripId}/destination`),
  guide: (tripId) => api.get(`/trips/${tripId}/guide`),
};
