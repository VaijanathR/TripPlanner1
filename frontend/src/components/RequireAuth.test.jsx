import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "../auth/useAuth";
import RequireAuth from "./RequireAuth";

vi.mock("../auth/useAuth", () => ({ useAuth: vi.fn() }));

function LoginProbe() {
  const location = useLocation();
  return <p>LOGIN PAGE (from: {location.state?.from ?? "none"})</p>;
}

function renderGuarded(path = "/trips/5?tab=days") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<LoginProbe />} />
        <Route
          path="/trips/:id"
          element={
            <RequireAuth>
              <p>SECRET TRIP</p>
            </RequireAuth>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

const auth = (overrides) => ({ status: "anon", user: null, error: null, logout: vi.fn(), retry: vi.fn(), ...overrides });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RequireAuth", () => {
  it("shows a loading state, not the page and not a redirect, while the stored session is checked", () => {
    useAuth.mockReturnValue(auth({ status: "loading" }));
    renderGuarded();

    expect(screen.getByLabelText("Checking your session")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("SECRET TRIP")).not.toBeInTheDocument();
    expect(screen.queryByText(/LOGIN PAGE/)).not.toBeInTheDocument();
  });

  it("sends an anonymous visitor to /login and remembers where they were going", () => {
    useAuth.mockReturnValue(auth({ status: "anon" }));
    renderGuarded("/trips/5?tab=days");

    expect(screen.getByText("LOGIN PAGE (from: /trips/5?tab=days)")).toBeInTheDocument();
    expect(screen.queryByText("SECRET TRIP")).not.toBeInTheDocument();
  });

  it("does not remember the page after an account deletion (there is no account to go back as)", () => {
    useAuth.mockReturnValue(auth({ status: "anon", notice: "Your account was deleted." }));
    renderGuarded("/trips/5");

    expect(screen.getByText("LOGIN PAGE (from: none)")).toBeInTheDocument();
  });

  it("shows the page, and who is logged in, for a logged-in user", () => {
    useAuth.mockReturnValue(auth({ status: "authed", user: { id: 1, email: "alice@example.com" } }));
    renderGuarded();

    expect(screen.getByText("SECRET TRIP")).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
  });

  it("logs out from the user bar", () => {
    const logout = vi.fn();
    useAuth.mockReturnValue(auth({ status: "authed", user: { id: 1, email: "alice@example.com" }, logout }));
    renderGuarded();

    fireEvent.click(screen.getByRole("button", { name: "Log out" }));

    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("offers Retry, rather than a login screen, when the server couldn't be reached", () => {
    const retry = vi.fn();
    useAuth.mockReturnValue(auth({ status: "error", error: "Could not reach the server", retry }));
    renderGuarded();

    expect(screen.getByText(/Couldn't check your session: Could not reach the server/)).toBeInTheDocument();
    expect(screen.queryByText(/LOGIN PAGE/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
