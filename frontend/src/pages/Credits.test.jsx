import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import Credits from "./Credits";
import { allPhotos } from "../photos/photos";

function renderCredits() {
  return render(
    <MemoryRouter>
      <Credits />
    </MemoryRouter>
  );
}

describe("Credits page", () => {
  it("lists every photo with its author, licence and source", () => {
    renderCredits();
    const items = within(screen.getByRole("list", { name: "Photos" })).getAllByRole("listitem");
    expect(items).toHaveLength(allPhotos.length);

    allPhotos.forEach((photo, i) => {
      const item = within(items[i]);
      expect(item.getByText(photo.title)).toBeInTheDocument();
      expect(items[i].textContent).toContain(photo.author);
      expect(items[i].textContent).toContain(photo.license);
      expect(item.getByRole("link", { name: /Original on Wikimedia Commons/ })).toHaveAttribute("href", photo.sourceUrl);
    });
  });

  it("links each licence to its text", () => {
    renderCredits();
    const withLicenceUrl = allPhotos.filter((p) => p.licenseUrl);
    for (const photo of withLicenceUrl) {
      const links = screen.getAllByRole("link", { name: photo.license }).map((a) => a.getAttribute("href"));
      expect(links).toContain(photo.licenseUrl);
    }
  });

  it("says what was changed, and uses empty alt on the thumbnails", () => {
    const { container } = renderCredits();
    expect(screen.getAllByText(/Resized and recompressed/)).toHaveLength(allPhotos.length);
    for (const img of container.querySelectorAll("img")) expect(img).toHaveAttribute("alt", "");
  });

  it("offers a way back", () => {
    renderCredits();
    expect(screen.getByRole("link", { name: /Back to Trip Planner/ })).toHaveAttribute("href", "/");
  });
});
