import { api } from "./client";

export const sharingApi = {
  create: (tripId) => api.post(`/trips/${tripId}/share`),
};
