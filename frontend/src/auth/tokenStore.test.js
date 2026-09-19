import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tokenStore } from "./tokenStore";

beforeEach(() => {
  localStorage.clear();
  tokenStore.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("tokenStore", () => {
  it("returns nothing when no token has been stored", () => {
    expect(tokenStore.get()).toBeNull();
  });

  it("stores a token in localStorage and reads it back", () => {
    tokenStore.set("abc.def.ghi");

    expect(tokenStore.get()).toBe("abc.def.ghi");
    expect(localStorage.getItem("tripplanner.token")).toBe("abc.def.ghi");
  });

  it("clear removes the token from storage and memory", () => {
    tokenStore.set("abc");

    tokenStore.clear();

    expect(tokenStore.get()).toBeNull();
    expect(localStorage.getItem("tripplanner.token")).toBeNull();
  });

  it("keeps working from memory when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(() => tokenStore.set("in-memory")).not.toThrow();
    expect(tokenStore.get()).toBe("in-memory");
    expect(() => tokenStore.clear()).not.toThrow();
    expect(tokenStore.get()).toBeNull();
  });
});
