import manifest from "../data/photos.json";

// The licensed travel photos: which photo does which job. Every photo's author,
// licence and source is recorded in data/photos.json and listed on /credits.
const { photos, roles } = manifest;

export const allPhotos = Object.entries(photos).map(([id, photo]) => ({ id, ...photo }));

const LAST_BANNER_KEY = "trip-planner:last-banner";

export function photoUrl(file) {
  return `${import.meta.env.BASE_URL}photos/${file}`;
}

function describe(id, variant) {
  return { id, url: photoUrl(photos[id].files[variant]) };
}

function lastBanner() {
  try {
    return localStorage.getItem(LAST_BANNER_KEY);
  } catch {
    return null;
  }
}

function rememberBanner(id) {
  try {
    localStorage.setItem(LAST_BANNER_KEY, id);
  } catch {
    // Private windows can refuse storage; the banner just may repeat.
  }
}

// The Trip List banner: a different one of the picks each visit (never the same
// twice running). `random` is injectable so tests are deterministic.
export function pickBanner(random = Math.random) {
  const previous = lastBanner();
  const choices = roles.banner.filter((id) => id !== previous);
  const id = choices[Math.floor(random() * choices.length)];
  rememberBanner(id);
  return describe(id, "wide");
}

export function loginPhoto() {
  return describe(roles.login, "panel");
}

// A trip with no destination photo gets one of the set photos. The choice comes
// from the trip's own id, so the same trip always looks the same.
function hash(key) {
  const text = String(key ?? "");
  let value = 0;
  for (let i = 0; i < text.length; i += 1) value = (value * 31 + text.charCodeAt(i)) >>> 0;
  return value;
}

function setPhotoId(key) {
  return roles.set[hash(key) % roles.set.length];
}

export function tripHeaderPhoto(key) {
  return describe(setPhotoId(key), "header");
}

export function tripCardPhoto(key) {
  return describe(setPhotoId(key), "card");
}

// The four tiles of the "Travel your way" strip.
export const STRIP_TILES = [
  { key: "fly", label: "Fly" },
  { key: "sail", label: "Sail" },
  { key: "drive", label: "Drive" },
  { key: "rails", label: "Ride the rails" },
].map((tile) => ({ ...tile, ...describe(roles.strip[tile.key], "card") }));
