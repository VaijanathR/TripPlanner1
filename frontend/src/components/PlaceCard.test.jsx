import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PlaceCard from "./PlaceCard";

const place = {
  id: "Q1", name: "Kiyomizu-dera", type: "Buddhist temple", theme: "religious", distance_km: 2.1,
  description: "Buddhist temple in Kyoto, Japan", image_url: "https://img/k.jpg", credit_url: "https://commons/File:k.jpg",
};
const days = [
  { id: 10, date: "2026-11-03" },
  { id: 11, date: "2026-11-04" },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PlaceCard", () => {
  it("shows the place with its type, distance, description and photo credit", () => {
    render(<PlaceCard place={place} days={days} onAdd={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Kiyomizu-dera" })).toBeInTheDocument();
    expect(screen.getByText("Buddhist temple")).toBeInTheDocument();
    expect(screen.getByText("2.1 km from the center")).toBeInTheDocument();
    expect(screen.getByText("Buddhist temple in Kyoto, Japan")).toBeInTheDocument();
    expect(screen.getByAltText("Kiyomizu-dera")).toHaveAttribute("src", "https://img/k.jpg");
    const credit = screen.getByRole("link", { name: "Photo credit" });
    expect(credit).toHaveAttribute("href", "https://commons/File:k.jpg");
    expect(credit).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("copes with a place that has no photo, description, type or distance", () => {
    render(<PlaceCard place={{ id: "Q2", name: "Bare Place", theme: "nature" }} days={days} onAdd={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Bare Place" })).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("offers each day of the trip, labelled with a short date, starting at the first", () => {
    render(<PlaceCard place={place} days={days} onAdd={vi.fn()} />);

    const select = screen.getByLabelText("Day for Kiyomizu-dera");
    expect([...select.options].map((o) => o.textContent)).toEqual(["Day 1 · Nov 3", "Day 2 · Nov 4"]);
    expect(select).toHaveValue("10");
  });

  it("adds the place to the day the user picked", async () => {
    const onAdd = vi.fn().mockResolvedValue();
    render(<PlaceCard place={place} days={days} onAdd={onAdd} />);

    fireEvent.change(screen.getByLabelText("Day for Kiyomizu-dera"), { target: { value: "11" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Kiyomizu-dera to itinerary" }));

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith(place, 11));
  });

  it("adds to the first day when the user doesn't choose", async () => {
    const onAdd = vi.fn().mockResolvedValue();
    render(<PlaceCard place={place} days={days} onAdd={onAdd} />);

    fireEvent.click(screen.getByRole("button", { name: "Add Kiyomizu-dera to itinerary" }));

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith(place, 10));
  });

  it("blocks a double add while the first is in flight, then allows another", async () => {
    let finish;
    const onAdd = vi.fn(() => new Promise((resolve) => (finish = resolve)));
    render(<PlaceCard place={place} days={days} onAdd={onAdd} />);

    fireEvent.click(screen.getByRole("button", { name: "Add Kiyomizu-dera to itinerary" }));

    expect(await screen.findByRole("button", { name: "Add Kiyomizu-dera to itinerary" })).toBeDisabled();
    expect(screen.getByText("Adding…")).toBeInTheDocument();
    finish();
    await waitFor(() => expect(screen.getByRole("button", { name: "Add Kiyomizu-dera to itinerary" })).toBeEnabled());
  });

  it("re-enables the button even if adding throws", async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error("nope"));
    render(<PlaceCard place={place} days={days} onAdd={(...a) => onAdd(...a).catch(() => {})} />);

    fireEvent.click(screen.getByRole("button", { name: "Add Kiyomizu-dera to itinerary" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Add Kiyomizu-dera to itinerary" })).toBeEnabled());
  });

  it("tells the user to add a day first when the trip has none", () => {
    render(<PlaceCard place={place} days={[]} onAdd={vi.fn()} />);

    expect(screen.getByText(/Add a day below/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /to itinerary/ })).not.toBeInTheDocument();
  });

  it("falls back to a gradient when the photo fails to load", () => {
    render(<PlaceCard place={place} days={days} onAdd={vi.fn()} />);

    fireEvent.error(screen.getByAltText("Kiyomizu-dera"));

    expect(screen.queryByAltText("Kiyomizu-dera")).not.toBeInTheDocument();
  });
});
