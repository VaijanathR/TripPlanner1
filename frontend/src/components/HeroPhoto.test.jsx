import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HeroPhoto from "./HeroPhoto";

describe("HeroPhoto", () => {
  it("is decorative by default: empty alt text", () => {
    const { container } = render(<HeroPhoto src="/photos/a.jpg" />);
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
  });

  it("keeps descriptive alt text when given", () => {
    const { getByAltText } = render(<HeroPhoto src="https://img/kyoto.jpg" alt="Photo of Kyoto" />);
    expect(getByAltText("Photo of Kyoto")).toBeInTheDocument();
  });

  it("loads eagerly and at high priority only when it is the banner", () => {
    const banner = render(<HeroPhoto src="/photos/a.jpg" eager />).container.querySelector("img");
    expect(banner).toHaveAttribute("loading", "eager");
    expect(banner).toHaveAttribute("fetchpriority", "high");

    const other = render(<HeroPhoto src="/photos/b.jpg" />).container.querySelector("img");
    expect(other).toHaveAttribute("loading", "lazy");
    expect(other).not.toHaveAttribute("fetchpriority");
  });

  it("puts a scrim over the photo so text stays readable", () => {
    const { container } = render(<HeroPhoto src="/photos/a.jpg" />);
    expect(container.querySelector(".hero-scrim")).toBeInTheDocument();
  });

  it("leaves no broken image or empty scrim behind when the photo cannot load", () => {
    const { container } = render(<HeroPhoto src="/photos/gone.jpg" />);
    fireEvent.error(container.querySelector("img"));
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(container.querySelector(".hero-scrim")).not.toBeInTheDocument();
  });

  it("renders nothing without a source", () => {
    const { container } = render(<HeroPhoto src={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
