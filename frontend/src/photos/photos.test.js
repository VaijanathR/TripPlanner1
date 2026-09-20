import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import manifest from "../data/photos.json";
import { allPhotos, loginPhoto, pickBanner, STRIP_TILES, tripCardPhoto, tripHeaderPhoto } from "./photos";

// Tests run from the frontend folder.
const folder = resolve("public/photos") + "/";
const KB = 1024;
// Public domain, CC0, or CC BY -- never share-alike, no-derivatives or non-commercial.
const ALLOWED_LICENSE = /^(Public domain|CC0( 1\.0)?|CC BY \d\.\d)$/;

describe("photo manifest: licences and credits", () => {
  it("records author, licence and source for every photo", () => {
    expect(allPhotos.length).toBeGreaterThan(0);
    for (const photo of allPhotos) {
      expect(photo.author.trim(), photo.id).not.toBe("");
      expect(photo.title.trim(), photo.id).not.toBe("");
      expect(photo.sourceUrl, photo.id).toMatch(/^https:\/\/commons\.wikimedia\.org\//);
      expect(photo.changes.trim(), photo.id).not.toBe("");
    }
  });

  it("only uses public domain, CC0 or CC BY, never share-alike", () => {
    for (const photo of allPhotos) {
      expect(photo.license, photo.id).toMatch(ALLOWED_LICENSE);
      expect(photo.license, photo.id).not.toMatch(/SA|NC|ND/);
      if (photo.license !== "Public domain") expect(photo.licenseUrl, photo.id).toMatch(/^https:\/\/creativecommons\.org\//);
    }
  });

  it("covers the four themes: flying, boats, road trips and nature", () => {
    const themes = new Set(allPhotos.map((p) => p.theme));
    for (const theme of ["flight", "boat", "road", "nature"]) expect(themes, theme).toContain(theme);
  });
});

describe("photo manifest: files", () => {
  const referenced = allPhotos.flatMap((p) => Object.entries(p.files).map(([variant, file]) => ({ id: p.id, variant, file })));

  it("has every file it names, and no file it does not name", () => {
    for (const { id, file } of referenced) expect(existsSync(folder + file), `${id}: ${file}`).toBe(true);
    const named = new Set(referenced.map((r) => r.file));
    expect(readdirSync(folder).filter((f) => !named.has(f))).toEqual([]);
  });

  it("keeps the banner under 350 KB and every other photo under 150 KB", () => {
    for (const { id, variant, file } of referenced) {
      const limit = variant === "wide" ? 350 * KB : 150 * KB;
      expect(statSync(folder + file).size, `${id} ${variant}`).toBeLessThanOrEqual(limit);
    }
  });

  it("has the right size of file for every job it does", () => {
    const { roles, photos } = manifest;
    for (const id of roles.banner) expect(photos[id].files.wide, id).toBeTruthy();
    expect(photos[roles.login].files.panel).toBeTruthy();
    for (const id of roles.set) {
      expect(photos[id].files.header, id).toBeTruthy();
      expect(photos[id].files.card, id).toBeTruthy();
    }
    for (const id of Object.values(roles.strip)) expect(photos[id].files.card, id).toBeTruthy();
  });

  it("credits every photo that is used", () => {
    const { roles } = manifest;
    const used = [...roles.banner, roles.login, ...roles.set, ...Object.values(roles.strip)];
    const credited = new Set(allPhotos.map((p) => p.id));
    for (const id of used) expect(credited.has(id), id).toBe(true);
  });
});

describe("choosing photos", () => {
  beforeEach(() => localStorage.clear());

  it("picks a banner from the approved banner photos", () => {
    const wide = manifest.roles.banner.map((id) => manifest.photos[id].files.wide);
    for (let i = 0; i < 20; i += 1) {
      localStorage.clear();
      const { url } = pickBanner();
      expect(wide.some((file) => url.endsWith(file))).toBe(true);
    }
  });

  it("shows a different banner on the next visit", () => {
    for (let i = 0; i < 40; i += 1) {
      const first = pickBanner();
      const next = pickBanner();
      expect(next.id).not.toBe(first.id);
    }
  });

  it("can pick every banner, not just one", () => {
    const seen = new Set();
    for (let i = 0; i < 60; i += 1) seen.add(pickBanner().id);
    expect(seen.size).toBe(manifest.roles.banner.length);
  });

  it("still picks a banner when storage is unavailable", () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error("blocked");
    };
    try {
      expect(pickBanner().url).toMatch(/photos\/.+-wide\.jpg$/);
    } finally {
      Storage.prototype.getItem = original;
    }
  });

  it("gives the same trip the same set photo every time", () => {
    for (const id of [1, 2, 3, 42, "abc"]) {
      expect(tripHeaderPhoto(id)).toEqual(tripHeaderPhoto(id));
      expect(tripCardPhoto(id).id).toBe(tripHeaderPhoto(id).id);
    }
  });

  it("spreads different trips over the set photos", () => {
    const ids = new Set(Array.from({ length: 60 }, (_, i) => tripCardPhoto(i + 1).id));
    expect(ids.size).toBeGreaterThan(3);
    for (const id of ids) expect(manifest.roles.set).toContain(id);
  });

  it("offers the login panel photo and the four strip tiles", () => {
    expect(loginPhoto().url).toMatch(/panel\.jpg$/);
    expect(STRIP_TILES.map((t) => t.key)).toEqual(["fly", "sail", "drive", "rails"]);
    expect(STRIP_TILES.map((t) => t.label)).toEqual(["Fly", "Sail", "Drive", "Ride the rails"]);
  });
});
