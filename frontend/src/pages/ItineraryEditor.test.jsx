import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ItineraryEditor from "./ItineraryEditor";
import { tripsApi } from "../api/trips";

vi.mock("../api/trips", () => ({
  tripsApi: { get: vi.fn() },
}));
vi.mock("../api/days", () => ({
  daysApi: { create: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn() },
}));
vi.mock("../components/DayEditor", () => ({
  default: ({ day }) => <div data-testid="day-editor">{day.location}</div>,
}));

function renderEditor() {
  return render(
    <MemoryRouter initialEntries={["/trips/1"]}>
      <Routes>
        <Route path="/trips/:tripId" element={<ItineraryEditor />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ItineraryEditor", () => {
  it("shows the empty-days state when the trip has no days", async () => {
    tripsApi.get.mockResolvedValue({ id: 1, name: "Kyoto in Autumn", days: [] });
    renderEditor();

    expect(await screen.findByText("Kyoto in Autumn")).toBeInTheDocument();
    expect(screen.getByText("No days added yet.")).toBeInTheDocument();
  });

  it("renders a DayEditor per day when the trip has days", async () => {
    tripsApi.get.mockResolvedValue({
      id: 1,
      name: "Kyoto in Autumn",
      days: [
        { id: 10, location: "Kyoto, Japan", date: "2026-11-03", notes: null, activities: [] },
        { id: 11, location: "Osaka, Japan", date: "2026-11-04", notes: null, activities: [] },
      ],
    });
    renderEditor();

    const dayEditors = await screen.findAllByTestId("day-editor");
    expect(dayEditors).toHaveLength(2);
    expect(screen.queryByText("No days added yet.")).not.toBeInTheDocument();
  });

  it("shows an error state with retry when the fetch fails", async () => {
    tripsApi.get.mockRejectedValue(new Error("network error"));
    renderEditor();

    expect(await screen.findByText(/Couldn't load this trip: network error/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("offers a Get share link action for the trip", async () => {
    tripsApi.get.mockResolvedValue({ id: 1, name: "Kyoto in Autumn", days: [] });
    renderEditor();

    expect(await screen.findByRole("button", { name: "Get share link" })).toBeInTheDocument();
  });
});
