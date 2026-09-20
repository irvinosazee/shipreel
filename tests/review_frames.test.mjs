import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseTimes, sheetGrid, reviewFrames } from "../skills/shipreel/scripts/review_frames.mjs";

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

test("parseTimes accepts explicit settled times, sorted and deduped", () => {
  assert.deepEqual(parseTimes({ times: "4.5, 1.2,1.2,9" , duration: 8 }), [1.2, 4.5]);
});

test("parseTimes samples evenly with --every, starting mid-interval", () => {
  assert.deepEqual(parseTimes({ every: 2, duration: 7 }), [1, 3, 5]);
});

test("parseTimes defaults to one frame per second", () => {
  assert.equal(parseTimes({ duration: 20 }).length, 20);
});

test("sheetGrid keeps sheets at most four columns wide", () => {
  assert.deepEqual(sheetGrid(3), [3, 1]);
  assert.deepEqual(sheetGrid(4), [4, 1]);
  assert.deepEqual(sheetGrid(9), [4, 3]);
});

test("reviewFrames writes frames and a contact sheet", { skip: !hasFfmpeg && "ffmpeg not installed" }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "shipreel-review-"));
  try {
    const clip = path.join(dir, "clip.mp4");
    execFileSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=3",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", clip,
    ]);
    const out = path.join(dir, "review");
    const result = reviewFrames(clip, { outDir: out, times: "0.5,1.5,2.5", width: 320 });

    assert.equal(result.frames.length, 3);
    for (const frame of result.frames) assert.ok(existsSync(frame.path), frame.path);
    assert.ok(existsSync(result.sheet));

    const [w, h] = execFileSync("ffprobe", [
      "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", result.sheet,
    ], { encoding: "utf8" }).trim().split(",").map(Number);
    assert.equal(w, 960);
    assert.equal(h, 180);

    const padded = reviewFrames(clip, { outDir: out, times: "0.2,0.8,1.4,2.0,2.6", width: 160 });
    assert.equal(padded.frames.length, 5);
    assert.deepEqual(padded.grid, { columns: 4, rows: 2 });
    const [pw, ph] = execFileSync("ffprobe", [
      "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", padded.sheet,
    ], { encoding: "utf8" }).trim().split(",").map(Number);
    assert.equal(pw, 640);
    assert.equal(ph, 180);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
