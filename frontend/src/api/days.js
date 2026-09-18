import { api } from "./client";

export const daysApi = {
  create: (tripId, day) => api.post(`/trips/${tripId}/days`, day),
  update: (tripId, dayId, day) => api.put(`/trips/${tripId}/days/${dayId}`, day),
  remove: (tripId, dayId) => api.del(`/trips/${tripId}/days/${dayId}`),
  reorder: (tripId, dayIds) => api.put(`/trips/${tripId}/days/reorder`, { day_ids: dayIds }),
};
