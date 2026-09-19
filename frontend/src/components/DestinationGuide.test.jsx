import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DestinationGuide from "./DestinationGuide";

const destination = { geoname_id: 1, city: "Kyoto", state: "Kyoto", country: "Japan" };
const days = [{ id: 10, date: "2026-11-03" }];
const photo = (title, extra = {}) => ({
  title, description: `About ${title}`, image_url: `https://img/${title}.jpg`, credit_url: `https://credit/${title}`, ...extra,
});
const place = (id, name, extra = {}) => ({ id, name, theme: "religious", sitelinks: 10, type: "temple", ...extra });

const readyGuide = (overrides = {}) => ({
  status: "ready",
  photos: {
    city: photo("Kyoto", { extract: "Kyoto is a city in Japan." }),
    state: photo("Kyoto Prefecture"),
    country: photo("Japan"),
  },
  gallery: [{ title: "Nijo Castle", image_url: "https://img/nijo.jpg", credit_url: "https://credit/nijo" }],
  places: { city: [place("Q1", "Kiyomizu-dera"), place("Q2", "Kinkaku-ji")], around: [place("Q3", "Byodo-in")] },
  activities: [{ theme: "religious", label: "Temples, shrines & churches", summary: "3 notable places.", places: ["Kiyomizu-dera", "Kinkaku-ji"] }],
  sections: { photos: "ready", places_city: "ready", places_around: "ready" },
  ...overrides,
});

const renderGuide = (props = {}) =>
  render(
    <DestinationGuide destination={destination} guide={readyGuide()} error={null} onRetry={vi.fn()}
      days={days} onAddPlace={vi.fn()} {...props} />
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DestinationGuide: what a ready guide shows", () => {
  it("introduces the city with its description", () => {
    renderGuide();

    expect(screen.getByRole("heading", { name: /Discover Kyoto/ })).toBeInTheDocument();
    expect(screen.getByText("Kyoto is a city in Japan.")).toBeInTheDocument();
  });

  it("shows photos of the city, the state and the country, each labelled and credited", () => {
    renderGuide();

    for (const [name, label] of [["Kyoto", "City"], ["Kyoto Prefecture", "State / region"], ["Japan", "Country"]]) {
      expect(screen.getByAltText(name)).toHaveAttribute("src", `https://img/${name}.jpg`);
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    const credits = screen.getAllByRole("link", { name: "Photo credit" });
    expect(credits.length).toBeGreaterThanOrEqual(3);
    credits.forEach((a) => expect(a).toHaveAttribute("rel", expect.stringContaining("noopener")));
  });

  it("lists things to do with the places behind each", () => {
    renderGuide();

    const heading = screen.getByRole("heading", { name: "Things to do in Kyoto" });
    const card = within(heading.parentElement).getByRole("heading", { name: "Temples, shrines & churches" }).closest("li");
    expect(within(card).getByText("3 notable places.")).toBeInTheDocument();
    expect(within(card).getByText("Kiyomizu-dera")).toBeInTheDocument();
  });

  it("separates places in the city from places around it, each with an add control", () => {
    renderGuide();

    const inCity = screen.getByRole("heading", { name: "Popular places in Kyoto" }).parentElement;
    const around = screen.getByRole("heading", { name: "Around Kyoto" }).parentElement;
    expect(within(inCity).getByRole("heading", { name: "Kiyomizu-dera" })).toBeInTheDocument();
    expect(within(inCity).queryByRole("heading", { name: "Byodo-in" })).not.toBeInTheDocument();
    expect(within(around).getByRole("heading", { name: "Byodo-in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Byodo-in to itinerary" })).toBeInTheDocument();
  });

  it("hands the place and the chosen day to the page when one is added", () => {
    const onAddPlace = vi.fn().mockResolvedValue();
    renderGuide({ onAddPlace });

    fireEvent.click(screen.getByRole("button", { name: "Add Kinkaku-ji to itinerary" }));

    expect(onAddPlace).toHaveBeenCalledWith(expect.objectContaining({ name: "Kinkaku-ji" }), 10);
  });

  it("shows a photo gallery and credits its sources", () => {
    renderGuide();

    expect(screen.getByRole("heading", { name: "Photos from Kyoto" })).toBeInTheDocument();
    expect(screen.getByAltText("Nijo Castle")).toBeInTheDocument();
    expect(screen.getByText(/Wikipedia and Wikimedia Commons/)).toBeInTheDocument();
  });

  it("omits the 'around' section when there is nothing around", () => {
    renderGuide({ guide: readyGuide({ places: { city: [place("Q1", "Kiyomizu-dera")], around: [] } }) });

    expect(screen.queryByRole("heading", { name: "Around Kyoto" })).not.toBeInTheDocument();
  });

  it("leaves out photo cards that don't exist, without a hole", () => {
    renderGuide({ guide: readyGuide({ photos: { city: photo("Kyoto"), state: null, country: null } }) });

    expect(screen.getByAltText("Kyoto")).toBeInTheDocument();
    expect(screen.queryByText("State / region")).not.toBeInTheDocument();
    expect(screen.queryByText("Country")).not.toBeInTheDocument();
  });

  it("shows no credit link for a photo that has no image", () => {
    renderGuide({ guide: readyGuide({ photos: { city: photo("Kyoto", { image_url: null }), state: null, country: null } }) });

    expect(screen.queryByAltText("Kyoto")).not.toBeInTheDocument();
    expect(screen.getByText("Kyoto", { selector: "strong" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Photo credit" })).not.toBeInTheDocument();
  });
});

describe("DestinationGuide: loading, building, failing", () => {
  it("shows a loading state while the first response is awaited", () => {
    renderGuide({ guide: null });

    expect(screen.getByLabelText("Loading destination guide")).toHaveAttribute("aria-busy", "true");
  });

  it("shows an error with Retry when the guide can't be loaded at all", () => {
    const onRetry = vi.fn();
    renderGuide({ guide: null, error: "Could not reach the server", onRetry });

    expect(screen.getByText(/Couldn't load the guide for Kyoto: Could not reach the server/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("keeps showing the last good guide when a later refresh fails", () => {
    renderGuide({ error: "blip" });

    expect(screen.getByRole("heading", { name: /Discover Kyoto/ })).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't load the guide/)).not.toBeInTheDocument();
  });

  it("says the guide is being built, yet shows whatever has already arrived", () => {
    renderGuide({
      guide: readyGuide({
        status: "building",
        places: { city: [], around: [] }, activities: [], gallery: [],
        sections: { photos: "ready", places_city: "pending", places_around: "pending" },
      }),
    });

    expect(screen.getByRole("status")).toHaveTextContent(/Building your guide/);
    expect(screen.getByAltText("Kyoto")).toBeInTheDocument();
    expect(screen.queryByText(/unavailable right now/)).not.toBeInTheDocument(); // pending is not failure
  });

  it("offers Try again when the whole guide failed", () => {
    const onRetry = vi.fn();
    renderGuide({ guide: readyGuide({ status: "failed" }), onRetry });

    expect(screen.getByText(/couldn't put together a guide for Kyoto/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("says which part is unavailable while still showing the parts that worked", () => {
    renderGuide({
      guide: readyGuide({
        places: { city: [], around: [] }, activities: [],
        sections: { photos: "ready", places_city: "unavailable", places_around: "unavailable" },
      }),
    });

    expect(screen.getByText("Popular places for Kyoto are unavailable right now.")).toBeInTheDocument();
    expect(screen.getByAltText("Kyoto")).toBeInTheDocument();
  });

  it("says when the photos are unavailable", () => {
    renderGuide({
      guide: readyGuide({ photos: { city: null, state: null, country: null }, sections: { photos: "unavailable", places_city: "ready", places_around: "ready" } }),
    });

    expect(screen.getByText("Photos of Kyoto are unavailable right now.")).toBeInTheDocument();
  });

  it("says when only the wider area could not be loaded", () => {
    renderGuide({
      guide: readyGuide({ places: { city: [place("Q1", "Kiyomizu-dera")], around: [] }, sections: { photos: "ready", places_city: "ready", places_around: "unavailable" } }),
    });

    expect(screen.getByText("Places around Kyoto are unavailable right now.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Kiyomizu-dera" })).toBeInTheDocument();
  });

  it("says so, rather than showing nothing, when a city simply has no well-known places", () => {
    renderGuide({
      guide: readyGuide({ places: { city: [], around: [] }, activities: [], gallery: [] }),
    });

    expect(screen.getByText(/couldn't find well-known places listed for Kyoto/)).toBeInTheDocument();
  });
});
