import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ItineraryEditor from "./ItineraryEditor";
import { daysApi } from "../api/days";
import { destinationsApi } from "../api/destinations";
import { tripsApi } from "../api/trips";

vi.mock("../api/trips", () => ({
  tripsApi: { get: vi.fn() },
}));
vi.mock("../api/destinations", () => ({
  destinationsApi: { search: vi.fn(), set: vi.fn(), clear: vi.fn(), guide: vi.fn() },
}));
vi.mock("../api/days", () => ({
  daysApi: { create: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn() },
}));
// Stand-in for DayEditor that exposes what the page passes it: the day's
// position, and the callbacks the page owns (delete, move).
vi.mock("../components/DayEditor", () => ({
  default: function MockDayEditor({ day, index, onSaved, onDeleted, onMove, onDirtyChange }) {
    // Like the real DayEditor, remembers what it was given at mount: it only
    // shows new saved activities if the page re-creates it.
    const [initialCount] = useState(day.activities.length);
    return (
    <div data-testid="day-editor">
      <span>{`Day ${index + 1}: ${day.location}`}</span>
      <span>{`${day.activities.length} activities`}</span>
      <span>{`started with ${initialCount}`}</span>
      <button onClick={() => onDirtyChange(day.id, true)}>{`dirty-${day.id}`}</button>
      <button onClick={() => onDirtyChange(day.id, false)}>{`clean-${day.id}`}</button>
      <button onClick={() => onSaved({ ...day, location: `${day.location} (edited)` })}>{`save-${day.id}`}</button>
      <button onClick={() => onDeleted(day.id)}>{`delete-${day.id}`}</button>
      <button onClick={() => onMove(index, 1)}>{`down-${day.id}`}</button>
    </div>
    );
  },
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


// ---------------------------------------------------------------------------
// Destination: picking a place, the Itinerary / Discover tabs, and adding
// popular places to the itinerary.
// ---------------------------------------------------------------------------

const kyoto = { geoname_id: 1857910, city: "Kyoto", state: "Kyoto", country: "Japan", country_code: "JP" };
const tripTo = (overrides = {}) => ({
  ...twoDayTrip,
  destination: kyoto,
  days: [
    { id: 10, location: "Kyoto, Japan", date: "2026-11-03", notes: null, activities: [
      { id: 100, title: "Fushimi Inari hike", start_time: "08:00:00", end_time: "11:00:00", notes: "Go early", order_index: 0 },
    ] },
    { id: 11, location: "Osaka, Japan", date: "2026-11-04", notes: null, activities: [] },
  ],
  ...overrides,
});
const guideOf = (overrides = {}) => ({
  status: "ready",
  photos: { city: { title: "Kyoto", image_url: "https://img/kyoto.jpg", extract: "A city." }, state: null, country: null },
  gallery: [],
  places: {
    city: [{ id: "Q1", name: "Kiyomizu-dera", theme: "religious", sitelinks: 77, type: "temple", description: "Buddhist temple" }],
    around: [],
  },
  activities: [],
  sections: { photos: "ready", places_city: "ready", places_around: "ready" },
  ...overrides,
});
const addButton = (name = "Kiyomizu-dera") => screen.getByRole("button", { name: `Add ${name} to itinerary` });

describe("ItineraryEditor: choosing a destination", () => {
  beforeEach(() => {
    destinationsApi.guide.mockResolvedValue(guideOf());
  });

  it("asks where the trip is going when it has no destination, with no tabs yet", async () => {
    tripsApi.get.mockResolvedValue(twoDayTrip);
    renderEditor();

    expect(await screen.findByRole("heading", { name: "Where are you going?" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(destinationsApi.guide).not.toHaveBeenCalled();
  });

  it("saves the chosen place, then shows the guide and the tabs", async () => {
    tripsApi.get.mockResolvedValue(twoDayTrip);
    destinationsApi.search.mockResolvedValue({ candidates: [{ ...kyoto, latitude: 35, longitude: 135 }] });
    destinationsApi.set.mockResolvedValue({ ...twoDayTrip, destination: kyoto });
    renderEditor();
    await screen.findByRole("heading", { name: "Where are you going?" });

    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Kyoto" } });
    fireEvent.click(screen.getByRole("button", { name: "Find destination" }));
    fireEvent.click(await screen.findByRole("button", { name: "Kyoto, Kyoto, Japan" }));

    await waitFor(() => expect(destinationsApi.set).toHaveBeenCalledWith("1", 1857910));
    expect(await screen.findByRole("tab", { name: "Discover Kyoto" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Where are you going?" })).not.toBeInTheDocument();
    expect(destinationsApi.guide).toHaveBeenCalledWith("1");
  });

  it("shows the destination in the header and lets the user change it, or cancel", async () => {
    tripsApi.get.mockResolvedValue(tripTo());
    renderEditor();

    expect(await screen.findByText("Kyoto, Kyoto, Japan")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Where are you going?" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Change destination" }));
    expect(screen.getByRole("heading", { name: "Where are you going?" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("heading", { name: "Where are you going?" })).not.toBeInTheDocument();
  });

  it("closes the picker and shows the new destination once a change is saved", async () => {
    tripsApi.get.mockResolvedValue(tripTo());
    destinationsApi.search.mockResolvedValue({ candidates: [{ geoname_id: 2, city: "Osaka", state: "Osaka", country: "Japan", country_code: "JP" }] });
    destinationsApi.set.mockResolvedValue({ ...twoDayTrip, destination: { geoname_id: 2, city: "Osaka", state: "Osaka", country: "Japan" } });
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Change destination" }));

    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Osaka" } });
    fireEvent.click(screen.getByRole("button", { name: "Find destination" }));
    fireEvent.click(await screen.findByRole("button", { name: "Osaka, Osaka, Japan" }));

    expect(await screen.findByText("Osaka, Osaka, Japan", { selector: ".hero-destination" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Where are you going?" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Discover Osaka" })).toBeInTheDocument();
  });

  it("uses the city's photo as the header image once the guide has it, with descriptive text", async () => {
    tripsApi.get.mockResolvedValue(tripTo());
    renderEditor();
    await screen.findByText("Kyoto, Kyoto, Japan");

    await waitFor(() => {
      const hero = document.querySelector(".trip-hero");
      expect(hero.classList.contains("has-photo")).toBe(true);
      const img = hero.querySelector("img.hero-photo");
      expect(img).toHaveAttribute("src", "https://img/kyoto.jpg");
      expect(img.getAttribute("alt")).toMatch(/Kyoto/);
    });
  });

  it("uses a set photo, decorative and lazy, when there is no destination photo", async () => {
    tripsApi.get.mockResolvedValue(tripTo());
    destinationsApi.guide.mockResolvedValue(guideOf({ photos: { city: null, state: null, country: null } }));
    renderEditor();
    await screen.findByText("Kyoto, Kyoto, Japan");

    const hero = document.querySelector(".trip-hero");
    expect(hero.classList.contains("has-photo")).toBe(false);
    const img = hero.querySelector("img.hero-photo");
    expect(img.getAttribute("src")).toMatch(/\/photos\/.+-header\.jpg$/);
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("loading", "lazy");
  });

  it("gives the same trip the same set photo every time", async () => {
    tripsApi.get.mockResolvedValue({ id: 1, name: "Kyoto in Autumn", days: [] });
    const first = renderEditor();
    await screen.findByText("Kyoto in Autumn");
    const before = document.querySelector(".trip-hero img.hero-photo").getAttribute("src");
    first.unmount();

    renderEditor();
    await screen.findByText("Kyoto in Autumn");
    expect(document.querySelector(".trip-hero img.hero-photo").getAttribute("src")).toBe(before);
  });

  it("leaves the gradient, not a broken image, when the header photo cannot load", async () => {
    tripsApi.get.mockResolvedValue({ id: 1, name: "Kyoto in Autumn", days: [] });
    renderEditor();
    await screen.findByText("Kyoto in Autumn");

    fireEvent.error(document.querySelector(".trip-hero img.hero-photo"));

    expect(document.querySelector(".trip-hero img")).toBeNull();
    expect(screen.getByText("Kyoto in Autumn")).toBeInTheDocument();
  });
});

describe("ItineraryEditor: the Itinerary and Discover tabs", () => {
  beforeEach(() => {
    destinationsApi.guide.mockResolvedValue(guideOf());
  });

  it("opens on the itinerary when the trip already has days", async () => {
    tripsApi.get.mockResolvedValue(tripTo());
    renderEditor();

    expect(await screen.findByRole("tab", { name: "Itinerary" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Discover Kyoto" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getAllByTestId("day-editor")[0]).toBeVisible();
  });

  it("opens on Discover when the trip has no days yet, since there is nothing to edit", async () => {
    tripsApi.get.mockResolvedValue(tripTo({ days: [] }));
    renderEditor();

    expect(await screen.findByRole("tab", { name: "Discover Kyoto" })).toHaveAttribute("aria-selected", "true");
  });

  it("switches views without unmounting either, so nothing a user typed is lost", async () => {
    tripsApi.get.mockResolvedValue(tripTo());
    renderEditor();
    await screen.findByRole("tab", { name: "Itinerary" });
    const editorsBefore = screen.getAllByTestId("day-editor");

    fireEvent.click(screen.getByRole("tab", { name: "Discover Kyoto" }));

    expect(screen.getByRole("tab", { name: "Discover Kyoto" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("heading", { name: "Kiyomizu-dera" })).toBeVisible();
    const editorsAfter = screen.getAllByTestId("day-editor");
    expect(editorsAfter).toHaveLength(2);
    expect(editorsAfter[0]).toBe(editorsBefore[0]); // the very same DOM node: not re-created
    expect(editorsAfter[0]).not.toBeVisible();

    fireEvent.click(screen.getByRole("tab", { name: "Itinerary" }));
    expect(screen.getAllByTestId("day-editor")[0]).toBeVisible();
    expect(screen.getByRole("heading", { name: "Kiyomizu-dera", hidden: true })).not.toBeVisible();
  });

  it("has no tabs, and always shows the itinerary, for a trip without a destination", async () => {
    tripsApi.get.mockResolvedValue(twoDayTrip);
    renderEditor();

    expect(await screen.findAllByTestId("day-editor")).toHaveLength(2);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("day-editor")[0]).toBeVisible();
  });
});

describe("ItineraryEditor: adding a popular place to the itinerary", () => {
  beforeEach(() => {
    destinationsApi.guide.mockResolvedValue(guideOf());
    tripsApi.get.mockResolvedValue(tripTo());
  });

  const openDiscover = async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole("tab", { name: "Discover Kyoto" }));
    await screen.findByRole("heading", { name: "Kiyomizu-dera" });
  };

  it("appends the place to the chosen day, keeping what was already planned, right after the last activity", async () => {
    daysApi.update.mockResolvedValue({
      id: 10, location: "Kyoto, Japan", date: "2026-11-03", notes: null,
      activities: [
        { id: 100, title: "Fushimi Inari hike", start_time: "08:00:00", end_time: "11:00:00", notes: "Go early", order_index: 0 },
        { id: 101, title: "Kiyomizu-dera", start_time: "11:00:00", end_time: "13:00:00", notes: "Buddhist temple", order_index: 1 },
      ],
    });
    await openDiscover();

    fireEvent.click(addButton());

    await waitFor(() => expect(daysApi.update).toHaveBeenCalledTimes(1));
    expect(daysApi.update).toHaveBeenCalledWith("1", 10, {
      date: "2026-11-03",
      location: "Kyoto, Japan",
      notes: null,
      activities: [
        { id: 100, title: "Fushimi Inari hike", start_time: "08:00:00", end_time: "11:00:00", notes: "Go early", order_index: 0 },
        { id: null, title: "Kiyomizu-dera", start_time: "11:00", end_time: "13:00", notes: "Buddhist temple", order_index: 1 },
      ],
    });
  });

  it("confirms which day it went to, and the day now shows the new activity", async () => {
    daysApi.update.mockResolvedValue({
      id: 10, location: "Kyoto, Japan", date: "2026-11-03", notes: null,
      activities: [{ id: 100 }, { id: 101 }],
    });
    await openDiscover();

    fireEvent.click(addButton());

    expect(await screen.findByRole("status")).toHaveTextContent("Added “Kiyomizu-dera” to Day 1.");
    expect(screen.getAllByText("2 activities")).toHaveLength(1);
  });

  it("adds to the day the user picked, and starts an empty day at 09:00", async () => {
    daysApi.update.mockResolvedValue({ id: 11, location: "Osaka, Japan", date: "2026-11-04", notes: null, activities: [{ id: 5 }] });
    await openDiscover();

    fireEvent.change(screen.getByLabelText("Day for Kiyomizu-dera"), { target: { value: "11" } });
    fireEvent.click(addButton());

    await waitFor(() => expect(daysApi.update).toHaveBeenCalled());
    const [, dayId, body] = daysApi.update.mock.calls[0];
    expect(dayId).toBe(11);
    expect(body.activities).toEqual([
      { id: null, title: "Kiyomizu-dera", start_time: "09:00", end_time: "11:00", notes: "Buddhist temple", order_index: 0 },
    ]);
    expect(await screen.findByRole("status")).toHaveTextContent("to Day 2.");
  });

  it("refuses to add to a day with unsaved edits, so it can never overwrite them", async () => {
    await openDiscover();
    fireEvent.click(screen.getByRole("button", { name: "dirty-10", hidden: true }));

    fireEvent.click(addButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("Save the changes to Day 1 first");
    expect(daysApi.update).not.toHaveBeenCalled();
  });

  it("allows adding again once the edits are saved or discarded", async () => {
    daysApi.update.mockResolvedValue({ id: 10, location: "Kyoto, Japan", date: "2026-11-03", notes: null, activities: [] });
    await openDiscover();
    fireEvent.click(screen.getByRole("button", { name: "dirty-10", hidden: true }));
    fireEvent.click(addButton());
    await screen.findByRole("alert");

    fireEvent.click(screen.getByRole("button", { name: "clean-10", hidden: true }));
    fireEvent.click(addButton());

    await waitFor(() => expect(daysApi.update).toHaveBeenCalledTimes(1));
  });

  it("only blocks the day that has unsaved edits, not the others", async () => {
    daysApi.update.mockResolvedValue({ id: 11, location: "Osaka, Japan", date: "2026-11-04", notes: null, activities: [] });
    await openDiscover();
    fireEvent.click(screen.getByRole("button", { name: "dirty-10", hidden: true }));

    fireEvent.change(screen.getByLabelText("Day for Kiyomizu-dera"), { target: { value: "11" } });
    fireEvent.click(addButton());

    await waitFor(() => expect(daysApi.update).toHaveBeenCalledTimes(1));
  });

  it("re-creates the day's editor so it shows the activity that was just saved", async () => {
    daysApi.update.mockResolvedValue({
      id: 10, location: "Kyoto, Japan", date: "2026-11-03", notes: null, activities: [{ id: 100 }, { id: 101 }],
    });
    await openDiscover();
    expect(screen.getByText("started with 1")).toBeInTheDocument();

    fireEvent.click(addButton());

    expect(await screen.findByText("started with 2")).toBeInTheDocument();
    expect(screen.getByText("started with 0")).toBeInTheDocument(); // other day untouched
  });

  it("shows why it failed and leaves the day as it was", async () => {
    daysApi.update.mockRejectedValue(new Error("server exploded"));
    await openDiscover();

    fireEvent.click(addButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't add Kiyomizu-dera: server exploded");
    expect(screen.getAllByText("1 activities")).toHaveLength(1);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("clears the previous message when the next add starts", async () => {
    daysApi.update.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({
      id: 10, location: "Kyoto, Japan", date: "2026-11-03", notes: null, activities: [],
    });
    await openDiscover();
    fireEvent.click(addButton());
    await screen.findByRole("alert");

    fireEvent.click(addButton());

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});
