import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { goldenTimes, captureGolden, compareGolden } from "../skills/shipreel/scripts/golden.mjs";

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

test("goldenTimes samples the middle of evenly split spans, avoiding the baked poster frame", () => {
  assert.deepEqual(goldenTimes(20, 4), [2.5, 7.5, 12.5, 17.5]);
  assert.deepEqual(goldenTimes(3, 1), [1.5]);
});

test("compareGolden passes an identical render and flags a visual change with a diff image", { skip: !hasFfmpeg && "ffmpeg not installed" }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "shipreel-golden-"));
  const ff = (...args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
  try {
    const original = path.join(dir, "shipreel.mp4");
    ff("-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", original);
    const golden = path.join(dir, "golden");
    const manifest = captureGolden(original, { outDir: golden, frames: 4 });
    assert.equal(manifest.frames.length, 4);
    for (const frame of manifest.frames) assert.ok(existsSync(path.join(golden, frame.file)));
    assert.deepEqual(JSON.parse(readFileSync(path.join(golden, "golden.json"), "utf8")).frames.map((f) => f.time), [0.5, 1.5, 2.5, 3.5]);

    const same = compareGolden(original, { goldenDir: golden });
    assert.equal(same.ok, true, JSON.stringify(same));

    const changed = path.join(dir, "changed.mp4");
    ff("-i", original, "-vf", "drawbox=x=100:y=60:w=440:h=240:color=black:t=fill:enable='gte(t,2)'", "-c:v", "libx264", "-pix_fmt", "yuv420p", changed);
    const result = compareGolden(changed, { goldenDir: golden, diffDir: path.join(dir, "diffs") });
    assert.equal(result.ok, false);
    assert.deepEqual(result.failures.map((f) => f.time), [2.5, 3.5], "only frames after the change fail");
    for (const failure of result.failures) assert.ok(existsSync(failure.diff), failure.diff);
    assert.ok(result.frames.find((f) => f.time === 0.5).ssim > 0.97);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("compareGolden explains a missing golden set and a different duration", { skip: !hasFfmpeg && "ffmpeg not installed" }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "shipreel-golden-dur-"));
  const ff = (...args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
  try {
    const a = path.join(dir, "a.mp4");
    const b = path.join(dir, "b.mp4");
    ff("-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", a);
    ff("-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", b);
    assert.throws(() => compareGolden(a, { goldenDir: path.join(dir, "none") }), /No golden\.json/);
    captureGolden(a, { outDir: path.join(dir, "g"), frames: 2 });
    const result = compareGolden(b, { goldenDir: path.join(dir, "g") });
    assert.equal(result.ok, false);
    assert.match(result.failures[0].reason, /duration 3\.0s, golden 4\.0s/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
