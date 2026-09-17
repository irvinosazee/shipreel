import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DEFAULT_BANNED, validateBrand, loadBrand, compositionText, bannedHits, captionTheme } from "../skills/brag/scripts/brand.mjs";

const good = {
  name: "Horse Tinder",
  tone: "yc-parody",
  palette: { bg: "#1a120c", fg: "#fff6ec", accent: "#e8963a" },
  fonts: { display: "Fraunces", body: "Inter" },
  handle: "@horsetinder",
  url: "https://horsetinder.app",
  bannedWords: ["dating site"],
  watermark: false,
  captions: { style: "lower-third" },
};

test("validateBrand accepts a complete brand kit", () => {
  assert.deepEqual(validateBrand(good).problems, []);
});

test("validateBrand reports every bad field with its path", () => {
  const { problems } = validateBrand({
    palette: { bg: "black", fg: "#fff" },
    fonts: {},
    handle: "not a handle!",
    url: "horsetinder.app",
    bannedWords: "dating",
    watermark: "yes",
    captions: { style: "subtitles" },
    logo: "assets/missing-logo.svg",
  }, { projectDir: tmpdir() });
  const text = problems.join("\n");
  assert.match(text, /palette\.bg "black" is not a hex color/);
  assert.match(text, /palette\.accent is required/);
  assert.match(text, /fonts\.display is required/);
  assert.match(text, /handle "not a handle!"/);
  assert.match(text, /url "horsetinder\.app" must start with http:\/\/ or https:\/\//);
  assert.match(text, /bannedWords must be a list/);
  assert.match(text, /watermark must be true or false/);
  assert.match(text, /captions\.style "subtitles"/);
  assert.match(text, /logo assets\/missing-logo\.svg does not exist/);
});

test("loadBrand returns null without .brag/config.json and validates it when present", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "brag-brand-"));
  try {
    assert.equal(loadBrand(dir), null);
    mkdirSync(path.join(dir, ".brag"));
    writeFileSync(path.join(dir, ".brag", "config.json"), JSON.stringify(good));
    const loaded = loadBrand(dir);
    assert.equal(loaded.brand.name, "Horse Tinder");
    assert.deepEqual(loaded.problems, []);
    writeFileSync(path.join(dir, ".brag", "config.json"), "{ nope");
    assert.match(loadBrand(dir).problems[0], /not valid JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("compositionText keeps visible copy and drops scripts, styles, comments, and tags", () => {
  const html = `<html><head><style>.x{content:"streamline"}</style></head><body>
    <div data-composition-id="main"><!-- supercharge --><h1>Swipe &amp; match</h1><p>Find your stablemate</p>
    <script>const t = "unlock";</script></div></body></html>`;
  assert.equal(compositionText(html), "Swipe & match Find your stablemate");
});

test("bannedHits finds the brand's and the default generic phrases, case-insensitively", () => {
  assert.ok(DEFAULT_BANNED.includes("streamline your workflow"));
  const hits = bannedHits("The best Dating Site to Supercharge your pasture.", good);
  assert.deepEqual(hits.map((h) => h.phrase).sort(), ["dating site", "supercharge"]);
  assert.match(hits.find((h) => h.phrase === "dating site").context, /best Dating Site to/);
  assert.deepEqual(bannedHits("Unlocked stable doors.", good), [], "whole words only");
});

test("captionTheme maps the brand palette and fonts onto a caption band", () => {
  const band = { x: 96, y: 1230, width: 816, height: 190 };
  assert.deepEqual(captionTheme(good, band), { font: "Inter", fg: "#fff6ec", bg: "#1a120c", accent: "#e8963a", band });
});
