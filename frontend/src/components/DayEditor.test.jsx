import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DayEditor from "./DayEditor";
import { conditionsApi } from "../api/conditions";
import { daysApi } from "../api/days";

vi.mock("../api/conditions", () => ({
  conditionsApi: { forDay: vi.fn() },
}));
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
  conditionsApi.forDay.mockResolvedValue({
    status: "ok",
    data: { temperature_c: 18, condition: "Clear", map_url: "" },
    checked_at: "2026-09-18T01:30:00Z",
  });
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

  it("still renders the saved activities in full, with an unavailable badge, when conditions fail", async () => {
    conditionsApi.forDay.mockRejectedValue(new Error("upstream timeout"));
    renderDayEditor();

    expect(await screen.findByText("Conditions unavailable")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Fushimi Inari hike")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("keeps the rest of the day interactive while conditions are loading", () => {
    conditionsApi.forDay.mockReturnValue(new Promise(() => {}));
    renderDayEditor();

    expect(screen.getByText(/loading conditions/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("shows a saving indicator and blocks a second save while the update is in flight", () => {
    daysApi.update.mockReturnValue(new Promise(() => {}));
    renderDayEditor();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(daysApi.update).toHaveBeenCalledTimes(1);
  });

  it("confirms with 'Saved' and hands the updated day to the page after a successful update", async () => {
    const props = renderDayEditor();
    const updated = { ...baseDay, location: "Osaka, Japan" };
    daysApi.update.mockResolvedValue(updated);

    fireEvent.change(screen.getByLabelText("Location"), { target: { value: "Osaka, Japan" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(props.onSaved).toHaveBeenCalledWith(updated);
    expect(screen.queryByRole("button", { name: "Saving…" })).not.toBeInTheDocument();
  });

  it("hides the 'Saved' confirmation once the day is edited again", async () => {
    renderDayEditor();
    daysApi.update.mockResolvedValue(baseDay);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved");

    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "more notes" } });

    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("offers Retry after a failed save, keeps the edited values, and recovers on Retry", async () => {
    const props = renderDayEditor();
    daysApi.update.mockRejectedValueOnce(new Error("server exploded"));

    fireEvent.change(screen.getByLabelText("Location"), { target: { value: "Osaka, Japan" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/server exploded/)).toBeInTheDocument();
    expect(screen.getByLabelText("Location")).toHaveValue("Osaka, Japan");
    expect(props.onSaved).not.toHaveBeenCalled();

    daysApi.update.mockResolvedValueOnce({ ...baseDay, location: "Osaka, Japan" });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(daysApi.update).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/server exploded/)).not.toBeInTheDocument();
    // Both attempts sent the user's edited value, not the original.
    expect(daysApi.update.mock.calls[1][2].location).toBe("Osaka, Japan");
  });

  it("removes the day through the API and tells the page once deletion is confirmed", async () => {
    const props = renderDayEditor();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    daysApi.remove.mockResolvedValue(null);

    fireEvent.click(screen.getByRole("button", { name: "Delete day" }));

    await waitFor(() => expect(props.onDeleted).toHaveBeenCalledWith(10));
    expect(daysApi.remove).toHaveBeenCalledWith("1", 10);
  });

  it("keeps the day visible and shows an inline error when the delete fails", async () => {
    const props = renderDayEditor();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    daysApi.remove.mockRejectedValue(new Error("could not delete day"));

    fireEvent.click(screen.getByRole("button", { name: "Delete day" }));

    expect(await screen.findByText("could not delete day")).toBeInTheDocument();
    expect(props.onDeleted).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("Fushimi Inari hike")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete day" })).toBeEnabled();
  });

  it("shows the day's date, location, notes and each activity", () => {
    renderDayEditor({ day: { ...baseDay, notes: "Bring a jacket" } });

    expect(screen.getByLabelText("Date")).toHaveValue("2026-11-03");
    expect(screen.getByLabelText("Location")).toHaveValue("Kyoto, Japan");
    expect(screen.getByLabelText("Notes")).toHaveValue("Bring a jacket");
    expect(screen.getByDisplayValue("Fushimi Inari hike")).toBeInTheDocument();
  });
});
