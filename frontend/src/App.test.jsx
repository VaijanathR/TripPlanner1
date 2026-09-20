import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { authApi } from "./api/auth";
import { sharingApi } from "./api/sharing";
import { tripsApi } from "./api/trips";
import { AuthProvider } from "./auth/AuthContext";
import { tokenStore } from "./auth/tokenStore";

vi.mock("./api/auth", () => ({
  authApi: { me: vi.fn(), login: vi.fn(), register: vi.fn(), google: vi.fn() },
}));
vi.mock("./api/trips", () => ({ tripsApi: { list: vi.fn(), get: vi.fn(), create: vi.fn(), remove: vi.fn() } }));
vi.mock("./api/sharing", () => ({ sharingApi: { read: vi.fn(), conditions: vi.fn(), create: vi.fn() } }));
vi.mock("./components/GoogleSignInButton", () => ({ default: () => null }));

const alice = { id: 1, email: "alice@example.com" };

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
