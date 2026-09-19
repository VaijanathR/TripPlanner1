import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./client";
import { destinationsApi } from "./destinations";

vi.mock("./client", () => ({
  api: { get: vi.fn(), put: vi.fn(), del: vi.fn(), post: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({});
});

describe("destinationsApi", () => {
  it("searches with just the city when nothing else was typed", async () => {
    await destinationsApi.search({ city: "Paris", state: "", country: "   " });

    expect(api.get).toHaveBeenCalledWith("/destinations/search?city=Paris");
  });

  it("adds trimmed state and country when given", async () => {
    await destinationsApi.search({ city: "Paris", state: " Texas ", country: "United States" });

    expect(api.get).toHaveBeenCalledWith("/destinations/search?city=Paris&state=Texas&country=United+States");
  });

  it("encodes characters that would otherwise break the query", async () => {
    await destinationsApi.search({ city: "São Paulo & co", state: "", country: "" });

    expect(api.get).toHaveBeenCalledWith("/destinations/search?city=S%C3%A3o+Paulo+%26+co");
  });

  it("sets a destination by id only", async () => {
    await destinationsApi.set(5, 1857910);

    expect(api.put).toHaveBeenCalledWith("/trips/5/destination", { geoname_id: 1857910 });
  });

  it("clears a destination and reads a guide from the trip's endpoints", async () => {
    await destinationsApi.clear(5);
    await destinationsApi.guide(5);

    expect(api.del).toHaveBeenCalledWith("/trips/5/destination");
    expect(api.get).toHaveBeenCalledWith("/trips/5/guide");
  });
});
