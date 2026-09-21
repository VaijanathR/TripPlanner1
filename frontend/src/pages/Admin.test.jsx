import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminApi } from "../api/admin";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/useAuth";
import Admin from "./Admin";

vi.mock("../auth/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../api/admin", () => ({ adminApi: { users: vi.fn(), remove: vi.fn() } }));

const boss = { id: 9, email: "boss@example.com", is_admin: true, has_password: true };
const accounts = [
  { id: 1, email: "alice@example.com", created_at: "2026-09-20T10:00:00Z", trip_count: 2, is_admin: false },
  { id: 2, email: "bob@example.com", created_at: "2026-09-21T11:30:00Z", trip_count: 1, is_admin: false },
  { id: 9, email: "boss@example.com", created_at: "2026-09-21T12:00:00Z", trip_count: 0, is_admin: true },
];

function renderAdmin(user = boss) {
  useAuth.mockReturnValue({ user });
  return render(
    <MemoryRouter>
      <Admin />
    </MemoryRouter>
  );
}

const list = () => screen.findByRole("list", { name: "Accounts" });
const rowFor = async (email) => within(await list()).getByText(email).closest("li");

beforeEach(() => {
  vi.clearAllMocks();
  adminApi.users.mockResolvedValue({ users: accounts });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("Admin screen: who can see it", () => {
  it("tells a non-administrator they aren't allowed and asks the server for nothing", () => {
    renderAdmin({ ...boss, is_admin: false });

    expect(screen.getByRole("alert")).toHaveTextContent("You aren't allowed to see this page.");
    expect(adminApi.users).not.toHaveBeenCalled();
    expect(screen.queryByRole("list", { name: "Accounts" })).not.toBeInTheDocument();
  });

  it("tells an administrator whose rights were just removed that they aren't allowed (the server said 403)", async () => {
    adminApi.users.mockRejectedValue(new ApiError(403, "forbidden", "Administrator access is required"));
    renderAdmin();

    expect(await screen.findByRole("alert")).toHaveTextContent("You aren't allowed to see this page.");
    expect(screen.queryByRole("list", { name: "Accounts" })).not.toBeInTheDocument();
  });
});

describe("Admin screen: the account list", () => {
  it("lists every account with its email, when it was created and how many trips it has", async () => {
    renderAdmin();

    const items = within(await list()).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("alice@example.com");
    expect(items[0]).toHaveTextContent("Joined 2026-09-20 · 2 trips");
    expect(items[1]).toHaveTextContent("Joined 2026-09-21 · 1 trip");
    expect(items[2]).toHaveTextContent("0 trips");
  });

  it("marks administrator accounts and gives them no Delete button", async () => {
    renderAdmin();

    const bossRow = await rowFor("boss@example.com");
    expect(within(bossRow).getByText("Admin")).toBeInTheDocument();
    expect(within(bossRow).queryByRole("button")).not.toBeInTheDocument();
    const aliceRow = await rowFor("alice@example.com");
    expect(within(aliceRow).queryByText("Admin")).not.toBeInTheDocument();
    expect(within(aliceRow).getByRole("button", { name: "Delete account alice@example.com" })).toBeInTheDocument();
  });

  it("shows no password data and no trip content", async () => {
    const { container } = renderAdmin();
    await list();

    expect(container.textContent).not.toMatch(/password|scrypt|google/i);
  });

  it("offers a Retry when the list can't be loaded", async () => {
    adminApi.users.mockRejectedValueOnce(new ApiError(0, "network_error", "Could not reach the server"));
    renderAdmin();

    expect(await screen.findByText(/Couldn't load the accounts: Could not reach the server/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await list()).toBeInTheDocument();
  });
});

describe("Admin screen: deleting an account", () => {
  it("asks for confirmation naming the email, and deletes nothing if the answer is no", async () => {
    window.confirm.mockReturnValue(false);
    renderAdmin();

    fireEvent.click(within(await rowFor("alice@example.com")).getByRole("button"));

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("alice@example.com"));
    expect(adminApi.remove).not.toHaveBeenCalled();
    expect(await rowFor("alice@example.com")).toBeInTheDocument();
  });

  it("removes the account from the list once the server has deleted it", async () => {
    adminApi.remove.mockResolvedValue(null);
    renderAdmin();

    fireEvent.click(within(await rowFor("alice@example.com")).getByRole("button"));

    await waitFor(() => expect(within(screen.getByRole("list", { name: "Accounts" })).queryByText("alice@example.com")).toBeNull());
    expect(adminApi.remove).toHaveBeenCalledWith(1);
    expect(within(screen.getByRole("list", { name: "Accounts" })).getByText("bob@example.com")).toBeInTheDocument();
  });

  it("shows the server's refusal and leaves the list unchanged", async () => {
    adminApi.remove.mockRejectedValue(
      new ApiError(409, "admin_account_protected", "Administrator accounts can't be deleted.")
    );
    renderAdmin();

    fireEvent.click(within(await rowFor("bob@example.com")).getByRole("button"));

    const row = await rowFor("bob@example.com");
    expect(await within(row).findByRole("alert")).toHaveTextContent("Administrator accounts can't be deleted.");
    expect(within(screen.getByRole("list", { name: "Accounts" })).getAllByRole("listitem")).toHaveLength(3);
  });
});
