import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ConditionsPanel from "./ConditionsPanel";

const okResponse = {
  status: "ok",
  data: { temperature_c: 18, condition: "Partly cloudy", map_url: "https://maps.example/kyoto.png" },
  checked_at: "2026-09-18T01:30:00Z",
};

describe("ConditionsPanel", () => {
  it("shows a loading indicator while the request is in flight", () => {
    render(<ConditionsPanel load={() => new Promise(() => {})} location="Kyoto, Japan" />);

    expect(screen.getByText(/loading conditions/i)).toBeInTheDocument();
    expect(screen.queryByText(/unavailable/i)).not.toBeInTheDocument();
  });

  it("renders the temperature, condition and map when the upstream succeeded", async () => {
    render(<ConditionsPanel load={() => Promise.resolve(okResponse)} location="Kyoto, Japan" />);

    expect(await screen.findByText(/18°C, Partly cloudy/)).toBeInTheDocument();
    expect(screen.getByAltText("Map of Kyoto, Japan")).toHaveAttribute(
      "src",
      "https://maps.example/kyoto.png"
    );
  });

  it("shows the unavailable badge when the API reports status unavailable", async () => {
    const load = vi.fn().mockResolvedValue({ status: "unavailable", checked_at: "2026-09-18T01:30:00Z" });
    render(<ConditionsPanel load={load} location="Kyoto, Japan" />);

    expect(await screen.findByText("Conditions unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("shows the unavailable badge instead of crashing when the request itself fails", async () => {
    const load = vi.fn().mockRejectedValue(new Error("network down"));
    render(<ConditionsPanel load={load} location="Kyoto, Japan" />);

    expect(await screen.findByText("Conditions unavailable")).toBeInTheDocument();
  });

  it("omits the map image when the provider returned no map url", async () => {
    const load = vi.fn().mockResolvedValue({ ...okResponse, data: { ...okResponse.data, map_url: "" } });
    render(<ConditionsPanel load={load} location="Kyoto, Japan" />);

    expect(await screen.findByText(/18°C/)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
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
