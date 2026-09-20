import { test } from "node:test";
import assert from "node:assert/strict";

import { formatTimestamp, groupWords, lintCues, toSrt, toVtt } from "../skills/shipreel/scripts/captions.mjs";

test("formatTimestamp renders SRT and VTT clocks", () => {
  assert.equal(formatTimestamp(0, "srt"), "00:00:00,000");
  assert.equal(formatTimestamp(83.4567, "srt"), "00:01:23,457");
  assert.equal(formatTimestamp(3723.5, "vtt"), "01:02:03.500");
});

const cues = [
  { start: 0.4, end: 2.2, text: "Dating apps were built for humans." },
  { start: 2.4, end: 3.6, text: "Obvious mistake." },
];

test("toSrt numbers cues and uses comma milliseconds", () => {
  assert.equal(
    toSrt(cues),
    "1\n00:00:00,400 --> 00:00:02,200\nDating apps were built for humans.\n\n2\n00:00:02,400 --> 00:00:03,600\nObvious mistake.\n",
  );
});

test("toVtt adds the header and dot milliseconds", () => {
  assert.ok(toVtt(cues).startsWith("WEBVTT\n\n00:00:00.400 --> 00:00:02.200\nDating apps were built for humans.\n"));
});

test("groupWords builds short caption lines from word timings", () => {
  const words = "Every day taxis carry us but who carries the taxis".split(" ").map((text, i) => ({
    text,
    start: i * 0.35,
    end: i * 0.35 + 0.3,
  }));
  const lines = groupWords(words, { maxChars: 20 });
  assert.deepEqual(
    lines.map((l) => l.text),
    ["Every day taxis", "carry us but who", "carries the taxis"],
  );
  assert.equal(lines[0].start, 0);
  assert.equal(lines[2].end, 9 * 0.35 + 0.3);
  for (const line of lines) assert.ok(line.text.length <= 20);
});

test("groupWords breaks on pauses and sentence ends", () => {
  const words = [
    { text: "Meet", start: 0, end: 0.3 },
    { text: "Thunder.", start: 0.35, end: 0.8 },
    { text: "He", start: 0.85, end: 1.0 },
    { text: "swipes", start: 1.05, end: 1.4 },
    { text: "right.", start: 2.6, end: 3.0 },
  ];
  assert.deepEqual(groupWords(words, { maxChars: 40 }).map((l) => l.text), ["Meet Thunder.", "He swipes", "right."]);
});

test("lintCues flags overlaps, empty text, and cues too short to read", () => {
  const problems = lintCues([
    { start: 0, end: 0.5, text: "One two three four five six" },
    { start: 0.4, end: 2, text: "Overlaps the first" },
    { start: 2, end: 3, text: "  " },
  ]);
  assert.equal(problems.length, 3);
  assert.match(problems[0], /cue 1.*0\.5s.*needs about 1\.8s/);
  assert.match(problems[1], /cue 2 starts before cue 1 ends/);
  assert.match(problems[2], /cue 3 is empty/);
  assert.deepEqual(lintCues(cues), []);
});

import { CAPTION_STYLES, cueWords, buildCaptionBlock, injectCaptions, contrastRatio } from "../skills/shipreel/scripts/captions.mjs";

const theme = {
  font: "Geist",
  fg: "#fff4ec",
  bg: "#1a0f0b",
  accent: "#ff5a2a",
  band: { x: 96, y: 1180, width: 816, height: 220 },
};

test("contrastRatio follows WCAG relative luminance", () => {
  assert.equal(contrastRatio("#000000", "#ffffff").toFixed(1), "21.0");
  assert.equal(contrastRatio("#777777", "#777777").toFixed(1), "1.0");
});

test("every caption style sits on a solid plate, so it reads over any scene background", () => {
  for (const style of Object.keys(CAPTION_STYLES)) {
    const html = buildCaptionBlock([{ start: 0, end: 2, text: "hello there" }], { style, theme });
    assert.match(html, /\.shipreel-line \{[^}]*background: #1a0f0b;/, style);
    assert.doesNotMatch(html, /text-stroke/, `${style} has no outline that could fill word gaps`);
  }
});

test("buildCaptionBlock rejects text or accent colors that do not contrast with the plate", () => {
  assert.throws(
    () => buildCaptionBlock([{ start: 0, end: 1, text: "hi" }], { style: "karaoke", theme: { ...theme, accent: "#2a1a14" } }),
    /accent #2a1a14 on plate #1a0f0b has contrast 1\.\d:1; captions need at least 3:1/,
  );
  assert.throws(
    () => buildCaptionBlock([{ start: 0, end: 1, text: "hi" }], { style: "lower-third", theme: { ...theme, fg: "#333333" } }),
    /fg #333333/,
  );
});

test("caption styles are named and documented", () => {
  assert.deepEqual(Object.keys(CAPTION_STYLES), ["lower-third", "word-pop", "karaoke"]);
  for (const style of Object.values(CAPTION_STYLES)) assert.ok(style.description.length > 10);
});

test("cueWords spreads a cue's words evenly when no word timings exist", () => {
  const words = cueWords({ start: 1, end: 3, text: "one two three four" });
  assert.deepEqual(words.map((w) => [w.text, w.start]), [["one", 1], ["two", 1.5], ["three", 2], ["four", 2.5]]);
  const timed = cueWords({ start: 0, end: 2, text: "a b", words: [{ text: "a", start: 0.1, end: 0.4 }, { text: "b", start: 1.2, end: 1.5 }] });
  assert.deepEqual(timed.map((w) => w.start), [0.1, 1.2]);
});

test("lower-third renders one timed clip per cue inside the band", () => {
  const html = buildCaptionBlock([{ start: 0.4, end: 2.2, text: "Dating apps & <humans>" }], { style: "lower-third", theme });
  assert.match(html, /<!-- shipreel:captions:start style=lower-third -->/);
  assert.match(html, /<div id="cap-0" class="clip shipreel-cap" data-start="0.4" data-duration="1.8" data-track-index="90">/);
  assert.match(html, /<span class="shipreel-line">Dating apps &amp; &lt;humans&gt;<\/span>/, "a lower-third line is measured like any text");
  assert.match(html, /left: 96px; top: 1180px; width: 816px; height: 220px/);
  assert.doesNotMatch(html, /<script/, "caption styles are pure timed markup, no timeline code");
  assert.doesNotMatch(html, /<br/);
  // Timed captions carry class="clip" for Hyperframes, so they must undo a composition's `.clip { position: absolute; inset: 0 }`.
  assert.match(html, /\.shipreel-captions \.clip\.shipreel-cap \{[^}]*right: auto; bottom: auto;/);
});

test("word-pop shows each word from its start until the cue ends", () => {
  const html = buildCaptionBlock([{ start: 1, end: 3, text: "twenty seconds" }], { style: "word-pop", theme });
  assert.match(html, /<span id="cap-0-w0" class="clip shipreel-word" data-start="1" data-duration="2" data-track-index="91">twenty<\/span>/);
  assert.match(html, /<span id="cap-0-w1" class="clip shipreel-word" data-start="2" data-duration="1" data-track-index="92">seconds<\/span>/);
  assert.match(html, /\.shipreel-captions \.clip\.shipreel-word \{ position: static; inset: auto; display: inline; \}/);
  assert.match(html, /<span class="shipreel-line" data-read-exempt="time">/);
});

test("karaoke swaps each word from base to lit in one grid cell, never showing both", () => {
  const html = buildCaptionBlock([{ start: 1, end: 3, text: "now go" }], { style: "karaoke", theme });
  // The first word lights up at the cue start, so it has no base phase; its base stays as an invisible width holder.
  assert.match(html, /<span class="shipreel-kw"><span class="shipreel-base shipreel-hold">now<\/span><span id="cap-0-w0" class="clip shipreel-lit" data-start="1" data-duration="2" data-track-index="91">now<\/span><\/span>/);
  assert.match(html, /<span class="shipreel-kw"><span id="cap-0-w1-base" class="clip shipreel-base" data-start="1" data-duration="1" data-track-index="92">go<\/span><span id="cap-0-w1" class="clip shipreel-lit" data-start="2" data-duration="1" data-track-index="93">go<\/span><\/span>/);
  assert.match(html, /\.shipreel-lit \{[^}]*color: #ff5a2a/);
  assert.match(html, /\.shipreel-kw \{ display: inline-grid; \}/);
  assert.match(html, /<span class="shipreel-line" data-read-exempt="time">/, "per-word states are exempt from reading time; the cue is linted as a line");
  assert.match(html, /\.shipreel-captions \.clip\.shipreel-base, \.shipreel-captions \.clip\.shipreel-lit \{ position: static; inset: auto; grid-area: 1 \/ 1; \}/);
});

test("injectCaptions inserts after the composition root and replaces an earlier block", () => {
  const composition = `<html><body><div id="root" data-composition-id="main" data-width="1080" data-height="1920">\n<section class="clip"></section>\n</div></body></html>`;
  const once = injectCaptions(composition, buildCaptionBlock([{ start: 0, end: 1, text: "hi" }], { style: "lower-third", theme }));
  assert.match(once, /data-height="1920">\n<!-- shipreel:captions:start style=lower-third -->/);
  const twice = injectCaptions(once, buildCaptionBlock([{ start: 0, end: 1, text: "bye" }], { style: "karaoke", theme }));
  assert.equal((twice.match(/shipreel:captions:start/g) ?? []).length, 1);
  assert.match(twice, /style=karaoke/);
  assert.doesNotMatch(twice, />hi</);
});
