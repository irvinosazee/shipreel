#!/usr/bin/env node
/**
 * Pull review frames from a draft render for the /brag self-review pass.
 *
 *   node <skill-root>/scripts/review_frames.mjs <draft.mp4> --out <dir> [--times 1.2,4.5,...] [--every 1] [--width 640]
 *
 * --times  the storyboard's settled moments (text fully in, not yet exiting). Preferred.
 * --every  sample evenly instead, one frame every N seconds (default 1).
 *
 * Writes <out>/frame-XX.jpg for each time (times are listed in the JSON output) and
 * <out>/sheet.jpg, a contact
 * sheet in reading order (up to four columns) the agent can view in one image. Prints JSON.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_COLUMNS = 4;

export function parseTimes({ times, every, duration }) {
  if (times) {
    const list = String(times)
      .split(",")
      .map((t) => Number(t.trim()))
      .filter((t) => Number.isFinite(t) && t >= 0 && t < duration);
    return [...new Set(list)].sort((a, b) => a - b);
  }
  const step = Number(every) > 0 ? Number(every) : 1;
  const list = [];
  for (let t = step / 2; t < duration; t += step) list.push(Number(t.toFixed(3)));
  return list;
}

export function sheetGrid(count) {
  const columns = Math.min(MAX_COLUMNS, Math.max(1, count));
  return [columns, Math.ceil(count / columns)];
}

function duration(file) {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], {
    encoding: "utf8",
  });
  return Number(out.trim());
}

function ffmpeg(args) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr.trim()}`);
}

export function reviewFrames(file, { outDir, times, every, width = 640 }) {
  mkdirSync(outDir, { recursive: true });
  // Stale frames from an earlier review would leak into the numbered sequence.
  for (const name of readdirSync(outDir)) if (/^frame-\d+\.jpg$|^sheet\.jpg$/.test(name)) rmSync(path.join(outDir, name));
  const list = parseTimes({ times, every, duration: duration(file) });
  if (list.length === 0) throw new Error("No review times fall inside the video.");

  const frames = list.map((t, i) => {
    const framePath = path.join(outDir, `frame-${String(i + 1).padStart(2, "0")}.jpg`);
    ffmpeg(["-ss", String(t), "-i", file, "-frames:v", "1", "-vf", `scale=${width}:-2`, "-q:v", "3", framePath]);
    return { time: t, path: framePath };
  });

  // tile lays the numbered frames out in reading order and pads an incomplete last row with black.
  const [columns, rows] = sheetGrid(frames.length);
  const sheet = path.join(outDir, "sheet.jpg");
  ffmpeg([
    "-framerate", "1", "-start_number", "1", "-i", path.join(outDir, "frame-%02d.jpg"),
    "-vf", `tile=${columns}x${rows}`, "-frames:v", "1", "-q:v", "3", sheet,
  ]);
  return { sheet, frames, grid: { columns, rows } };
}

function parseArgs(argv) {
  const options = {};
  let file = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") options.outDir = argv[++i];
    else if (arg === "--times") options.times = argv[++i];
    else if (arg === "--every") options.every = argv[++i];
    else if (arg === "--width") options.width = Number(argv[++i]);
    else file = arg;
  }
  return { file, options };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const { file, options } = parseArgs(process.argv.slice(2));
  if (!file || !existsSync(file) || !options.outDir) {
    console.error("Usage: review_frames.mjs <draft.mp4> --out <dir> [--times 1.2,4.5] [--every 1] [--width 640]");
    process.exitCode = 2;
  } else {
    console.log(JSON.stringify(reviewFrames(path.resolve(file), options), null, 2));
  }
}
