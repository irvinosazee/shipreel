import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { checkCommon, checkCopyDir, checkLinkedIn, checkProductHunt, checkShowHN, checkX, parseProductHunt, parseThread, xLength } from "../skills/shipreel/scripts/copy_check.mjs";
import { xThread } from "../skills/shipreel/scripts/launch_kit.mjs";

const codes = (r) => r.errors.map((e) => e.code);
const warns = (r) => r.warnings.map((w) => w.code);

test("xLength counts the way X does: links are 23, emoji 2", () => {
  assert.equal(xLength("hello"), 5);
  assert.equal(xLength("try https://github.com/irvinosazee/shipreel/blob/main/README.md now"), 4 + 23 + 4);
  assert.equal(xLength("see shipreel.dev"), 4 + 23);
  assert.equal(xLength("🚀"), 2);
  assert.equal(xLength("—"), 1);
});

test("checkX: a post over 280 fails, and the counter counts", () => {
  assert.deepEqual(codes(checkX(["a".repeat(280)])), []);
  assert.deepEqual(codes(checkX([`1/2\n${"a".repeat(278)}`])), ["too-long"]);
  assert.deepEqual(warns(checkX(["ship it #a #b #c #d"])), ["hashtags"]);
  assert.deepEqual(codes(checkX([])), ["empty"]);
});

test("launch_kit's thread leaves room for its own counter", () => {
  const thread = xThread({ caption: Array.from({ length: 30 }, (_, i) => `Sentence number ${i} about the tool.`).join(" "), url: "https://x.dev" });
  const posted = thread.map((p, i) => `${i + 1}/${thread.length}\n${p}`);
  assert.deepEqual(codes(checkX(posted)), [], posted.map(xLength).join(","));
});

test("parseThread splits on counters and keeps them in the post", () => {
  assert.deepEqual(parseThread("1/2\nfirst post\n\nstill first\n\n2/2\nsecond"), ["1/2\nfirst post\n\nstill first", "2/2\nsecond"]);
});

test("checkLinkedIn: 3000 cap, and a warning when the hook sits below the fold", () => {
  assert.deepEqual(codes(checkLinkedIn("x".repeat(3001))), ["too-long"]);
  assert.deepEqual(warns(checkLinkedIn(`${"word ".repeat(60)}\n\nmore`)), ["hook-below-fold"]);
  assert.deepEqual(warns(checkLinkedIn(`I built a thing.\n\n${"word ".repeat(80)}`)), []);
});

test("checkShowHN: the title prefix and 80-character limit", () => {
  assert.deepEqual(codes(checkShowHN({ title: "Show HN: shipreel, launch videos that check themselves" })), []);
  assert.deepEqual(codes(checkShowHN({ title: "shipreel: launch videos" })), ["show-hn-title"]);
  assert.deepEqual(codes(checkShowHN({ title: `Show HN: ${"x".repeat(80)}` })), ["too-long"]);
  assert.deepEqual(warns(checkShowHN({ title: "Show HN: The BEST launch tool!" })), ["hn-tone"]);
  assert.deepEqual(warns(checkShowHN({ title: "Show HN: thing", body: "no link here" })), ["no-link"]);
});

test("checkProductHunt: tagline 60, description 260, both from the file launch_kit writes", () => {
  const ph = parseProductHunt("Name: tidy\nTagline: Inbox zero, finally\n\nDescription:\nSorts mail.\nTwo lines.\n\nGallery: images/producthunt-*.jpg");
  assert.deepEqual(ph, { name: "tidy", tagline: "Inbox zero, finally", description: "Sorts mail.\nTwo lines." });
  assert.deepEqual(codes(checkProductHunt(ph)), []);
  assert.deepEqual(codes(checkProductHunt({ ...ph, tagline: "t".repeat(61) })), ["too-long"]);
  assert.deepEqual(codes(checkProductHunt({ ...ph, description: "d".repeat(261) })), ["too-long"]);
});

test("checkCommon: filler words, uncited numbers, em dashes", () => {
  const r = checkCommon("Supercharge your releases — 10x faster videos.\nOne plan, 26 platforms.", { claims: [{ text: "26 platforms" }], brand: { bannedWords: ["releases"] } });
  assert.deepEqual(codes(r).sort(), ["banned-word", "banned-word", "uncited-claim"]);
  assert.deepEqual(warns(r), ["em-dash"]);
  assert.ok(r.errors.some((e) => e.message.includes("10x faster")));
});

test("checkCopyDir checks every copy file present", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "shipreel-copy-"));
  try {
    writeFileSync(path.join(dir, "x-thread.txt"), "1/2\nshipreel makes launch videos.\n\n2/2\ntry it: https://github.com/irvinosazee/shipreel");
    writeFileSync(path.join(dir, "showhn.txt"), "shipreel: launch videos\nhttps://github.com/irvinosazee/shipreel");
    const report = checkCopyDir(dir);
    assert.equal(report.ok, false);
    assert.deepEqual(report.files.map((f) => [f.file, codes(f)]), [["x-thread.txt", []], ["showhn.txt", ["show-hn-title"]]]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
