import { api } from "./client";

export const authApi = {
  register: (email, password) => api.post("/auth/register", { email, password }),
  login: (email, password) => api.post("/auth/login", { email, password }),
  google: (credential) => api.post("/auth/google", { credential }),
  me: () => api.get("/auth/me"),
  // The current password, or (for an account with no password) the account's own email.
  deleteAccount: (confirmation) => api.del("/auth/me", { confirmation }),
};
