import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { deskHtml } from "../skills/shipreel/scripts/desk.mjs";
import { faviconSvg, faviconTag, MARK } from "../skills/shipreel/scripts/favicon.mjs";
import { buildStudioPage } from "../skills/shipreel/scripts/studio.mjs";
import { buildUploadPage } from "../skills/shipreel/scripts/upload_page.mjs";

const scripts = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "skills", "shipreel", "scripts");
const icon = (html) => html.match(/<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml,([^"]+)">/)?.[1];

test("the mark is the site's: a slash on a rounded square, in shipreel's colours by default", () => {
  const svg = faviconSvg();
  assert.match(svg, /rx="14" fill="#f4430c"/);
  assert.match(svg, /M40 11 L24 53" stroke="#210200"/);
});

test("a brand accent tints the mark; anything that is not a hex colour falls back", () => {
  assert.match(faviconSvg({ fill: "#22aa88", ink: "#fff" }), /fill="#22aa88".*stroke="#fff"/);
  const bad = faviconSvg({ fill: '"/><script>', ink: "red" });
  assert.ok(bad.includes(`fill="${MARK.fill}"`) && bad.includes(`stroke="${MARK.ink}"`));
  assert.doesNotMatch(bad, /script/);
});

test("the tag is an inline data URI, so a page opened from disk needs no extra file", () => {
  assert.equal(decodeURIComponent(icon(faviconTag())), faviconSvg());
});

test("every page people open carries the mark: desk (in its accent), studio, upload checklist", () => {
  const desk = deskHtml({ product: "Tidy", accent: "#3355ff", onAccent: "#ffffff", days: [], pieces: {} });
  assert.match(decodeURIComponent(icon(desk)), /fill="#3355ff".*stroke="#ffffff"/);
  assert.equal(decodeURIComponent(icon(deskHtml())), faviconSvg());
  assert.ok(icon(buildStudioPage({ title: "Tidy", renders: [] })));
  assert.ok(icon(buildUploadPage({ title: "Tidy", exports: [] })));
});

test("no script writes a page for people to open without the shared favicon", () => {
  // Compositions rendered headless (cards, videos, PR previews) are frames, not pages anyone opens.
  const frames = new Set(["cards.mjs", "template_video.mjs", "pr_preview.mjs"]);
  for (const file of readdirSync(scripts).filter((f) => f.endsWith(".mjs") && !frames.has(f))) {
    const source = readFileSync(path.join(scripts, file), "utf8");
    if (/<!doctype html>/i.test(source)) assert.match(source, /faviconTag\(/, `${file} writes a page without faviconTag()`);
  }
});
