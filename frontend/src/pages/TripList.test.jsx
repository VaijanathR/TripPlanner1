import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TripList, { NOTICE_MS } from "./TripList";
import { tripsApi } from "../api/trips";

vi.mock("../api/trips", () => ({
  tripsApi: {
    list: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
  },
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => mockNavigate };
});

function renderTripList() {
  return render(
    <MemoryRouter>
      <TripList />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TripList", () => {
  it("shows the empty state when there are no trips", async () => {
    tripsApi.list.mockResolvedValue({ trips: [] });
    renderTripList();

    expect(await screen.findByText("No trips yet.")).toBeInTheDocument();
  });

  it("renders a card per trip with derived date range and day count", async () => {
    tripsApi.list.mockResolvedValue({
      trips: [
        { id: 1, name: "Kyoto in Autumn", start_date: "2026-11-03", end_date: "2026-11-05", day_count: 2 },
      ],
    });
    renderTripList();

    expect(await screen.findByText("Kyoto in Autumn")).toBeInTheDocument();
    expect(screen.getByText("2026-11-03 – 2026-11-05 · 2 days")).toBeInTheDocument();
  });

  it("shows an error state with retry when the fetch fails", async () => {
    tripsApi.list.mockRejectedValue(new Error("network error"));
    renderTripList();

    expect(await screen.findByText(/Couldn't load your trips: network error/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("navigates to the new trip after a successful create", async () => {
    tripsApi.list.mockResolvedValue({ trips: [] });
    tripsApi.create.mockResolvedValue({ id: 42, name: "New Trip" });
    renderTripList();

    await screen.findByText("No trips yet.");
    fireEvent.change(screen.getByPlaceholderText("New trip name"), { target: { value: "New Trip" } });
    fireEvent.click(screen.getByRole("button", { name: "Create trip" }));

    await waitFor(() => expect(tripsApi.create).toHaveBeenCalledWith("New Trip"));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/trips/42"));
  });

  it("removes a trip card after a successful delete", async () => {
    tripsApi.list.mockResolvedValue({
      trips: [{ id: 1, name: "Kyoto in Autumn", start_date: null, end_date: null, day_count: 0 }],
    });
    tripsApi.remove.mockResolvedValue(null);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderTripList();
    await screen.findByText("Kyoto in Autumn");

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(screen.queryByText("Kyoto in Autumn")).not.toBeInTheDocument());
    expect(await screen.findByText("No trips yet.")).toBeInTheDocument();
  });

  it("shows a loading skeleton in place of the trip cards while the list is being fetched", () => {
    tripsApi.list.mockReturnValue(new Promise(() => {}));
    renderTripList();

    const skeleton = screen.getByRole("list");
    expect(skeleton).toHaveAttribute("aria-busy", "true");
    expect(skeleton.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
    expect(screen.queryByText("No trips yet.")).not.toBeInTheDocument();
  });

  it("offers a 'Create your first trip' call to action in the empty state that focuses the name field", async () => {
    tripsApi.list.mockResolvedValue({ trips: [] });
    renderTripList();

    fireEvent.click(await screen.findByRole("button", { name: "Create your first trip" }));

    expect(screen.getByPlaceholderText("New trip name")).toHaveFocus();
  });

  it("does not show the empty state when there are trips", async () => {
    tripsApi.list.mockResolvedValue({
      trips: [{ id: 1, name: "Kyoto in Autumn", start_date: "2026-11-03", end_date: "2026-11-03", day_count: 1 }],
    });
    renderTripList();

    expect(await screen.findByText("2026-11-03 – 2026-11-03 · 1 day")).toBeInTheDocument();
    expect(screen.queryByText("No trips yet.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create your first trip" })).not.toBeInTheDocument();
  });

  it("shows 'No days yet' on a card for a trip without days", async () => {
    tripsApi.list.mockResolvedValue({
      trips: [{ id: 1, name: "Empty trip", start_date: null, end_date: null, day_count: 0 }],
    });
    renderTripList();

    expect(await screen.findByText("No days yet")).toBeInTheDocument();
  });

  it("recovers when Retry is clicked after a failed fetch", async () => {
    tripsApi.list.mockRejectedValueOnce(new Error("network error"));
    renderTripList();
    await screen.findByText(/Couldn't load your trips/);

    tripsApi.list.mockResolvedValueOnce({
      trips: [{ id: 1, name: "Kyoto in Autumn", start_date: null, end_date: null, day_count: 0 }],
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Kyoto in Autumn")).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't load your trips/)).not.toBeInTheDocument();
    expect(tripsApi.list).toHaveBeenCalledTimes(2);
  });

  it("does not delete anything when the confirmation is declined", async () => {
    tripsApi.list.mockResolvedValue({
      trips: [{ id: 1, name: "Kyoto in Autumn", start_date: null, end_date: null, day_count: 0 }],
    });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderTripList();
    await screen.findByText("Kyoto in Autumn");

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(tripsApi.remove).not.toHaveBeenCalled();
    expect(screen.getByText("Kyoto in Autumn")).toBeInTheDocument();
  });

  it("shows a brief confirmation naming the trip after a successful delete, then hides it", async () => {
    tripsApi.list.mockResolvedValue({
      trips: [{ id: 1, name: "Kyoto in Autumn", start_date: null, end_date: null, day_count: 0 }],
    });
    tripsApi.remove.mockResolvedValue(null);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderTripList();
    await screen.findByText("Kyoto in Autumn");

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Deleted “Kyoto in Autumn”");
    // ...and it is brief: it goes away on its own.
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument(), {
      timeout: NOTICE_MS + 2000,
    });
  }, NOTICE_MS + 6000);

  it("keeps the card, shows the error on that card only, and leaves the rest of the list interactive when a delete fails", async () => {
    tripsApi.list.mockResolvedValue({
      trips: [
        { id: 1, name: "Kyoto in Autumn", start_date: null, end_date: null, day_count: 0 },
        { id: 2, name: "Lisbon Weekend", start_date: null, end_date: null, day_count: 0 },
      ],
    });
    tripsApi.remove.mockRejectedValue(new Error("could not delete"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderTripList();
    await screen.findByText("Kyoto in Autumn");

    const kyotoCard = screen.getByText("Kyoto in Autumn").closest("li");
    const lisbonCard = screen.getByText("Lisbon Weekend").closest("li");
    fireEvent.click(within(kyotoCard).getByRole("button", { name: "Delete" }));

    expect(await within(kyotoCard).findByText("could not delete")).toBeInTheDocument();
    expect(within(lisbonCard).queryByText("could not delete")).not.toBeInTheDocument();
    expect(screen.getByText("Kyoto in Autumn")).toBeInTheDocument();
    expect(within(lisbonCard).getByRole("button", { name: "Delete" })).toBeEnabled();
    expect(within(kyotoCard).getByRole("button", { name: "Delete" })).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows an inline error and stays on the list when creating a trip fails", async () => {
    tripsApi.list.mockResolvedValue({ trips: [] });
    tripsApi.create.mockRejectedValue(new Error("name already taken"));
    renderTripList();
    await screen.findByText("No trips yet.");

    fireEvent.change(screen.getByPlaceholderText("New trip name"), { target: { value: "Dup" } });
    fireEvent.click(screen.getByRole("button", { name: "Create trip" }));

    expect(await screen.findByText("name already taken")).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText("New trip name")).toHaveValue("Dup");
  });
});
