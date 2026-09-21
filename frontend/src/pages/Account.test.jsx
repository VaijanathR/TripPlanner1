import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authApi } from "../api/auth";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/useAuth";
import Account from "./Account";

vi.mock("../auth/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../api/auth", () => ({ authApi: { deleteAccount: vi.fn() } }));

const logout = vi.fn();
const alice = { id: 1, email: "alice@example.com", is_admin: false, has_password: true };

function renderAccount(user = alice) {
  useAuth.mockReturnValue({ user, logout });
  return render(
    <MemoryRouter initialEntries={["/account"]}>
      <Routes>
        <Route path="/account" element={<Account />} />
      </Routes>
    </MemoryRouter>
  );
}

const typeConfirmation = (value) =>
  fireEvent.change(screen.getByLabelText(/confirm/i), { target: { value } });
const deleteButton = () => screen.getByRole("button", { name: "Delete my account" });

beforeEach(() => vi.clearAllMocks());

describe("Account screen", () => {
  it("shows the signed-in email", () => {
    renderAccount();

    expect(screen.getByRole("heading", { name: "Account" })).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
  });

  it("explains what will be deleted and asks for the password, with the button disabled until it is filled", () => {
    renderAccount();

    expect(screen.getByRole("heading", { name: "Delete my account" })).toBeInTheDocument();
    expect(screen.getByText(/all of your trips and their share links/)).toBeInTheDocument();
    expect(screen.getByText(/cannot be undone/)).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm with your password")).toHaveAttribute("type", "password");
    expect(deleteButton()).toBeDisabled();

    typeConfirmation("secret-1");
    expect(deleteButton()).toBeEnabled();
    typeConfirmation("");
    expect(deleteButton()).toBeDisabled();
  });

  it("deletes nothing before the button is pressed", () => {
    renderAccount();
    typeConfirmation("secret-1");

    expect(authApi.deleteAccount).not.toHaveBeenCalled();
    expect(logout).not.toHaveBeenCalled();
  });

  it("asks a password-less (Google-only) account to type its own email instead", () => {
    renderAccount({ ...alice, has_password: false });

    const field = screen.getByLabelText("Type your email address to confirm");
    expect(field).toHaveAttribute("type", "text");
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });

  it("sends the confirmation, then ends the session with a notice that the account was deleted", async () => {
    authApi.deleteAccount.mockResolvedValue(null);
    renderAccount();
    typeConfirmation("secret-1");

    fireEvent.click(deleteButton());

    await waitFor(() => expect(logout).toHaveBeenCalledWith({ notice: "Your account was deleted." }));
    expect(authApi.deleteAccount).toHaveBeenCalledWith("secret-1");
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("shows a wrong confirmation as 'Nothing was deleted', stays signed in and lets the user try again", async () => {
    authApi.deleteAccount.mockRejectedValue(
      new ApiError(403, "confirmation_failed", "That doesn't match. Nothing was deleted.")
    );
    renderAccount();
    typeConfirmation("wrong");

    fireEvent.click(deleteButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("That doesn't match. Nothing was deleted.");
    expect(logout).not.toHaveBeenCalled();
    expect(deleteButton()).toBeEnabled();
  });

  it("shows the 'try again in N minutes' message when the attempts are locked", async () => {
    authApi.deleteAccount.mockRejectedValue(
      new ApiError(429, "too_many_attempts", "Too many attempts. Try again in 12 minutes.")
    );
    renderAccount();
    typeConfirmation("anything");

    fireEvent.click(deleteButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("Try again in 12 minutes.");
    expect(logout).not.toHaveBeenCalled();
  });

  it("does not send a second request while the first is still running", async () => {
    let finish;
    authApi.deleteAccount.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderAccount();
    typeConfirmation("secret-1");

    fireEvent.click(deleteButton());
    expect(screen.getByRole("button", { name: "Deleting…" })).toBeDisabled();
    fireEvent.submit(screen.getByLabelText(/confirm/i, { selector: "input" }).closest("form"));

    expect(authApi.deleteAccount).toHaveBeenCalledTimes(1);
    finish(null);
    await waitFor(() => expect(logout).toHaveBeenCalled());
  });

  it("gives an administrator no form, only the reason", () => {
    renderAccount({ ...alice, is_admin: true });

    expect(screen.getByText(/Administrator accounts can't be deleted here/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete my account" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/confirm/i)).not.toBeInTheDocument();
  });
});
