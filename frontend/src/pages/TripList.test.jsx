import { render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TripList from "./TripList";
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
});
