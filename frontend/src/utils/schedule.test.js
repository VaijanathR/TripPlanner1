import { describe, expect, it } from "vitest";
import { nextSlot } from "./schedule";

const act = (start, end) => ({ start_time: start, end_time: end });

describe("nextSlot", () => {
  it("starts an empty day at 09:00 for two hours", () => {
    expect(nextSlot([])).toEqual({ start_time: "09:00", end_time: "11:00" });
  });

  it("starts right after the day's last activity", () => {
    expect(nextSlot([act("08:00", "11:00"), act("12:00", "13:30")])).toEqual({
      start_time: "13:30",
      end_time: "15:30",
    });
  });

  it("uses the latest end time even when activities are listed out of order", () => {
    expect(nextSlot([act("15:00", "17:00"), act("08:00", "09:00")])).toEqual({
      start_time: "17:00",
      end_time: "19:00",
    });
  });

  it("accepts the API's HH:MM:SS times", () => {
    expect(nextSlot([act("08:00:00", "10:15:00")])).toEqual({ start_time: "10:15", end_time: "12:15" });
  });

  it("never runs past midnight", () => {
    expect(nextSlot([act("20:00", "22:30")])).toEqual({ start_time: "22:30", end_time: "23:59" });
  });

  it("falls back to a morning slot when the day is already full to midnight, so the times stay valid", () => {
    const slot = nextSlot([act("20:00", "23:59")]);

    expect(slot).toEqual({ start_time: "09:00", end_time: "11:00" });
    expect(slot.end_time > slot.start_time).toBe(true);
  });

  it("always produces an end after the start (the rule the editor and the server enforce)", () => {
    for (const end of ["00:00", "06:45", "12:00", "21:59", "22:00", "23:00", "23:58", "23:59"]) {
      const { start_time, end_time } = nextSlot([act("00:00", end)]);
      expect(end_time > start_time).toBe(true);
    }
  });
});
