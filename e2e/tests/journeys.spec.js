// End-to-end journeys (acceptance matrix N1-N6): a real browser against the real
// backend. Upstream services are faked (see ../serve_backend.py).
import { test, expect, API, PASSWORD, apiUser, apiTrip, signInAs, logInThroughTheForm, addDay } from "./helpers.js";

const email = () => `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

test("N1: a visitor signs up, stays signed in after a reload, logs out and logs in again", async ({ page }) => {
  const me = email();
  await page.goto("/login");
  await page.getByRole("tab", { name: "Create account" }).click();
  await page.getByLabel("Email").fill(me);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Where to next?" })).toBeVisible();
  await expect(page.locator(".user-email")).toHaveText(me);

  await page.reload();
  await expect(page.locator(".user-email")).toHaveText(me); // still signed in

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);

  await logInThroughTheForm(page, me, PASSWORD);
  await expect(page).toHaveURL("/");
  await expect(page.locator(".user-email")).toHaveText(me);
});

test("N2: a wrong password shows an error, and repeated wrong attempts lock the account for a while", async ({
  page,
  request,
  address,
}) => {
  const user = await apiUser(request, address);
  await page.goto("/login");

  await logInThroughTheForm(page, user.email, "not-the-password");
  await expect(page.getByRole("alert")).toHaveText("Incorrect email or password");

  for (let i = 0; i < 2; i++) {
    await logInThroughTheForm(page, user.email, "not-the-password");
    await expect(page.getByRole("alert")).toHaveText("Incorrect email or password");
  }

  // Three failures are used up: even the right password is now refused.
  await logInThroughTheForm(page, user.email, user.password);
  await expect(page.getByRole("alert")).toContainText(/try again in \d+ minutes?/i);
  await expect(page).toHaveURL(/\/login/);
});

test("N3: a signed-in user creates a trip with a place, adds an activity and still sees it after a reload", async ({
  page,
  request,
  address,
}) => {
  const user = await apiUser(request, address);
  await signInAs(page, user);
  await page.goto("/");

  await page.getByLabel("Trip name").fill("Kyoto in Autumn");
  const create = page.locator(".create-place");
  await create.getByLabel("Country").fill("Japan");
  await create.getByLabel("City").fill("Kyoto");
  await create.getByRole("button", { name: "Find place" }).click();
  await create.getByRole("list", { name: "Matching places" }).getByRole("button").first().click();
  await expect(page.getByText("Destination: Kyoto, Kyoto, Japan")).toBeVisible();
  await page.getByRole("button", { name: "Create trip" }).click();

  await expect(page).toHaveURL(/\/trips\/\d+$/);
  await expect(page.getByRole("heading", { name: "Kyoto in Autumn" })).toBeVisible();

  await page.getByRole("tab", { name: "Itinerary" }).click();
  await addDay(page, "2026-10-10", "Kyoto Station");
  await page.getByRole("button", { name: "Add activity" }).click();
  await page.getByPlaceholder("Title").fill("Fushimi Inari at dawn");
  const times = page.locator(".activity-row input[type=time]");
  await times.nth(0).fill("06:00");
  await times.nth(1).fill("08:00");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved")).toBeVisible();

  await page.reload();
  await page.getByRole("tab", { name: "Itinerary" }).click();
  await expect(page.getByPlaceholder("Title")).toHaveValue("Fushimi Inari at dawn");
});

test("N4: the Discover tab shows the guide and adding a place puts it in the itinerary", async ({
  page,
  request,
  address,
}) => {
  const user = await apiUser(request, address);
  const trip = await apiTrip(request, user, "Kyoto guide");
  await signInAs(page, user);
  await page.goto(`/trips/${trip.id}`);

  await page.getByRole("tab", { name: "Itinerary" }).click();
  await addDay(page, "2026-10-11", "Kyoto");

  await page.getByRole("tab", { name: "Discover Kyoto" }).click();
  // The guide is built in the background and polled every 3 s; allow for a slow build.
  await expect(page.getByRole("heading", { name: "Popular places in Kyoto" })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("heading", { name: "Kiyomizu-dera" })).toBeVisible();

  await page.getByRole("button", { name: "Add Kiyomizu-dera to itinerary" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Kiyomizu-dera" })).toBeVisible();

  await page.getByRole("tab", { name: "Itinerary" }).click();
  await expect(page.getByPlaceholder("Title")).toHaveValue("Kiyomizu-dera");
});

test("N5: a share link opens the read-only view without a login, and another user cannot open the trip", async ({
  page,
  request,
  address,
  browser,
}) => {
  const owner = await apiUser(request, address);
  const trip = await apiTrip(request, owner, "Shared Kyoto");
  await signInAs(page, owner);
  await page.goto(`/trips/${trip.id}`);
  await page.getByRole("button", { name: "Get share link" }).click();
  const link = await page.getByLabel("Share link").inputValue();
  expect(link).toMatch(/\/share\/.+/);

  // A visitor with no login at all.
  const visitor = await browser.newContext();
  const visitorPage = await visitor.newPage();
  await visitorPage.goto(link);
  await expect(visitorPage.getByRole("heading", { name: "Shared Kyoto" })).toBeVisible();
  await expect(visitorPage.locator("input, textarea, select")).toHaveCount(0); // read-only
  await visitor.close();

  // Another signed-in user: the trip looks like it does not exist.
  const other = await apiUser(request, address);
  const strangerContext = await browser.newContext();
  const stranger = await strangerContext.newPage();
  await stranger.addInitScript((token) => localStorage.setItem("tripplanner.token", token), other.token);
  await stranger.goto(`/trips/${trip.id}`);
  await expect(stranger.getByText(/Couldn't load this trip/)).toBeVisible();
  await expect(stranger.getByRole("heading", { name: "Shared Kyoto" })).toHaveCount(0);
  await strangerContext.close();
});

test("N6: an anonymous visitor opening a trip is sent to Login and returned to that trip", async ({
  page,
  request,
  address,
}) => {
  const user = await apiUser(request, address);
  const trip = await apiTrip(request, user, "Return trip");

  await page.goto(`/trips/${trip.id}`);
  await expect(page).toHaveURL(/\/login/);

  await logInThroughTheForm(page, user.email, user.password);
  await expect(page).toHaveURL(`/trips/${trip.id}`);
  await expect(page.getByRole("heading", { name: "Return trip" })).toBeVisible();
});
