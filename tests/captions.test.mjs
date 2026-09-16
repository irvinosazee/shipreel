import { test } from "node:test";
import assert from "node:assert/strict";

import { formatTimestamp, groupWords, lintCues, toSrt, toVtt } from "../skills/brag/scripts/captions.mjs";

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
