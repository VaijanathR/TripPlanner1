import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "../auth/useAuth";
import UserBar from "./UserBar";

vi.mock("../auth/useAuth", () => ({ useAuth: vi.fn() }));

const renderBar = (user) => {
  useAuth.mockReturnValue({ user, logout: vi.fn() });
  return render(
    <MemoryRouter>
      <UserBar />
    </MemoryRouter>
  );
};

beforeEach(() => vi.clearAllMocks());

describe("UserBar", () => {
  it("shows who is signed in, an Account link and Log out", () => {
    renderBar({ id: 1, email: "alice@example.com", is_admin: false, has_password: true });

    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute("href", "/account");
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
  });

  it("shows no Admin link to someone who is not an administrator", () => {
    renderBar({ id: 1, email: "alice@example.com", is_admin: false, has_password: true });

    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
  });

  it("shows an Admin link to an administrator", () => {
    renderBar({ id: 2, email: "boss@example.com", is_admin: true, has_password: true });

    expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute("href", "/admin");
  });
});
