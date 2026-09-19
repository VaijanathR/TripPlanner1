import { describe, expect, it } from "vitest";
import { shortDate } from "./format";

describe("shortDate", () => {
  it("formats an ISO date as month and day", () => {
    expect(shortDate("2026-11-03")).toBe("Nov 3");
    expect(shortDate("2027-02-14")).toBe("Feb 14");
  });

  it("does not shift the day across time zones", () => {
    expect(shortDate("2026-01-01")).toBe("Jan 1");
    expect(shortDate("2026-12-31")).toBe("Dec 31");
  });

  it("returns the input unchanged when it isn't a date", () => {
    expect(shortDate("soon")).toBe("soon");
    expect(shortDate("")).toBe("");
  });
});
