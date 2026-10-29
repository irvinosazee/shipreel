import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { normalizeText, sourceText, findUncitedClaims, verifyClaims } from "../skills/shipreel/scripts/claims.mjs";

function project() {
  const dir = mkdtempSync(path.join(tmpdir(), "shipreel-claims-"));
  mkdirSync(path.join(dir, "site"));
  writeFileSync(path.join(dir, "site", "index.html"), `<section><h2>Available in <strong>12&nbsp;metros</strong></h2><p>99.1% fleet uptime</p></section>`);
  writeFileSync(path.join(dir, "README.md"), "Taxi for Taxis moves 8,400 cabs a day.");
  return dir;
}

test("normalizeText collapses whitespace, entities, curly quotes, and case", () => {
  assert.equal(normalizeText("Let’s  SHIP&nbsp;it\n now"), "let's ship it now");
});

test("sourceText reads visible text from HTML and raw text from everything else", () => {
  const dir = project();
  try {
    assert.equal(sourceText(path.join(dir, "site", "index.html")), "available in 12 metros 99.1% fleet uptime");
    assert.match(sourceText(path.join(dir, "README.md")), /8,400 cabs a day/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("verifyClaims confirms each quote in its cited source and names what fails", () => {
  const dir = project();
  try {
    const { verified, problems } = verifyClaims(
      [
        { text: "Available in 12 metros", source: "site/index.html", quote: "Available in 12 metros" },
        { text: "8,400 cabs a day", source: "README.md", quote: "8,400 cabs a day" },
        { text: "99.9% uptime", source: "site/index.html", quote: "99.9% fleet uptime" },
        { text: "Loved by drivers", source: "site/missing.html", quote: "loved" },
        { text: "No source" },
        { text: "4,210 GitHub stars", source: "https://api.github.com/repos/acme/app", value: 4210, fetchedAt: "2026-09-17T04:00:00Z" },
      ],
      { projectDir: dir },
    );
    assert.equal(verified, 3, "file quotes found and the fetched metric (URL + value + fetchedAt) count as verified");
    assert.deepEqual(problems, [
      '"99.9% uptime": quote "99.9% fleet uptime" not found in site/index.html',
      '"Loved by drivers": source site/missing.html does not exist',
      '"No source": needs a source file and quote, or a fetched metric',
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("findUncitedClaims flags numbers and superlatives on screen that no claim covers", () => {
  const screen = "Available in 12 metros. 99.1% fleet uptime. 10x faster pickups. The fastest cab app ever. Book in 3 taps.";
  const claims = [{ text: "Available in 12 metros" }, { text: "99.1% fleet uptime" }];
  assert.deepEqual(findUncitedClaims(screen, claims), ["10x faster", "The fastest", "3 taps"]);
});

test("findUncitedClaims ignores times, dates, versions, and aspect labels", () => {
  assert.deepEqual(findUncitedClaims("00:17 / 00:20 · 9:16 · 1080P · v2.1 · 2026 · step 1", []), []);
});

test("findUncitedClaims ignores clause-ending numbers and -est words that are not superlatives", () => {
  assert.deepEqual(findUncitedClaims("baked into frame 0, and checked against the latest Hyperframes by the test suite", []), []);
  assert.deepEqual(findUncitedClaims("the fastest tool, 1,200 users, 10x faster", []), ["the fastest", "1,200 users", "10x faster"]);
});
