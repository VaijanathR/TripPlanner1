import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ItineraryEditor from "./ItineraryEditor";
import { daysApi } from "../api/days";
import { tripsApi } from "../api/trips";

vi.mock("../api/trips", () => ({
  tripsApi: { get: vi.fn() },
}));
vi.mock("../api/days", () => ({
  daysApi: { create: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn() },
}));
// Stand-in for DayEditor that exposes what the page passes it: the day's
// position, and the callbacks the page owns (delete, move).
vi.mock("../components/DayEditor", () => ({
  default: ({ day, index, onSaved, onDeleted, onMove }) => (
    <div data-testid="day-editor">
      <span>{`Day ${index + 1}: ${day.location}`}</span>
      <button onClick={() => onSaved({ ...day, location: `${day.location} (edited)` })}>{`save-${day.id}`}</button>
      <button onClick={() => onDeleted(day.id)}>{`delete-${day.id}`}</button>
      <button onClick={() => onMove(index, 1)}>{`down-${day.id}`}</button>
    </div>
  ),
}));

const twoDayTrip = {
  id: 1,
  name: "Kyoto in Autumn",
  days: [
    { id: 10, location: "Kyoto, Japan", date: "2026-11-03", notes: null, activities: [] },
    { id: 11, location: "Osaka, Japan", date: "2026-11-04", notes: null, activities: [] },
  ],
};

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

  it("shows a skeleton for the day list, not an empty editor, while the trip is being fetched", () => {
    tripsApi.get.mockReturnValue(new Promise(() => {}));
    renderEditor();

    expect(document.querySelector('.skeleton-list[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.queryByText("No days added yet.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add a day" })).not.toBeInTheDocument();
  });

  it("recovers when Retry is clicked after a failed fetch", async () => {
    tripsApi.get.mockRejectedValueOnce(new Error("network error"));
    renderEditor();
    await screen.findByText(/Couldn't load this trip/);

    tripsApi.get.mockResolvedValueOnce(twoDayTrip);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Kyoto in Autumn")).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't load this trip/)).not.toBeInTheDocument();
    expect(tripsApi.get).toHaveBeenCalledTimes(2);
  });

  it("offers an 'Add a day' call to action in the empty state that focuses the new-day form", async () => {
    tripsApi.get.mockResolvedValue({ id: 1, name: "Kyoto in Autumn", days: [] });
    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: "Add a day" }));

    expect(screen.getByLabelText("Date")).toHaveFocus();
  });

  it("shows the days in the order the API returned them", async () => {
    tripsApi.get.mockResolvedValue(twoDayTrip);
    renderEditor();

    const rows = await screen.findAllByTestId("day-editor");
    expect(rows.map((r) => within(r).getByText(/^Day \d/).textContent)).toEqual([
      "Day 1: Kyoto, Japan",
      "Day 2: Osaka, Japan",
    ]);
    expect(screen.queryByRole("button", { name: "Add a day" })).not.toBeInTheDocument();
  });

  it("appends a newly added day in order and clears the form", async () => {
    tripsApi.get.mockResolvedValue(twoDayTrip);
    daysApi.create.mockResolvedValue({
      id: 12, location: "Nara, Japan", date: "2026-11-05", notes: null, activities: [],
    });
    renderEditor();
    await screen.findAllByTestId("day-editor");

    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-11-05" } });
    fireEvent.change(screen.getByLabelText("Location"), { target: { value: "  Nara, Japan " } });
    fireEvent.click(screen.getByRole("button", { name: "Add day" }));

    expect(await screen.findByText("Day 3: Nara, Japan")).toBeInTheDocument();
    expect(daysApi.create).toHaveBeenCalledWith("1", { date: "2026-11-05", location: "Nara, Japan", notes: null });
    expect(screen.getByLabelText("Date")).toHaveValue("");
    expect(screen.getByLabelText("Location")).toHaveValue("");
  });

  it("shows an inline error on the new-day form and keeps the entered data when adding a day fails", async () => {
    tripsApi.get.mockResolvedValue(twoDayTrip);
    daysApi.create.mockRejectedValue(new Error("could not add day"));
    renderEditor();
    await screen.findAllByTestId("day-editor");

    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-11-05" } });
    fireEvent.change(screen.getByLabelText("Location"), { target: { value: "Nara, Japan" } });
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Feed the deer" } });
    fireEvent.click(screen.getByRole("button", { name: "Add day" }));

    expect(await screen.findByText("could not add day")).toBeInTheDocument();
    expect(screen.getByLabelText("Date")).toHaveValue("2026-11-05");
    expect(screen.getByLabelText("Location")).toHaveValue("Nara, Japan");
    expect(screen.getByLabelText("Notes")).toHaveValue("Feed the deer");
    expect(screen.getAllByTestId("day-editor")).toHaveLength(2);
  });

  it("does not allow adding a day until a date and location are entered", async () => {
    tripsApi.get.mockResolvedValue(twoDayTrip);
    renderEditor();
    await screen.findAllByTestId("day-editor");

    expect(screen.getByRole("button", { name: "Add day" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-11-05" } });
    expect(screen.getByRole("button", { name: "Add day" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Location"), { target: { value: "Nara" } });
    expect(screen.getByRole("button", { name: "Add day" })).toBeEnabled();
  });

  it("removes a deleted day and renumbers the remaining days", async () => {
    tripsApi.get.mockResolvedValue(twoDayTrip);
    renderEditor();
    await screen.findAllByTestId("day-editor");

    fireEvent.click(screen.getByRole("button", { name: "delete-10" }));

    expect(screen.queryByText(/Kyoto, Japan/)).not.toBeInTheDocument();
    expect(screen.getByText("Day 1: Osaka, Japan")).toBeInTheDocument();
    expect(screen.getAllByTestId("day-editor")).toHaveLength(1);
  });

  it("shows the empty state again after the last day is deleted", async () => {
    tripsApi.get.mockResolvedValue({ ...twoDayTrip, days: [twoDayTrip.days[0]] });
    renderEditor();
    await screen.findAllByTestId("day-editor");

    fireEvent.click(screen.getByRole("button", { name: "delete-10" }));

    expect(await screen.findByText("No days added yet.")).toBeInTheDocument();
  });

  it("reorders days through the API and reflects the new order", async () => {
    tripsApi.get.mockResolvedValue(twoDayTrip);
    daysApi.reorder.mockResolvedValue({});
    renderEditor();
    await screen.findAllByTestId("day-editor");

    fireEvent.click(screen.getByRole("button", { name: "down-10" }));

    await waitFor(() => expect(daysApi.reorder).toHaveBeenCalledWith("1", [11, 10]));
    expect(await screen.findByText("Day 1: Osaka, Japan")).toBeInTheDocument();
    expect(screen.getByText("Day 2: Kyoto, Japan")).toBeInTheDocument();
  });

  it("keeps the original order and shows an error when reordering fails", async () => {
    tripsApi.get.mockResolvedValue(twoDayTrip);
    daysApi.reorder.mockRejectedValue(new Error("reorder failed"));
    renderEditor();
    await screen.findAllByTestId("day-editor");

    fireEvent.click(screen.getByRole("button", { name: "down-10" }));

    expect(await screen.findByText(/Couldn't reorder days: reorder failed/)).toBeInTheDocument();
    expect(screen.getByText("Day 1: Kyoto, Japan")).toBeInTheDocument();
    expect(screen.getByText("Day 2: Osaka, Japan")).toBeInTheDocument();
  });

  it("reflects a saved day's new values in the page's copy of the trip, leaving other days alone", async () => {
    tripsApi.get.mockResolvedValue(twoDayTrip);
    renderEditor();
    await screen.findAllByTestId("day-editor");

    fireEvent.click(screen.getByRole("button", { name: "save-11" }));

    expect(await screen.findByText("Day 2: Osaka, Japan (edited)")).toBeInTheDocument();
    expect(screen.getByText("Day 1: Kyoto, Japan")).toBeInTheDocument();
  });
});
