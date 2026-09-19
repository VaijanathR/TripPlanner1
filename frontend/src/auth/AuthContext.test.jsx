import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authApi } from "../api/auth";
import { ApiError, setUnauthorizedHandler } from "../api/client";
import { AuthProvider } from "./AuthContext";
import { tokenStore } from "./tokenStore";
import { useAuth } from "./useAuth";

vi.mock("../api/auth", () => ({
  authApi: { me: vi.fn(), login: vi.fn(), register: vi.fn(), google: vi.fn() },
}));
vi.mock("../api/client", async (importOriginal) => ({
  ...(await importOriginal()),
  setUnauthorizedHandler: vi.fn(),
}));

const alice = { id: 1, email: "alice@example.com" };

function Probe() {
  const auth = useAuth();
  return (
    <div>
      <p data-testid="status">{auth.status}</p>
      <p data-testid="email">{auth.user?.email ?? "-"}</p>
      <p data-testid="error">{auth.error ?? "-"}</p>
      <button onClick={() => auth.login("a@x.co", "pw").catch(() => {})}>login</button>
      <button onClick={() => auth.register("a@x.co", "pw")}>register</button>
      <button onClick={() => auth.loginWithGoogle("g-cred")}>google</button>
      <button onClick={auth.logout}>logout</button>
      <button onClick={auth.retry}>retry</button>
    </div>
  );
}

const renderProbe = () =>
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );
const status = () => screen.getByTestId("status").textContent;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  tokenStore.clear();
});

describe("AuthProvider: starting up", () => {
  it("is anonymous, without asking the server, when no token is stored", () => {
    renderProbe();

    expect(status()).toBe("anon");
    expect(authApi.me).not.toHaveBeenCalled();
  });

  it("checks a stored token and becomes logged in as that user", async () => {
    tokenStore.set("stored");
    authApi.me.mockResolvedValue(alice);
    renderProbe();

    expect(status()).toBe("loading");
    await waitFor(() => expect(status()).toBe("authed"));
    expect(screen.getByTestId("email")).toHaveTextContent("alice@example.com");
  });

  it("drops a stored token the server no longer accepts", async () => {
    tokenStore.set("expired");
    authApi.me.mockRejectedValue(new ApiError(401, "unauthenticated", "Authentication required"));
    renderProbe();

    await waitFor(() => expect(status()).toBe("anon"));
    expect(tokenStore.get()).toBeNull();
  });

  it("keeps the token and reports an error when the server can't be reached, then recovers on retry", async () => {
    tokenStore.set("still-good");
    authApi.me.mockRejectedValueOnce(new ApiError(0, "network_error", "Could not reach the server"));
    renderProbe();

    await waitFor(() => expect(status()).toBe("error"));
    expect(screen.getByTestId("error")).toHaveTextContent("Could not reach the server");
    expect(tokenStore.get()).toBe("still-good");

    authApi.me.mockResolvedValueOnce(alice);
    fireEvent.click(screen.getByText("retry"));

    await waitFor(() => expect(status()).toBe("authed"));
  });
});

describe("AuthProvider: logging in and out", () => {
  it.each([
    ["login", "login", "login"],
    ["register", "register", "register"],
    ["google", "google", "google"],
  ])("%s stores the token and becomes logged in", async (button, apiFn) => {
    authApi[apiFn].mockResolvedValue({ access_token: "new-token", user: alice });
    renderProbe();

    fireEvent.click(screen.getByText(button));

    await waitFor(() => expect(status()).toBe("authed"));
    expect(tokenStore.get()).toBe("new-token");
    expect(screen.getByTestId("email")).toHaveTextContent("alice@example.com");
  });

  it("passes the entered credentials through to the API", async () => {
    authApi.login.mockResolvedValue({ access_token: "t", user: alice });
    authApi.google.mockResolvedValue({ access_token: "t", user: alice });
    renderProbe();

    fireEvent.click(screen.getByText("login"));
    await waitFor(() => expect(authApi.login).toHaveBeenCalledWith("a@x.co", "pw"));
    fireEvent.click(screen.getByText("google"));
    await waitFor(() => expect(authApi.google).toHaveBeenCalledWith("g-cred"));
  });

  it("stays logged out, with no token stored, when login fails", async () => {
    authApi.login.mockRejectedValue(new ApiError(401, "invalid_credentials", "Incorrect email or password"));
    renderProbe();

    fireEvent.click(screen.getByText("login"));

    await waitFor(() => expect(authApi.login).toHaveBeenCalled());
    expect(status()).toBe("anon");
    expect(tokenStore.get()).toBeNull();
  });

  it("logging out clears the token and the user", async () => {
    tokenStore.set("stored");
    authApi.me.mockResolvedValue(alice);
    renderProbe();
    await waitFor(() => expect(status()).toBe("authed"));

    fireEvent.click(screen.getByText("logout"));

    expect(status()).toBe("anon");
    expect(screen.getByTestId("email")).toHaveTextContent("-");
    expect(tokenStore.get()).toBeNull();
  });

  it("ends the session when a logged-in request is rejected with 401", async () => {
    tokenStore.set("stored");
    authApi.me.mockResolvedValue(alice);
    renderProbe();
    await waitFor(() => expect(status()).toBe("authed"));
    const handler = setUnauthorizedHandler.mock.calls.map((c) => c[0]).findLast(Boolean);

    act(() => handler());

    expect(status()).toBe("anon");
    expect(tokenStore.get()).toBeNull();
  });
});

describe("useAuth", () => {
  it("refuses to be used outside an AuthProvider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<Probe />)).toThrow(/AuthProvider/);
  });
});
