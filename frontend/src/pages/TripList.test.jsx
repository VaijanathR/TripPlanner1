import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TripList, { NOTICE_MS } from "./TripList";
import { destinationsApi } from "../api/destinations";
import { tripsApi } from "../api/trips";

vi.mock("../api/trips", () => ({
  tripsApi: {
    list: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock("../api/destinations", () => ({
  destinationsApi: { search: vi.fn() },
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => mockNavigate };
});

const KYOTO = { geoname_id: 1857910, city: "Kyoto", state: "Kyoto", country: "Japan", country_code: "JP" };
const PARIS_TX = { geoname_id: 4717560, city: "Paris", state: "Texas", country: "United States", country_code: "US" };

const typeName = (name) => fireEvent.change(screen.getByPlaceholderText("New trip name"), { target: { value: name } });
const createButton = () => screen.getByRole("button", { name: "Create trip" });

// Fill the place fields, search, and click the matching place.
async function choosePlace({ city = "Kyoto", label = "Kyoto, Kyoto, Japan" } = {}) {
  fireEvent.change(screen.getByLabelText("City"), { target: { value: city } });
  fireEvent.click(screen.getByRole("button", { name: "Find place" }));
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(label) }));
}

function renderTripList() {
  return render(
    <MemoryRouter>
      <TripList />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
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

  it("creates the trip with its chosen destination and opens it", async () => {
    tripsApi.list.mockResolvedValue({ trips: [] });
    destinationsApi.search.mockResolvedValue({ candidates: [KYOTO], alternatives: [] });
    tripsApi.create.mockResolvedValue({ id: 42, name: "New Trip", destination: KYOTO });
    renderTripList();

    await screen.findByText("No trips yet.");
    typeName("New Trip");
    await choosePlace();
    fireEvent.click(createButton());

    await waitFor(() => expect(tripsApi.create).toHaveBeenCalledWith("New Trip", 1857910));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/trips/42"));
  });

  it("asks for the trip name and a place: country, state and city", async () => {
    tripsApi.list.mockResolvedValue({ trips: [] });
    renderTripList();
    await screen.findByText("No trips yet.");

    expect(screen.getByPlaceholderText("New trip name")).toBeInTheDocument();
    expect(screen.getByLabelText("Country")).toBeInTheDocument();
    expect(screen.getByLabelText("State / region")).toBeInTheDocument();
    expect(screen.getByLabelText("City")).toBeInTheDocument();
  });

  it("cannot create a trip without a name, or without a chosen place", async () => {
    tripsApi.list.mockResolvedValue({ trips: [] });
    destinationsApi.search.mockResolvedValue({ candidates: [KYOTO], alternatives: [] });
    renderTripList();
    await screen.findByText("No trips yet.");
    expect(createButton()).toBeDisabled();

    typeName("Only a name");
    expect(createButton()).toBeDisabled();

    typeName("");
    await choosePlace();
    expect(createButton()).toBeDisabled();

    typeName("Both");
    expect(createButton()).toBeEnabled();
    expect(tripsApi.create).not.toHaveBeenCalled();
  });

  it("lists matching places to pick from, marks the chosen one, and says which place is chosen", async () => {
    tripsApi.list.mockResolvedValue({ trips: [] });
    destinationsApi.search.mockResolvedValue({ candidates: [PARIS_TX, KYOTO], alternatives: [] });
    renderTripList();
    await screen.findByText("No trips yet.");

    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Paris" } });
    fireEvent.click(screen.getByRole("button", { name: "Find place" }));
    const texas = await screen.findByRole("button", { name: /Paris, Texas, United States/ });
    expect(screen.getByRole("button", { name: /Kyoto, Kyoto, Japan/ })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(texas);

    expect(texas).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Kyoto, Kyoto, Japan/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Destination: Paris, Texas, United States")).toBeInTheDocument();
  });

  it("clears the chosen place when a place field is changed", async () => {
    tripsApi.list.mockResolvedValue({ trips: [] });
    destinationsApi.search.mockResolvedValue({ candidates: [KYOTO], alternatives: [] });
    renderTripList();
    await screen.findByText("No trips yet.");
    typeName("Trip");
    await choosePlace();
    expect(createButton()).toBeEnabled();

    fireEvent.change(screen.getByLabelText("Country"), { target: { value: "Japan" } });

    expect(createButton()).toBeDisabled();
    expect(screen.queryByText(/^Destination: /)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Kyoto, Kyoto, Japan/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("can change its mind: choosing another place replaces the first", async () => {
    tripsApi.list.mockResolvedValue({ trips: [] });
    destinationsApi.search.mockResolvedValue({ candidates: [PARIS_TX, KYOTO], alternatives: [] });
    tripsApi.create.mockResolvedValue({ id: 8, name: "Trip" });
    renderTripList();
    await screen.findByText("No trips yet.");
    typeName("Trip");
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Paris" } });
    fireEvent.click(screen.getByRole("button", { name: "Find place" }));
    fireEvent.click(await screen.findByRole("button", { name: /Paris, Texas/ }));
    fireEvent.click(screen.getByRole("button", { name: /Kyoto, Kyoto, Japan/ }));
    fireEvent.click(createButton());

    await waitFor(() => expect(tripsApi.create).toHaveBeenCalledWith("Trip", 1857910));
  });

  it("offers same-named places elsewhere when nothing matches, and one of them can be chosen", async () => {
    tripsApi.list.mockResolvedValue({ trips: [] });
    destinationsApi.search.mockResolvedValue({ candidates: [], alternatives: [PARIS_TX] });
    tripsApi.create.mockResolvedValue({ id: 9, name: "Trip" });
    renderTripList();
    await screen.findByText("No trips yet.");
    typeName("Trip");
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Paris" } });
    fireEvent.change(screen.getByLabelText("Country"), { target: { value: "Japan" } });
    fireEvent.click(screen.getByRole("button", { name: "Find place" }));

    expect(await screen.findByText(/Did you mean one of these\?/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Paris, Texas, United States/ }));
    fireEvent.click(createButton());

    await waitFor(() => expect(tripsApi.create).toHaveBeenCalledWith("Trip", 4717560));
  });

  it("says so when no place matches, and can be searched again", async () => {
    tripsApi.list.mockResolvedValue({ trips: [] });
    destinationsApi.search.mockResolvedValueOnce({ candidates: [], alternatives: [] });
    renderTripList();
    await screen.findByText("No trips yet.");

    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Atlantis" } });
    fireEvent.click(screen.getByRole("button", { name: "Find place" }));

    expect(await screen.findByText(/No places match/)).toBeInTheDocument();
    expect(createButton()).toBeDisabled();
  });

  it("shows why a place search failed and keeps the form usable", async () => {
    tripsApi.list.mockResolvedValue({ trips: [] });
    destinationsApi.search.mockRejectedValue(new Error("Place search is temporarily unavailable"));
    renderTripList();
    await screen.findByText("No trips yet.");
    typeName("Trip");

    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Kyoto" } });
    fireEvent.click(screen.getByRole("button", { name: "Find place" }));

    expect(await screen.findByText(/Place search is temporarily unavailable/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("New trip name")).toHaveValue("Trip");
    expect(screen.getByRole("button", { name: "Find place" })).toBeEnabled();
  });

  it("creates no trip when it fails, shows the reason, and keeps the name and the chosen place", async () => {
    tripsApi.list.mockResolvedValue({ trips: [] });
    destinationsApi.search.mockResolvedValue({ candidates: [KYOTO], alternatives: [] });
    tripsApi.create.mockRejectedValue(new Error("Place lookup is temporarily unavailable"));
    renderTripList();
    await screen.findByText("No trips yet.");

    typeName("Dup");
    await choosePlace();
    fireEvent.click(createButton());

    expect(await screen.findByText("Place lookup is temporarily unavailable")).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText("New trip name")).toHaveValue("Dup");
    expect(screen.getByLabelText("City")).toHaveValue("Kyoto");
    expect(screen.getByText("Destination: Kyoto, Kyoto, Japan")).toBeInTheDocument();
    expect(createButton()).toBeEnabled();
    expect(tripsApi.list).toHaveBeenCalledTimes(1);
  });

  it("locks the form while the trip is being created", async () => {
    tripsApi.list.mockResolvedValue({ trips: [] });
    destinationsApi.search.mockResolvedValue({ candidates: [KYOTO], alternatives: [] });
    tripsApi.create.mockReturnValue(new Promise(() => {}));
    renderTripList();
    await screen.findByText("No trips yet.");
    typeName("Slow");
    await choosePlace();
    fireEvent.click(createButton());

    expect(await screen.findByRole("button", { name: "Creating…" })).toBeDisabled();
    expect(screen.getByLabelText("City")).toBeDisabled();
    expect(screen.getByPlaceholderText("New trip name")).toBeDisabled();
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

  it("shows where each trip is going, and only for trips that have a destination", async () => {
    tripsApi.list.mockResolvedValue({
      trips: [
        { id: 1, name: "Kyoto trip", start_date: null, end_date: null, day_count: 0, destination: { city: "Kyoto", country: "Japan" } },
        { id: 2, name: "Undecided", start_date: null, end_date: null, day_count: 0, destination: null },
      ],
    });
    renderTripList();

    const kyoto = (await screen.findByText("Kyoto trip")).closest("li");
    const undecided = screen.getByText("Undecided").closest("li");
    expect(within(kyoto).getByText("Kyoto, Japan")).toBeInTheDocument();
    expect(within(undecided).queryByText(/Japan/)).not.toBeInTheDocument();
  });

  const trip = (id, name, cover = null, destination = null) => ({
    id, name, start_date: null, end_date: null, day_count: 0, cover_image_url: cover, destination,
  });
  const coverOf = (name) => screen.getByText(name).closest("li").querySelector(".trip-cover");

  it("uses the destination photo as the trip's cover, with descriptive text", async () => {
    tripsApi.list.mockResolvedValue({
      trips: [trip(1, "With photo", "https://img/kyoto.jpg", { city: "Kyoto", country: "Japan" })],
    });
    renderTripList();

    await screen.findByText("With photo");
    const img = coverOf("With photo").querySelector("img");
    expect(img).toHaveAttribute("src", "https://img/kyoto.jpg");
    expect(img).toHaveAttribute("alt", "Photo of Kyoto, Japan");
    expect(img).toHaveAttribute("loading", "lazy");
  });

  it("gives a trip without a destination photo one of the set photos, decorative and lazy", async () => {
    tripsApi.list.mockResolvedValue({ trips: [trip(2, "Without photo")] });
    renderTripList();

    await screen.findByText("Without photo");
    const img = coverOf("Without photo").querySelector("img");
    expect(img.getAttribute("src")).toMatch(/\/photos\/.+-card\.jpg$/);
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("loading", "lazy");
  });

  it("gives the same trip the same set photo on every visit", async () => {
    tripsApi.list.mockResolvedValue({ trips: [trip(7, "Steady trip")] });
    const first = renderTripList();
    await screen.findByText("Steady trip");
    const before = coverOf("Steady trip").querySelector("img").getAttribute("src");
    first.unmount();

    renderTripList();
    await screen.findByText("Steady trip");
    expect(coverOf("Steady trip").querySelector("img").getAttribute("src")).toBe(before);
  });

  it("stands a gradient in for a cover photo that cannot load", async () => {
    tripsApi.list.mockResolvedValue({ trips: [trip(3, "Broken photo", "https://img/gone.jpg")] });
    renderTripList();

    await screen.findByText("Broken photo");
    fireEvent.error(coverOf("Broken photo").querySelector("img"));

    expect(coverOf("Broken photo").querySelector("img")).toBeNull();
    expect(coverOf("Broken photo").style.backgroundImage).toContain("linear-gradient");
  });

  it("shows a travel photo banner, and a different one on the next visit", async () => {
    tripsApi.list.mockResolvedValue({ trips: [] });
    const bannerSrc = () => document.querySelector(".hero img.hero-photo").getAttribute("src");

    const first = renderTripList();
    await screen.findByText("No trips yet.");
    const one = bannerSrc();
    expect(one).toMatch(/-wide\.jpg$/);
    first.unmount();

    renderTripList();
    await screen.findByText("No trips yet.");
    expect(bannerSrc()).not.toBe(one);
  });

  it("downloads only the banner up front; the rest load as they come into view", async () => {
    tripsApi.list.mockResolvedValue({ trips: [trip(1, "A"), trip(2, "B", "https://img/b.jpg")] });
    renderTripList();
    await screen.findByText("A");

    const images = [...document.querySelectorAll("img")];
    const eager = images.filter((img) => img.getAttribute("loading") !== "lazy");
    expect(eager).toHaveLength(1);
    expect(eager[0]).toHaveClass("hero-photo");
    expect(eager[0]).toHaveAttribute("fetchpriority", "high");
  });

  it("shows the Travel your way strip below the trips, and below the empty state", async () => {
    tripsApi.list.mockResolvedValue({ trips: [trip(1, "First trip")] });
    const withTrips = renderTripList();
    await screen.findByText("First trip");
    let strip = screen.getByRole("heading", { name: "Travel your way" });
    expect(coverOf("First trip").compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    withTrips.unmount();

    tripsApi.list.mockResolvedValue({ trips: [] });
    renderTripList();
    const empty = await screen.findByText("No trips yet.");
    strip = screen.getByRole("heading", { name: "Travel your way" });
    expect(empty.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
