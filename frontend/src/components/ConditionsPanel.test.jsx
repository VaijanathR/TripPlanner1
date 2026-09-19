import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ConditionsPanel from "./ConditionsPanel";

const okResponse = {
  status: "ok",
  data: {
    temperature_c: 18,
    condition: "Partly cloudy",
    map_url: "https://www.openstreetmap.org/?mlat=35.02&mlon=135.75",
    map_embed_url: "https://www.openstreetmap.org/export/embed.html?bbox=1%2C2%2C3%2C4",
  },
  checked_at: "2026-09-18T01:30:00Z",
};

describe("ConditionsPanel", () => {
  it("shows a loading indicator while the request is in flight", () => {
    render(<ConditionsPanel load={() => new Promise(() => {})} location="Kyoto, Japan" />);

    expect(screen.getByText(/loading conditions/i)).toBeInTheDocument();
    expect(screen.queryByText(/unavailable/i)).not.toBeInTheDocument();
  });

  it("renders the temperature, condition, an embedded map and a larger-map link when the upstream succeeded", async () => {
    render(<ConditionsPanel load={() => Promise.resolve(okResponse)} location="Kyoto, Japan" />);

    expect(await screen.findByText(/18°C, Partly cloudy/)).toBeInTheDocument();
    expect(screen.getByTitle("Map of Kyoto, Japan")).toHaveAttribute("src", okResponse.data.map_embed_url);
    const link = screen.getByRole("link", { name: "View larger map" });
    expect(link).toHaveAttribute("href", okResponse.data.map_url);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("shows the unavailable badge when the API reports status unavailable", async () => {
    const load = vi.fn().mockResolvedValue({ status: "unavailable", checked_at: "2026-09-18T01:30:00Z" });
    render(<ConditionsPanel load={load} location="Kyoto, Japan" />);

    expect(await screen.findByText("Conditions unavailable")).toBeInTheDocument();
    expect(screen.queryByTitle(/Map of/)).not.toBeInTheDocument();
  });

  it("shows the unavailable badge instead of crashing when the request itself fails", async () => {
    const load = vi.fn().mockRejectedValue(new Error("network down"));
    render(<ConditionsPanel load={load} location="Kyoto, Japan" />);

    expect(await screen.findByText("Conditions unavailable")).toBeInTheDocument();
  });

  it("omits the map and link when the provider returned no map urls", async () => {
    const load = vi.fn().mockResolvedValue({
      ...okResponse,
      data: { ...okResponse.data, map_url: "", map_embed_url: "" },
    });
    render(<ConditionsPanel load={load} location="Kyoto, Japan" />);

    expect(await screen.findByText(/18°C/)).toBeInTheDocument();
    expect(screen.queryByTitle(/Map of/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it.each([
    ["an empty object", {}],
    ["status ok with no data", { status: "ok" }],
    ["null", null],
  ])("shows the unavailable badge instead of crashing on a malformed response (%s)", async (_label, body) => {
    render(<ConditionsPanel load={() => Promise.resolve(body)} location="Kyoto, Japan" />);

    expect(await screen.findByText("Conditions unavailable")).toBeInTheDocument();
  });
});
