import { api } from "./client";

export const tripsApi = {
  list: () => api.get("/trips"),
  create: (name) => api.post("/trips", { name }),
  get: (tripId) => api.get(`/trips/${tripId}`),
  remove: (tripId) => api.del(`/trips/${tripId}`),
};
