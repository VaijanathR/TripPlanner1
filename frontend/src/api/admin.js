import { api } from "./client";

export const adminApi = {
  users: () => api.get("/admin/users"),
  remove: (userId) => api.del(`/admin/users/${userId}`),
};
