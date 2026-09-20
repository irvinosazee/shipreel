import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { minLegiblePx, readingNeed, longestRun, analyzeSamples, findChrome, auditComposition } from "../skills/shipreel/scripts/text_audit.mjs";

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "readability");

test("minLegiblePx scales with the frame's short side", () => {
  assert.deepEqual(minLegiblePx([1080, 1920]), { any: 28, body: 40 });
  assert.deepEqual(minLegiblePx([1920, 1080]), { any: 28, body: 40 });
  assert.deepEqual(minLegiblePx([2160, 3840]), { any: 56, body: 80 });
});

test("readingNeed is 0.3s per word with a 0.8s floor", () => {
  assert.equal(readingNeed(1), 0.8);
  assert.equal(readingNeed(7), 2.1);
});

test("analyzeSamples ignores symbol-only text such as a blinking dot or a prompt sign", () => {
  const report = analyzeSamples({
    frame: [1080, 1920],
    step: 0.1,
    elements: [
      { id: "#dot", text: "●", readable: [true, false, true], fontPx: [32] },
      { id: "#prompt", text: "$", readable: [true], fontPx: [20] },
      { id: "#ratio", text: "9:16 · 1080P", readable: Array(12).fill(true), fontPx: [32] },
    ],
  });
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.elements.map((e) => e.id), ["#ratio"]);
  assert.equal(report.elements[0].words, 2, "the middle dot is not a word");
});

test('data-read-exempt="time" skips only the reading-time rule; size is still checked', () => {
  const report = analyzeSamples({
    frame: [1080, 1920],
    step: 0.1,
    elements: [
      { id: "#word", text: "something", exempt: "time", readable: [true, true, false], fontPx: [60] },
      { id: "#tinyword", text: "it.", exempt: "time", readable: [true], fontPx: [20] },
    ],
  });
  assert.deepEqual(report.errors.map((e) => [e.code, e.id]), [["text-too-small", "#tinyword"]]);
  assert.equal(report.checked, 2);
});

test("longestRun measures the longest continuous readable stretch", () => {
  const step = 0.1;
  assert.equal(longestRun([false, true, true, true, false, true], step).toFixed(1), "0.3");
  assert.equal(longestRun([false, false], step), 0);
});

test("analyzeSamples flags short reads and small type, and honours read-exempt", () => {
  const report = analyzeSamples(
    {
      frame: [1080, 1920],
      step: 0.1,
      elements: [
        { id: "#hook", text: "let's shipreel", readable: Array(20).fill(true), fontPx: [120] },
        { id: "#flash", text: "this sentence flashes by far too fast", readable: [...Array(10).fill(false), true, true, true, true], fontPx: [60] },
        { id: "#tiny", text: "tiny footnote", readable: Array(20).fill(true), fontPx: [18] },
        { id: "#body", text: "four words of body", readable: Array(20).fill(true), fontPx: [34] },
        { id: "#timer", text: "00:17 / 00:20", exempt: true, readable: [true, true], fontPx: [40] },
      ],
    },
  );
  assert.deepEqual(report.errors.map((e) => [e.code, e.id]), [
    ["reading-time", "#flash"],
    ["text-too-small", "#tiny"],
  ]);
  assert.deepEqual(report.warnings.map((w) => [w.code, w.id]), [["body-text-small", "#body"]]);
  assert.match(report.errors[0].message, /0\.4s.*needs 2\.1s/);
  assert.equal(report.checked, 4);
});

const chrome = findChrome();

test("auditComposition measures a real composition in Chrome", { skip: !chrome && "Chrome not found" }, async () => {
  const report = await auditComposition(fixture, { step: 0.1 });
  const ids = (list, code) => list.filter((f) => f.code === code).map((f) => f.id).sort();
  assert.deepEqual(ids(report.errors, "reading-time"), ["#flash"]);
  assert.deepEqual(ids(report.errors, "text-too-small"), ["#scaled", "#tiny"], "transform scale counts toward rendered size");
  assert.ok(!report.errors.some((e) => e.id === "#timer"), "read-exempt text is skipped");
  assert.ok(!report.errors.some((e) => e.id === "#hook"));
  const flash = report.elements.find((e) => e.id === "#flash");
  assert.ok(Math.abs(flash.longest - 0.4) < 0.11, String(flash.longest));
});
