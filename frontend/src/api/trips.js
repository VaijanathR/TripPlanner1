import { api } from "./client";

export const tripsApi = {
  list: () => api.get("/trips"),
  // With a geonameId the trip is created with that destination in one step.
  create: (name, geonameId) => api.post("/trips", geonameId == null ? { name } : { name, geoname_id: geonameId }),
  get: (tripId) => api.get(`/trips/${tripId}`),
  remove: (tripId) => api.del(`/trips/${tripId}`),
};
