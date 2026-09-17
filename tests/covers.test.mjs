import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { COVER_TARGETS, coverMode, makeCovers, gridCropRisk } from "../skills/brag/scripts/covers.mjs";

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const ff = (...args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
const size = (file) =>
  execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", file], { encoding: "utf8" })
    .trim()
    .split(",")
    .map(Number);

test("cover targets use each platform's thumbnail size", () => {
  assert.deepEqual(COVER_TARGETS.youtube.size, [1280, 720]);
  assert.deepEqual(COVER_TARGETS.og.size, [1200, 630]);
  assert.deepEqual(COVER_TARGETS["reels-grid"].size, [1080, 1350]);
});

test("coverMode scales matching shapes and blur-fills mismatched ones", () => {
  assert.equal(coverMode([1920, 1080], [1280, 720]), "scale");
  assert.equal(coverMode([1080, 1920], [1280, 720]), "blur-fill");
  assert.equal(coverMode([1080, 1920], [1080, 1350]), "center-crop");
  assert.equal(coverMode([1080, 1080], [1200, 630]), "blur-fill");
});

test("makeCovers writes every cover at its exact size", { skip: !hasFfmpeg && "ffmpeg not installed" }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "brag-covers-"));
  try {
    const poster = path.join(dir, "brag.jpg");
    ff("-f", "lavfi", "-i", "color=0xe0380f:size=1080x1920", "-vf", "drawbox=x=140:y=800:w=800:h=300:color=black:t=fill", "-frames:v", "1", poster);
    const results = makeCovers(poster, { outDir: path.join(dir, "covers") });
    assert.deepEqual(results.map((r) => r.id).sort(), ["og", "reels-grid", "youtube"]);
    for (const result of results) {
      assert.ok(existsSync(result.path), result.path);
      assert.deepEqual(size(result.path), COVER_TARGETS[result.id].size, result.id);
    }
    assert.equal(results.find((r) => r.id === "youtube").mode, "blur-fill");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("gridCropRisk flags detail in the rows the Reels grid crops away", { skip: !hasFfmpeg && "ffmpeg not installed" }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "brag-grid-"));
  try {
    const centered = path.join(dir, "centered.png");
    ff("-f", "lavfi", "-i", "color=white:size=1080x1920", "-vf", "drawbox=x=140:y=800:w=800:h=300:color=black:t=8", "-frames:v", "1", centered);
    const topText = path.join(dir, "top.png");
    ff("-f", "lavfi", "-i", "color=white:size=1080x1920", "-vf", "drawbox=x=140:y=60:w=800:h=160:color=black:t=8", "-frames:v", "1", topText);

    assert.equal(gridCropRisk(centered).risky, false);
    const risk = gridCropRisk(topText);
    assert.equal(risk.risky, true);
    assert.ok(risk.top > risk.bottom);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
