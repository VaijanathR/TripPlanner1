import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import TravelStrip from "./TravelStrip";

describe("TravelStrip", () => {
  it("shows four tiles: fly, sail, drive, ride the rails", () => {
    const { container } = render(<TravelStrip />);
    expect(screen.getByRole("heading", { name: "Travel your way" })).toBeInTheDocument();
    expect([...container.querySelectorAll("figcaption")].map((c) => c.textContent)).toEqual([
      "Fly",
      "Sail",
      "Drive",
      "Ride the rails",
    ]);
  });

  it("is decorative: photos have empty alt and nothing can be clicked", () => {
    const { container } = render(<TravelStrip />);
    const images = container.querySelectorAll("img");
    expect(images).toHaveLength(4);
    for (const img of images) expect(img).toHaveAttribute("alt", "");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("loads each photo only as it comes into view", () => {
    const { container } = render(<TravelStrip />);
    for (const img of container.querySelectorAll("img")) expect(img).toHaveAttribute("loading", "lazy");
  });

  it("stands a gradient in for a photo that cannot load", () => {
    const { container } = render(<TravelStrip />);
    fireEvent.error(container.querySelector("img"));
    expect(container.querySelectorAll("img")).toHaveLength(3);
    expect(container.querySelector(".travel-tile-photo").style.backgroundImage).toContain("linear-gradient");
  });
});
