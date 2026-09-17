import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parsePsnr } from "../skills/brag/scripts/verify_render.mjs";
import {
  loadScenes,
  planCutdown,
  planStories,
  settledTime,
  stillTime,
  renderSegments,
  makeCarousel,
  buildPdf,
} from "../skills/brag/scripts/cuts.mjs";

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

// The hero remake's storyboard.
const scenes = [
  { name: "Hook", start: 0, end: 3.553, role: "hook", settled: 1.6 },
  { name: "Reveal", start: 3.553, end: 7.11, role: "reveal", settled: 6.6 },
  { name: "Install", start: 7.11, end: 11.471, role: "highlight", settled: 10.9 },
  { name: "Claim", start: 11.471, end: 14.733, role: "highlight", settled: 13.6 },
  { name: "Render", start: 14.733, end: 18.553, role: "highlight", settled: 17.8 },
  { name: "Punchline", start: 18.553, end: 22.5, role: "payoff", settled: 21.5 },
];
const total = (segments) => segments.reduce((sum, s) => sum + (s.end - s.start), 0);

test("loadScenes validates order, gaps, and roles", () => {
  assert.deepEqual(loadScenes(scenes), scenes);
  assert.throws(() => loadScenes([{ ...scenes[0], end: 4 }, scenes[1]]), /overlap/);
  assert.throws(() => loadScenes([{ ...scenes[0], role: "intro" }]), /role "intro"/);
  assert.throws(() => loadScenes([]), /at least one scene/);
});

test("settledTime prefers the storyboard's settled moment and falls back near the scene end", () => {
  assert.equal(settledTime(scenes[1]), 6.6);
  assert.equal(settledTime({ start: 2, end: 6 }), 5.6);
});

test("stillTime prefers the complete frame, then the settled moment", () => {
  assert.equal(stillTime({ start: 0, end: 3.5, settled: 1.6, still: 3.2 }), 3.2);
  assert.equal(stillTime(scenes[1]), 6.6);
});

test("planCutdown for 15s keeps hook and payoff and fills with whole middle scenes", () => {
  const segments = planCutdown(scenes, 15);
  assert.equal(segments[0].name, "Hook");
  assert.equal(segments.at(-1).name, "Punchline");
  assert.ok(total(segments) <= 15.5, String(total(segments)));
  assert.ok(total(segments) >= 12, String(total(segments)));
  for (const s of segments) assert.equal(s.end - s.start, scenes.find((x) => x.name === s.name).end - s.start, `${s.name} is whole`);
  for (let i = 1; i < segments.length; i += 1) assert.ok(segments[i].start >= segments[i - 1].end, "story order kept");
});

test("planCutdown for a 6s bumper trims the hook's tail and the payoff's head", () => {
  const segments = planCutdown(scenes, 6);
  assert.deepEqual(segments.map((s) => s.name), ["Hook", "Punchline"]);
  assert.ok(Math.abs(total(segments) - 6) < 0.01, String(total(segments)));
  assert.equal(segments[0].start, 0, "the hook keeps its opening");
  assert.equal(segments[1].end, 22.5, "the payoff keeps its landing");
  assert.ok(segments[1].start <= 21.5, "the payoff still includes its settled moment");
});

test("planStories packs whole scenes into segments of at most 15 seconds", () => {
  const stories = planStories(scenes, 15);
  assert.equal(stories.length, 2);
  assert.deepEqual(stories.map((s) => [s.start, s.end]), [[0, 14.733], [14.733, 22.5]]);
  for (const story of stories) assert.ok(story.end - story.start <= 15);
});

test("planStories splits a single scene longer than the limit", () => {
  const stories = planStories([{ name: "Long", start: 0, end: 32, role: "highlight" }], 15);
  assert.deepEqual(stories.map((s) => [s.start, s.end]), [[0, 15], [15, 30], [30, 32]]);
});

test("buildPdf writes one page per JPEG with a correct xref table", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const pdf = buildPdf([{ data: jpeg, width: 1080, height: 1350 }, { data: jpeg, width: 1080, height: 1350 }]);
  const text = pdf.toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4"));
  assert.equal((text.match(/\/Type \/Page\b/g) ?? []).length, 2);
  assert.match(text, /\/Count 2/);
  assert.match(text, /\/MediaBox \[0 0 1080 1350\]/);
  const xrefStart = Number(text.match(/startxref\n(\d+)/)[1]);
  assert.ok(text.slice(xrefStart).startsWith("xref"));
  const offsets = [...text.slice(xrefStart).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  offsets.forEach((offset, i) => assert.ok(text.slice(offset).startsWith(`${i + 1} 0 obj`), `object ${i + 1} offset`));
});

test("renderSegments and makeCarousel work on a real clip", { skip: !hasFfmpeg && "ffmpeg not installed" }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "brag-cuts-"));
  const ff = (...args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
  const duration = (file) =>
    Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }));
  try {
    const clip = path.join(dir, "brag.mp4");
    ff(
      "-f", "lavfi", "-i", "testsrc2=size=540x960:rate=30:duration=22.5",
      "-f", "lavfi", "-i", "sine=frequency=330:duration=22.5",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", clip,
    );

    const cut = path.join(dir, "nested", "missing", "brag-cut6.mp4");
    renderSegments(clip, planCutdown(scenes, 6), cut);
    assert.ok(Math.abs(duration(cut) - 6) < 0.2, String(duration(cut)));

    // A segment cut from the middle gets the chosen frame baked into frame 0 instead of an entrance frame.
    const story = path.join(dir, "story.mp4");
    renderSegments(clip, [{ name: "Render", start: 14.733, end: 18.553 }], story, { posterAt: 17.8 });
    const frame0 = path.join(dir, "story-f0.png");
    const source = path.join(dir, "source-17.8.png");
    ff("-i", story, "-frames:v", "1", frame0);
    ff("-ss", "17.8", "-i", clip, "-frames:v", "1", source);
    const psnr = parsePsnr(spawnSync("ffmpeg", ["-hide_banner", "-i", frame0, "-i", source, "-filter_complex", "psnr", "-f", "null", "-"], { encoding: "utf8" }).stderr);
    assert.ok(psnr > 35, `story frame 0 should be the 17.8s frame, PSNR ${psnr}`);

    const carousel = makeCarousel(clip, scenes, { outDir: path.join(dir, "carousel") });
    assert.equal(carousel.slides.length, scenes.length);
    for (const slide of carousel.slides) assert.ok(existsSync(slide));
    const [w, h] = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", carousel.slides[0]], { encoding: "utf8" })
      .trim()
      .split(",")
      .map(Number);
    assert.deepEqual([w, h], [1080, 1350]);
    const pdf = readFileSync(carousel.pdf, "latin1");
    assert.equal((pdf.match(/\/Type \/Page\b/g) ?? []).length, scenes.length);
    writeFileSync(path.join(dir, "ok"), "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
