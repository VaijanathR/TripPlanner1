import { api } from "./client";

export const conditionsApi = {
  forDay: (tripId, dayId) => api.get(`/trips/${tripId}/days/${dayId}/conditions`),
};
