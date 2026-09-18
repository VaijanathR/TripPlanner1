import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DayEditor from "./DayEditor";
import { daysApi } from "../api/days";

vi.mock("../api/days", () => ({
  daysApi: { update: vi.fn(), remove: vi.fn() },
}));

const baseDay = {
  id: 10,
  date: "2026-11-03",
  location: "Kyoto, Japan",
  notes: null,
  activities: [
    { id: 100, title: "Fushimi Inari hike", start_time: "08:00", end_time: "11:00", notes: null, order_index: 0 },
  ],
};

function renderDayEditor(overrides = {}) {
  const props = {
    tripId: "1",
    day: baseDay,
    index: 0,
    dayCount: 1,
    onSaved: vi.fn(),
    onDeleted: vi.fn(),
    onMove: vi.fn(),
    ...overrides,
  };
  render(<DayEditor {...props} />);
  return props;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DayEditor", () => {
  it("renders the existing activity and enables Save when times are valid", () => {
    renderDayEditor();
    expect(screen.getByDisplayValue("Fushimi Inari hike")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("disables Save and shows an inline error when end time is before start time, before any request is sent", () => {
    renderDayEditor();

    const timeInputs = document.querySelectorAll('input[type="time"]');
    fireEvent.change(timeInputs[0], { target: { value: "12:00" } });
    fireEvent.change(timeInputs[1], { target: { value: "09:00" } });

    expect(screen.getByText("End time must not be before start time.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(daysApi.update).not.toHaveBeenCalled();
  });

  it("re-enables Save once the time is corrected, and Save calls the API", async () => {
    renderDayEditor();

    const timeInputs = document.querySelectorAll('input[type="time"]');
    fireEvent.change(timeInputs[0], { target: { value: "12:00" } });
    fireEvent.change(timeInputs[1], { target: { value: "09:00" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    fireEvent.change(timeInputs[1], { target: { value: "13:00" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();

    daysApi.update.mockResolvedValue({ ...baseDay, activities: baseDay.activities });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(daysApi.update).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("shows an inline error and retains edits when the save request fails", async () => {
    renderDayEditor();
    daysApi.update.mockRejectedValue(new Error("server exploded"));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/server exploded/)).toBeInTheDocument();
    // The user's data is still there, not wiped out by the failed save.
    expect(screen.getByDisplayValue("Fushimi Inari hike")).toBeInTheDocument();
  });

  it("asks for confirmation before deleting the day", async () => {
    const props = renderDayEditor();
    vi.spyOn(window, "confirm").mockReturnValue(false);

    fireEvent.click(screen.getByRole("button", { name: "Delete day" }));

    expect(window.confirm).toHaveBeenCalled();
    expect(daysApi.remove).not.toHaveBeenCalled();
    expect(props.onDeleted).not.toHaveBeenCalled();
  });
});
