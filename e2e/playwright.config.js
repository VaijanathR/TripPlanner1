import { defineConfig } from "@playwright/test";

const APP = "http://127.0.0.1:4173";
const API = "http://127.0.0.1:8000";
// CI has `python` on the PATH; locally point this at backend/venv/bin/python.
const python = process.env.E2E_PYTHON ?? "python";

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: APP,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // Always started fresh (never reused), so every run has an empty database and
  // an untouched rate limiter.
  webServer: [
    {
      command: `"${python}" serve_backend.py`,
      url: `${API}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // A production build, as deployed (the dev server on /mnt/d does not see edits).
      command: "npm run build && npx vite preview --host 127.0.0.1 --port 4173 --strictPort",
      cwd: "../frontend",
      env: { VITE_API_URL: API },
      url: APP,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
