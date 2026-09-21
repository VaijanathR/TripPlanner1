// End-to-end journeys for account deletion and the admin role (acceptance matrix
// N8, N9): a real browser against the real backend.
import { test, expect, apiUser, apiAdmin, apiLogin, apiTrip, signInAs, logInThroughTheForm, API } from "./helpers.js";

test("N8: a user deletes their own account after confirming, lands on Login and can no longer log in", async ({
  page,
  request,
  address,
}) => {
  const user = await apiUser(request, address);
  await apiTrip(request, user, "Trip that goes with the account");
  await signInAs(page, user);
  await page.goto("/");

  await page.getByRole("link", { name: "Account" }).click();
  await expect(page).toHaveURL("/account");
  await expect(page.getByText(user.email, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete my account" })).toBeDisabled(); // nothing typed yet

  // A wrong confirmation deletes nothing and keeps the user signed in.
  await page.getByLabel("Confirm with your password").fill("not-the-password");
  await page.getByRole("button", { name: "Delete my account" }).click();
  await expect(page.getByRole("alert")).toHaveText("That doesn't match. Nothing was deleted.");
  await expect(page).toHaveURL("/account");

  await page.getByLabel("Confirm with your password").fill(user.password);
  await page.getByRole("button", { name: "Delete my account" }).click();

  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("status")).toHaveText("Your account was deleted.");

  await logInThroughTheForm(page, user.email, user.password);
  await expect(page.getByRole("alert")).toHaveText("Incorrect email or password");
  const after = await apiLogin(request, address, user.email, user.password);
  expect(after.status()).toBe(401);
});

test("N9: an administrator deletes another account from the Admin page; a non-administrator has no Admin link and is refused", async ({
  page,
  request,
  address,
  browser,
}) => {
  const admin = await apiAdmin(request, address);
  const victim = await apiUser(request, address);
  await apiTrip(request, victim, "Victim's trip");

  await signInAs(page, admin);
  await page.goto("/");
  await page.getByRole("link", { name: "Admin" }).click();
  await expect(page).toHaveURL("/admin");

  const accounts = page.getByRole("list", { name: "Accounts" });
  const adminRow = accounts.getByRole("listitem").filter({ hasText: admin.email });
  await expect(adminRow.getByText("Admin", { exact: true })).toBeVisible();
  await expect(adminRow.getByRole("button")).toHaveCount(0); // an administrator can't be deleted

  const victimRow = accounts.getByRole("listitem").filter({ hasText: victim.email });
  await expect(victimRow).toContainText("1 trip");
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain(victim.email);
    dialog.accept();
  });
  await victimRow.getByRole("button", { name: `Delete account ${victim.email}` }).click();
  await expect(victimRow).toHaveCount(0);

  expect((await apiLogin(request, address, victim.email, victim.password)).status()).toBe(401);

  // A non-administrator: no Admin link, told they aren't allowed, and refused by the server.
  const other = await apiUser(request, address);
  const context = await browser.newContext();
  const stranger = await context.newPage();
  await stranger.addInitScript((token) => localStorage.setItem("tripplanner.token", token), other.token);
  await stranger.goto("/");
  await expect(stranger.getByRole("link", { name: "Account" })).toBeVisible();
  await expect(stranger.getByRole("link", { name: "Admin" })).toHaveCount(0);
  await stranger.goto("/admin");
  await expect(stranger.getByRole("alert")).toHaveText("You aren't allowed to see this page.");
  const refused = await request.get(`${API}/api/admin/users`, { headers: { Authorization: `Bearer ${other.token}` } });
  expect(refused.status()).toBe(403);
  await context.close();
});
