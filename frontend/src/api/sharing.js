import { api } from "./client";

export const sharingApi = {
  create: (tripId) => api.post(`/trips/${tripId}/share`),
  read: (token) => api.get(`/share/${token}`),
  conditions: (token, dayId) => api.get(`/share/${token}/days/${dayId}/conditions`),
};
