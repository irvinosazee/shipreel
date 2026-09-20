#!/usr/bin/env node
/**
 * Golden-frame regression: catch unintended visual changes to a render.
 *
 *   node <skill-root>/scripts/golden.mjs capture <video.mp4> --out <golden-dir> [--frames 8]
 *   node <skill-root>/scripts/golden.mjs compare <video.mp4> --golden <golden-dir> [--diffs <dir>]
 *
 * `capture` stores small reference frames from the middle of evenly split spans (never frame 0,
 * which holds the baked poster) plus golden.json. `compare` extracts the same frames from a new
 * render and fails any frame whose SSIM against its golden drops below 0.95, writing a
 * golden | current | difference image for each failure. A different duration fails outright.
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WIDTH = 270;
const MIN_SSIM = 0.95;
const DURATION_TOLERANCE = 0.25;

function run(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${cmd} failed: ${(result.stderr || "").trim().split("\n").slice(-2).join(" ")}`);
  return result;
}

const duration = (video) => Number(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video]).stdout.trim());

export function goldenTimes(total, frames) {
  const span = total / frames;
  return Array.from({ length: frames }, (_, i) => Math.round((span * i + span / 2) * 1000) / 1000);
}

function extractFrame(video, time, output) {
  run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(time), "-i", video, "-frames:v", "1", "-vf", `scale=${WIDTH}:-2`, "-q:v", "3", output]);
  return output;
}

export function captureGolden(video, { outDir, frames = 8 }) {
  mkdirSync(outDir, { recursive: true });
  const total = duration(video);
  const manifest = {
    duration: Math.round(total * 1000) / 1000,
    width: WIDTH,
    minSsim: MIN_SSIM,
    frames: goldenTimes(total, frames).map((time, i) => {
      const file = `frame-${String(i + 1).padStart(2, "0")}.jpg`;
      extractFrame(video, time, path.join(outDir, file));
      return { time, file };
    }),
  };
  writeFileSync(path.join(outDir, "golden.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function ssim(a, b) {
  const stderr = spawnSync("ffmpeg", ["-hide_banner", "-i", a, "-i", b, "-filter_complex", "[0:v]setsar=1[x];[1:v]setsar=1[y];[x][y]ssim", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const match = stderr.match(/All:([\d.]+)/);
  return match ? Number(match[1]) : 0;
}

export function compareGolden(video, { goldenDir, diffDir }) {
  const manifestPath = path.join(goldenDir, "golden.json");
  if (!existsSync(manifestPath)) throw new Error(`No golden.json in ${goldenDir}; run "golden.mjs capture" first.`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const total = duration(video);
  if (Math.abs(total - manifest.duration) > DURATION_TOLERANCE) {
    return { ok: false, frames: [], failures: [{ time: null, reason: `duration ${total.toFixed(1)}s, golden ${manifest.duration.toFixed(1)}s` }] };
  }

  const work = path.join(tmpdir(), `shipreel-golden-${process.pid}-${Date.now()}`);
  mkdirSync(work, { recursive: true });
  try {
    const frames = manifest.frames.map((frame) => {
      const current = extractFrame(video, frame.time, path.join(work, frame.file));
      const golden = path.join(goldenDir, frame.file);
      const score = ssim(current, golden);
      const result = { time: frame.time, file: frame.file, ssim: Math.round(score * 10000) / 10000 };
      if (score < (manifest.minSsim ?? MIN_SSIM) && diffDir) {
        mkdirSync(diffDir, { recursive: true });
        result.diff = path.join(diffDir, `diff-${frame.file}`);
        run("ffmpeg", [
          "-hide_banner", "-loglevel", "error", "-y", "-i", golden, "-i", current,
          "-filter_complex", "[0:v]setsar=1,format=rgb24[g];[1:v]setsar=1,format=rgb24[c];[g][c]blend=all_mode=difference[d];[0:v]setsar=1,format=rgb24[g2];[1:v]setsar=1,format=rgb24[c2];[g2][c2][d]hstack=inputs=3",
          "-frames:v", "1", "-q:v", "3", result.diff,
        ]);
      }
      return result;
    });
    const failures = frames.filter((f) => f.ssim < (manifest.minSsim ?? MIN_SSIM)).map((f) => ({ ...f, reason: `SSIM ${f.ssim} below ${manifest.minSsim ?? MIN_SSIM}` }));
    return { ok: failures.length === 0, frames, failures };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const [command, video, ...rest] = process.argv.slice(2);
  const flag = (name, fallback) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : fallback);
  try {
    if (command === "capture" && video && flag("--out")) {
      console.log(JSON.stringify(captureGolden(video, { outDir: flag("--out"), frames: Number(flag("--frames", 8)) }), null, 2));
    } else if (command === "compare" && video && flag("--golden")) {
      const result = compareGolden(video, { goldenDir: flag("--golden"), diffDir: flag("--diffs") });
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.ok ? 0 : 1;
    } else {
      console.error("Usage: golden.mjs capture <video> --out <dir> [--frames 8] | compare <video> --golden <dir> [--diffs <dir>]");
      process.exitCode = 2;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
