const KEY = "tripplanner.token";

// localStorage can be unavailable or throw (private mode, blocked site data),
// so fall back to memory: the user stays logged in for the tab's lifetime.
let memoryToken = null;

export const tokenStore = {
  get() {
    try {
      return localStorage.getItem(KEY) ?? memoryToken;
    } catch {
      return memoryToken;
    }
  },
  set(token) {
    memoryToken = token;
    try {
      localStorage.setItem(KEY, token);
    } catch {
      // memory copy is enough
    }
  },
  clear() {
    memoryToken = null;
    try {
      localStorage.removeItem(KEY);
    } catch {
      // nothing stored to clear
    }
  },
};
