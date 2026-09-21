import { test as base, expect } from "@playwright/test";

export { expect };
export const API = "http://127.0.0.1:8000";
export const PASSWORD = "e2e-password-123";
export const KYOTO_ID = 1857910;
export const ADMIN_EMAIL = "e2e-admin@example.com"; // listed in ADMIN_EMAILS by serve_backend.py

let counter = 0;
const uniqueEmail = () => `e2e-${Date.now()}-${counter++}@example.com`;

export const test = base.extend({
  // Each test comes from its own made-up caller address, so the sign-in rate
  // limits (per address) never see one test's attempts as another's.
  address: async ({}, use) => {
    const n = Math.floor(Math.random() * 2 ** 24);
    await use(`10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`);
  },
  extraHTTPHeaders: async ({ address }, use) => {
    await use({ "X-Forwarded-For": address });
  },
  // Nothing outside this machine is ever contacted (photos, fonts, ...).
  context: async ({ context }, use) => {
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    await use(context);
  },
});

// A user made through the API. `token` is what the app keeps in localStorage.
export async function apiUser(request, address, email = uniqueEmail()) {
  const res = await request.post(`${API}/api/auth/register`, {
    headers: { "X-Forwarded-For": address },
    data: { email, password: PASSWORD },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  return { email, password: PASSWORD, token: body.access_token };
}

// The administrator. Registered on first use; a retried test finds the account
// already there, so it logs in instead.
export async function apiAdmin(request, address) {
  const headers = { "X-Forwarded-For": address };
  let res = await request.post(`${API}/api/auth/register`, { headers, data: { email: ADMIN_EMAIL, password: PASSWORD } });
  if (res.status() === 409) {
    res = await request.post(`${API}/api/auth/login`, { headers, data: { email: ADMIN_EMAIL, password: PASSWORD } });
    expect(res.status()).toBe(200);
  } else {
    expect(res.status()).toBe(201);
  }
  const body = await res.json();
  return { email: ADMIN_EMAIL, password: PASSWORD, token: body.access_token };
}

export async function apiLogin(request, address, email, password) {
  return request.post(`${API}/api/auth/login`, { headers: { "X-Forwarded-For": address }, data: { email, password } });
}

export async function apiTrip(request, user, name, geonameId = KYOTO_ID) {
  const res = await request.post(`${API}/api/trips`, {
    headers: { Authorization: `Bearer ${user.token}` },
    data: { name, geoname_id: geonameId },
  });
  expect(res.status()).toBe(201);
  return res.json();
}

// Sign a page in the way the app remembers a login (same key as
// frontend/src/auth/tokenStore.js).
export async function signInAs(page, user) {
  await page.addInitScript((token) => localStorage.setItem("tripplanner.token", token), user.token);
}

export async function logInThroughTheForm(page, email, password) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
}

// Add a day through the "Add a day" form.
export async function addDay(page, date, location) {
  const form = page.locator(".add-day-form");
  await form.getByLabel("Date").fill(date);
  await form.getByLabel("Location").fill(location);
  await form.getByRole("button", { name: "Add day" }).click();
  await expect(page.getByRole("heading", { name: "Day 1" })).toBeVisible();
}
