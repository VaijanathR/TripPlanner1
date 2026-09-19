import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Photo from "./Photo";

describe("Photo", () => {
  it("shows the image when there is one", () => {
    render(<Photo className="frame" src="https://x/y.jpg" alt="Kyoto" />);

    expect(screen.getByAltText("Kyoto")).toHaveAttribute("src", "https://x/y.jpg");
  });

  it("stands in a gradient, with no broken image, when there is no source", () => {
    const { container } = render(<Photo className="frame" src={null} alt="Kyoto" />);

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(container.firstChild.style.backgroundImage).toContain("linear-gradient");
  });

  it("falls back to the gradient when the image fails to load", () => {
    const { container } = render(<Photo className="frame" src="https://x/gone.jpg" alt="Kyoto" />);

    fireEvent.error(screen.getByAltText("Kyoto"));

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(container.firstChild.style.backgroundImage).toContain("linear-gradient");
  });

  it("gives the same place the same colours every time", () => {
    const a = render(<Photo className="f" src={null} alt="Nijo Castle" />).container.firstChild.style.backgroundImage;
    const b = render(<Photo className="f" src={null} alt="Nijo Castle" />).container.firstChild.style.backgroundImage;

    expect(a).toBe(b);
  });
});
