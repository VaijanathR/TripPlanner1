import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { adminApi } from "./api/admin";
import { authApi } from "./api/auth";
import { sharingApi } from "./api/sharing";
import { tripsApi } from "./api/trips";
import { AuthProvider } from "./auth/AuthContext";
import { tokenStore } from "./auth/tokenStore";

vi.mock("./api/auth", () => ({
  authApi: { me: vi.fn(), login: vi.fn(), register: vi.fn(), google: vi.fn() },
}));
vi.mock("./api/admin", () => ({ adminApi: { users: vi.fn(), remove: vi.fn() } }));
vi.mock("./api/trips", () => ({ tripsApi: { list: vi.fn(), get: vi.fn(), create: vi.fn(), remove: vi.fn() } }));
vi.mock("./api/sharing", () => ({ sharingApi: { read: vi.fn(), conditions: vi.fn(), create: vi.fn() } }));
vi.mock("./components/GoogleSignInButton", () => ({ default: () => null }));

const alice = { id: 1, email: "alice@example.com", is_admin: false, has_password: true };
const boss = { id: 9, email: "boss@example.com", is_admin: true, has_password: true };

function renderApp(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  tokenStore.clear();
  tripsApi.list.mockResolvedValue({ trips: [] });
  tripsApi.get.mockResolvedValue({ id: 5, name: "Kyoto in Autumn", days: [] });
  sharingApi.read.mockResolvedValue({ id: 1, name: "Shared Kyoto trip", days: [] });
});

describe("App: the Account and Admin addresses", () => {
  it.each(["/account", "/admin"])("sends an anonymous visitor from %s to the login page and asks for nothing", async (path) => {
    renderApp(path);

    expect(await screen.findByRole("tab", { name: "Log in" })).toBeInTheDocument();
    expect(adminApi.users).not.toHaveBeenCalled();
  });

  it("tells a signed-in non-administrator who opens /admin that they aren't allowed, without asking the server", async () => {
    tokenStore.set("tok");
    authApi.me.mockResolvedValue(alice);
    renderApp("/admin");

    expect(await screen.findByText("You aren't allowed to see this page.")).toBeInTheDocument();
    expect(adminApi.users).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
  });

  it("shows an administrator the accounts at /admin, with the Admin link in the top bar", async () => {
    tokenStore.set("tok");
    authApi.me.mockResolvedValue(boss);
    adminApi.users.mockResolvedValue({
      users: [{ id: 9, email: "boss@example.com", created_at: "2026-09-21T12:00:00Z", trip_count: 0, is_admin: true }],
    });
    renderApp("/admin");

    expect(await screen.findByRole("list", { name: "Accounts" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute("href", "/admin");
  });

  it("opens the Account screen for a signed-in user", async () => {
    tokenStore.set("tok");
    authApi.me.mockResolvedValue(alice);
    renderApp("/account");

    expect(await screen.findByRole("heading", { name: "Delete my account" })).toBeInTheDocument();
  });
});

describe("App: who can reach what", () => {
  it("sends an anonymous visitor from the trip list to the login page without loading any trips", async () => {
    renderApp("/");

    expect(await screen.findByRole("tab", { name: "Log in" })).toBeInTheDocument();
    expect(tripsApi.list).not.toHaveBeenCalled();
  });

  it("sends an anonymous visitor from a trip to login, and back to that trip after logging in", async () => {
    authApi.login.mockResolvedValue({ access_token: "tok", user: alice });
    renderApp("/trips/5");
    await screen.findByRole("tab", { name: "Log in" });
    expect(tripsApi.get).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "alice@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct-horse" } });
    fireEvent.submit(screen.getByLabelText("Email").closest("form"));

    expect(await screen.findByText("Kyoto in Autumn")).toBeInTheDocument();
    expect(tokenStore.get()).toBe("tok");
  });

  it("shows the trip list, and who is logged in, to a returning user with a valid stored session", async () => {
    tokenStore.set("stored");
    authApi.me.mockResolvedValue(alice);

    renderApp("/");

    expect(await screen.findByText("No trips yet.")).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
  });

  it("logging out returns to the login page and forgets the session", async () => {
    tokenStore.set("stored");
    authApi.me.mockResolvedValue(alice);
    renderApp("/");
    await screen.findByText("No trips yet.");

    fireEvent.click(screen.getByRole("button", { name: "Log out" }));

    expect(await screen.findByRole("tab", { name: "Log in" })).toBeInTheDocument();
    expect(tokenStore.get()).toBeNull();
    expect(screen.queryByText("No trips yet.")).not.toBeInTheDocument();
  });

  it("treats a stored session the server rejects as logged out", async () => {
    tokenStore.set("expired");
    authApi.me.mockRejectedValue(Object.assign(new Error("Authentication required"), { status: 401 }));

    renderApp("/");

    expect(await screen.findByRole("tab", { name: "Log in" })).toBeInTheDocument();
    expect(tripsApi.list).not.toHaveBeenCalled();
    expect(tokenStore.get()).toBeNull();
  });

  it("does not show the login page to someone who is already logged in", async () => {
    tokenStore.set("stored");
    authApi.me.mockResolvedValue(alice);

    renderApp("/login");

    expect(await screen.findByText("No trips yet.")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Log in" })).not.toBeInTheDocument();
  });

  it("lets anyone open the photo credits without logging in", async () => {
    renderApp("/credits");

    expect(await screen.findByRole("heading", { name: "Photo credits" })).toBeInTheDocument();
    expect(authApi.me).not.toHaveBeenCalled();
  });

  it("lets anyone open a share link without logging in", async () => {
    renderApp("/share/tok-1");

    expect(await screen.findByText("Shared Kyoto trip")).toBeInTheDocument();
    expect(authApi.me).not.toHaveBeenCalled();
    await waitFor(() => expect(sharingApi.read).toHaveBeenCalledWith("tok-1"));
  });
});

describe("App: Photo credits link on every screen", () => {
  const link = () => screen.getByRole("link", { name: "Photo credits" });

  it("is on the login page", async () => {
    renderApp("/login");
    await screen.findByRole("tab", { name: "Log in" });
    expect(link()).toHaveAttribute("href", "/credits");
  });

  it("is on the trip list", async () => {
    tokenStore.set("stored");
    authApi.me.mockResolvedValue(alice);
    renderApp("/");
    await screen.findByText("No trips yet.");
    expect(link()).toHaveAttribute("href", "/credits");
  });

  it("is on a trip", async () => {
    tokenStore.set("stored");
    authApi.me.mockResolvedValue(alice);
    renderApp("/trips/5");
    await screen.findByText("Kyoto in Autumn");
    expect(link()).toHaveAttribute("href", "/credits");
  });

  it("is on a shared trip", async () => {
    renderApp("/share/tok-1");
    await screen.findByText("Shared Kyoto trip");
    expect(link()).toHaveAttribute("href", "/credits");
  });

  it("is on the credits page itself", async () => {
    renderApp("/credits");
    await screen.findByRole("heading", { name: "Photo credits" });
    expect(link()).toHaveAttribute("href", "/credits");
  });

  it("opens the credits from the login page", async () => {
    renderApp("/login");
    await screen.findByRole("tab", { name: "Log in" });
    fireEvent.click(link());
    expect(await screen.findByRole("heading", { name: "Photo credits" })).toBeInTheDocument();
  });
});
