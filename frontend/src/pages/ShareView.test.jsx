import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import ShareView from "./ShareView";
import { ApiError } from "../api/client";
import { sharingApi } from "../api/sharing";

vi.mock("../api/sharing", () => ({
  // Only the read endpoints exist here on purpose: the Share View must never
  // need a mutating call.
  sharingApi: { read: vi.fn(), conditions: vi.fn() },
}));

const okConditions = {
  status: "ok",
  data: { temperature_c: 18, condition: "Clear", map_url: "" },
  checked_at: "2026-09-18T01:30:00Z",
};

const sharedTrip = {
  id: 1,
  name: "Kyoto in Autumn",
  days: [
    {
      id: 10,
      date: "2026-11-03",
      location: "Kyoto, Japan",
      notes: "Bring a jacket",
      order_index: 0,
      activities: [
        { id: 100, title: "Fushimi Inari hike", start_time: "08:00:00", end_time: "11:00:00", notes: "Go early", order_index: 0 },
      ],
    },
    {
      id: 11,
      date: "2026-11-04",
      location: "Osaka, Japan",
      notes: null,
      order_index: 1,
      activities: [],
    },
  ],
};

function renderShareView(token = "tok-1") {
  return render(
    <MemoryRouter initialEntries={[`/share/${token}`]}>
      <Routes>
        <Route path="/share/:token" element={<ShareView />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sharingApi.conditions.mockResolvedValue(okConditions);
});

describe("ShareView", () => {
  it("shows a loading state, not a blank page, while the itinerary is being fetched", () => {
    sharingApi.read.mockReturnValue(new Promise(() => {}));
    renderShareView();

    expect(screen.getByLabelText("Loading itinerary")).toHaveAttribute("aria-busy", "true");
  });

  it("fetches the itinerary using the token from the URL", async () => {
    sharingApi.read.mockResolvedValue(sharedTrip);
    renderShareView("tok-xyz");

    await screen.findByText("Kyoto in Autumn");
    expect(sharingApi.read).toHaveBeenCalledWith("tok-xyz");
  });

  it("shows the 'unavailable' state, with no retry, when the link is invalid or the trip was deleted", async () => {
    sharingApi.read.mockRejectedValue(new ApiError(404, "not_found", "This itinerary is unavailable"));
    renderShareView();

    expect(await screen.findByRole("heading", { name: "This itinerary is unavailable" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("shows an empty state when the trip has no days", async () => {
    sharingApi.read.mockResolvedValue({ ...sharedTrip, days: [] });
    renderShareView();

    expect(await screen.findByText("No days have been added to this trip yet.")).toBeInTheDocument();
  });

  it("renders each day's location, date, notes, and activities in order", async () => {
    sharingApi.read.mockResolvedValue(sharedTrip);
    renderShareView();

    expect(await screen.findByRole("heading", { name: "Kyoto, Japan" })).toBeInTheDocument();
    expect(screen.getByText("2026-11-03")).toBeInTheDocument();
    expect(screen.getByText("Bring a jacket")).toBeInTheDocument();
    expect(screen.getByText("Fushimi Inari hike")).toBeInTheDocument();
    expect(screen.getByText("08:00–11:00")).toBeInTheDocument();
    expect(screen.getByText(/Go early/)).toBeInTheDocument();

    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Kyoto, Japan", "Osaka, Japan"]);
  });

  it("loads each day's conditions through the share-token endpoint", async () => {
    sharingApi.read.mockResolvedValue(sharedTrip);
    renderShareView("tok-1");

    expect((await screen.findAllByText(/18°C, Clear/)).length).toBe(2);
    expect(sharingApi.conditions).toHaveBeenCalledWith("tok-1", 10);
    expect(sharingApi.conditions).toHaveBeenCalledWith("tok-1", 11);
  });

  it("is read-only: no inputs, buttons, or edit/add/delete controls anywhere", async () => {
    sharingApi.read.mockResolvedValue(sharedTrip);
    renderShareView();
    await screen.findByText("Fushimi Inari hike");
    await screen.findAllByText(/18°C, Clear/);

    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryByText(/save|delete|add a day|add activity/i)).not.toBeInTheDocument();
  });

  it("shows an error with Retry for a non-404 failure, and recovers on Retry", async () => {
    sharingApi.read.mockRejectedValueOnce(new ApiError(0, "network_error", "Could not reach the server"));
    renderShareView();

    expect(await screen.findByText(/Couldn't load this itinerary: Could not reach the server/)).toBeInTheDocument();
    expect(screen.queryByText("This itinerary is unavailable")).not.toBeInTheDocument();

    sharingApi.read.mockResolvedValueOnce(sharedTrip);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Kyoto in Autumn")).toBeInTheDocument();
  });

  it("treats a server error as a retryable error, not as 'unavailable'", async () => {
    sharingApi.read.mockRejectedValue(new ApiError(500, "unknown_error", "Something went wrong"));
    renderShareView();

    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText("This itinerary is unavailable")).not.toBeInTheDocument();
  });

  it("shows the unavailable badge in place of the map, with activities intact, when a day's conditions fail", async () => {
    sharingApi.read.mockResolvedValue(sharedTrip);
    sharingApi.conditions.mockRejectedValue(new Error("upstream timeout"));
    renderShareView();

    expect((await screen.findAllByText("Conditions unavailable")).length).toBe(2);
    expect(screen.getByText("Fushimi Inari hike")).toBeInTheDocument();
    expect(screen.getByText("Kyoto in Autumn")).toBeInTheDocument();
  });
});

describe("App routing", () => {
  it("serves the Share View at /share/:token", async () => {
    sharingApi.read.mockResolvedValue(sharedTrip);
    render(
      <MemoryRouter initialEntries={["/share/tok-1"]}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByText("Kyoto in Autumn")).toBeInTheDocument();
    expect(sharingApi.read).toHaveBeenCalledWith("tok-1");
  });
});
