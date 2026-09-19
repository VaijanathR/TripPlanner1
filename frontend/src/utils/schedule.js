const toMinutes = (t) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
const toTime = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

const DEFAULT_START = "09:00";
const DEFAULT_LENGTH_MIN = 120;
const LAST_MINUTE = 23 * 60 + 59;

// A start and end time for a new activity: right after the day's last activity,
// two hours long, never running past midnight. An empty day starts at 09:00.
export function nextSlot(activities) {
  const ends = activities.map((a) => a.end_time?.slice(0, 5)).filter(Boolean).sort();
  const start = ends.length ? toMinutes(ends[ends.length - 1]) : toMinutes(DEFAULT_START);
  const end = Math.min(start + DEFAULT_LENGTH_MIN, LAST_MINUTE);
  if (start >= end) {
    // The day is already full to midnight: fall back to a morning slot.
    return { start_time: DEFAULT_START, end_time: toTime(toMinutes(DEFAULT_START) + DEFAULT_LENGTH_MIN) };
  }
  return { start_time: toTime(start), end_time: toTime(end) };
}
