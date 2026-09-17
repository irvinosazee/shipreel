import { test } from "node:test";
import assert from "node:assert/strict";

import { replaceHook } from "../skills/brag/scripts/hooks.mjs";
import { youtubeChapters } from "../skills/brag/scripts/cuts.mjs";

test("replaceHook swaps only the marked hook region", () => {
  const html = `<div data-composition-id="m">\n<!-- brag:hook:start -->\n<h1>old</h1>\n<!-- brag:hook:end -->\n<p>rest</p></div>`;
  const out = replaceHook(html, "<h1>new hook</h1>");
  assert.match(out, /<!-- brag:hook:start -->\n<h1>new hook<\/h1>\n<!-- brag:hook:end -->/);
  assert.match(out, /<p>rest<\/p>/);
  assert.throws(() => replaceHook("<div></div>", "x"), /brag:hook:start/);
});

test("youtubeChapters follows YouTube's rules: starts at 00:00, 3+ chapters, each 10s or longer", () => {
  const scenes = [
    { name: "Hook", start: 0, end: 6 },
    { name: "Upload", start: 6, end: 20 },
    { name: "Processing", start: 20, end: 34 },
    { name: "Results", start: 34, end: 50 },
  ];
  assert.equal(youtubeChapters(scenes), "00:00 Hook & Upload\n00:20 Processing\n00:34 Results");
  assert.throws(() => youtubeChapters([{ name: "A", start: 0, end: 12 }, { name: "B", start: 12, end: 25 }]), /at least 3 chapters/);
});
