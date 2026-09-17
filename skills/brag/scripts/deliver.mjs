#!/usr/bin/env node
/**
 * Scripted delivery: render a composition and finish the file the way step 4 describes.
 *
 *   node <skill-root>/scripts/deliver.mjs render <composition-dir> --out brag.mp4 [--quality draft|looks|delivery]
 *   node <skill-root>/scripts/deliver.mjs finish <video.mp4> --poster-at 1.4 [--poster brag.jpg] [--format vertical] [--min 5 --max 25]
 *
 * `render` runs `hyperframes render` and fails loudly with the tail of its log. `finish` masters
 * loudness to -14 LUFS at 48 kHz (skipped without audio), pulls the poster frame at --poster-at,
 * bakes it into frame 0, and runs verify_render on the result. The skill's agent path can still
 * do these by hand; release videos, PR previews, and `brag-video make` use this.
 */

import { existsSync, realpathSync, renameSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { probeVideo, verifyRender } from "./verify_render.mjs";

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
  return { ok: result.status === 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}`, error: result.error };
}

function ffmpeg(args) {
  const result = run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
  if (!result.ok) throw new Error(`ffmpeg failed: ${result.output.trim().split("\n").slice(-3).join(" ")}`);
}

export function renderComposition(compositionDir, { output, quality = "looks", timeoutMs = 20 * 60 * 1000 } = {}) {
  const out = path.resolve(output);
  const result = run("npx", ["-y", "hyperframes", "render", "--quality", quality, "--output", out], { cwd: compositionDir, timeout: timeoutMs });
  if (!result.ok || !existsSync(out)) {
    throw new Error(`hyperframes render failed in ${compositionDir}:\n${result.output.trim().split("\n").slice(-15).join("\n")}`);
  }
  return out;
}

export function lintComposition(compositionDir) {
  const result = run("npx", ["-y", "hyperframes", "lint"], { cwd: compositionDir, timeout: 5 * 60 * 1000 });
  return { ok: result.ok, output: result.output.trim() };
}

/** Replace `video` in place with the output of an ffmpeg pass that writes to `tmp`. */
function inPlace(video, suffix, args) {
  const tmp = video.replace(/\.mp4$/i, `.${suffix}.mp4`);
  try {
    ffmpeg([...args(tmp)]);
    renameSync(tmp, video);
  } finally {
    rmSync(tmp, { force: true });
  }
}

export function masterLoudness(video) {
  inPlace(video, "mastered", (tmp) => ["-i", video, "-c:v", "copy", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-ar", "48000", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", tmp]);
}

export function extractPoster(video, at, poster) {
  ffmpeg(["-ss", String(at), "-i", video, "-frames:v", "1", "-q:v", "2", poster]);
  return poster;
}

export function bakePoster(video, poster) {
  inPlace(video, "poster", (tmp) => [
    "-i", video, "-i", poster, "-filter_complex", "[0:v][1:v]overlay=0:0:enable='eq(n,0)'[v]",
    "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-crf", "18", "-preset", "slow", "-pix_fmt", "yuv420p",
    "-c:a", "copy", "-movflags", "+faststart", tmp,
  ]);
}

export function finishVideo(video, { posterAt, poster = video.replace(/\.mp4$/i, ".jpg"), expect = {} }) {
  const file = path.resolve(video);
  const hasAudio = probeVideo(file).hasAudio;
  if (hasAudio) masterLoudness(file);
  extractPoster(file, posterAt, poster);
  bakePoster(file, poster);
  return verifyRender(file, { audio: hasAudio, ...expect, posterPath: poster });
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const [command, target, ...rest] = process.argv.slice(2);
  const flag = (name, fallback) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : fallback);
  try {
    if (command === "render" && target && flag("--out")) {
      console.log(renderComposition(target, { output: flag("--out"), quality: flag("--quality", "looks") }));
    } else if (command === "finish" && target && flag("--poster-at")) {
      const expect = {};
      if (flag("--format")) expect.format = flag("--format");
      if (flag("--min")) expect.minDuration = Number(flag("--min"));
      if (flag("--max")) expect.maxDuration = Number(flag("--max"));
      const report = finishVideo(target, { posterAt: Number(flag("--poster-at")), poster: flag("--poster"), expect });
      console.log(JSON.stringify({ ok: report.ok, errors: report.errors, warnings: report.warnings }, null, 2));
      process.exitCode = report.ok ? 0 : 1;
    } else {
      console.error("Usage: deliver.mjs render <composition-dir> --out <video.mp4> [--quality looks] | finish <video.mp4> --poster-at <seconds> [--poster <jpg>] [--format f] [--min s --max s]");
      process.exitCode = 2;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
