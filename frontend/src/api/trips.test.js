import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./client";
import { tripsApi } from "./trips";

vi.mock("./client", () => ({ api: { get: vi.fn(), post: vi.fn(), del: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());

describe("tripsApi.create", () => {
  it("sends just the name when no place is given", () => {
    tripsApi.create("Undecided");
    expect(api.post).toHaveBeenCalledWith("/trips", { name: "Undecided" });
  });

  it("sends the chosen place's id along with the name, so the trip is created with its destination", () => {
    tripsApi.create("Kyoto in Autumn", 1857910);
    expect(api.post).toHaveBeenCalledWith("/trips", { name: "Kyoto in Autumn", geoname_id: 1857910 });
  });
});
