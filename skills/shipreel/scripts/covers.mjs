#!/usr/bin/env node
/**
 * Platform cover images from the shipreel poster.
 *
 *   node <skill-root>/scripts/covers.mjs <shipreel.jpg> --out <dir>
 *
 * Writes youtube.jpg (1280x720 thumbnail), og.jpg (1200x630 link preview), and
 * reels-grid.jpg (the 1080x1350 center that Instagram's profile grid shows), and
 * reports whether a vertical poster has detail in the rows the grid crops away.
 * Mismatched shapes are never stretched: they are fitted over a blurred fill of
 * the same image.
 */

import { mkdirSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const COVER_TARGETS = {
  youtube: { size: [1280, 720], label: "YouTube thumbnail" },
  og: { size: [1200, 630], label: "Open Graph link preview" },
  "reels-grid": { size: [1080, 1350], label: "Instagram profile grid (center of a 9:16 Reel)" },
};

// Mean of the 1px edge map (0-255) above which a cropped band holds content. Edges are thin, so the
// mean is small: a flat real poster band measures 0, one outlined box in the band measures ~0.03.
const BAND_EDGE_THRESHOLD = 0.01;

function run(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${cmd} failed: ${(result.stderr || "").trim().split("\n").slice(-2).join(" ")}`);
  return result;
}

function imageSize(file) {
  const out = run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file]);
  return out.stdout.trim().split(",").map(Number);
}

export function coverMode([sw, sh], [tw, th]) {
  const source = sw / sh;
  const target = tw / th;
  if (Math.abs(source - target) < 0.02) return "scale";
  // A 9:16 poster keeps its center when the target is only somewhat less tall (4:5 grid tile).
  if (source < 1 && target < 1 && target / source < 1.5) return "center-crop";
  return "blur-fill";
}

function coverFilter(mode, [tw, th]) {
  if (mode === "scale") return `scale=${tw}:${th}:flags=lanczos,setsar=1`;
  if (mode === "center-crop") return `scale=${tw}:-2:flags=lanczos,crop=${tw}:${th},setsar=1`;
  return [
    `split[bg][fg]`,
    `[bg]scale=${tw}:${th}:force_original_aspect_ratio=increase,crop=${tw}:${th},boxblur=40:2,eq=brightness=-0.12[blur]`,
    `[fg]scale=${tw}:${th}:force_original_aspect_ratio=decrease:flags=lanczos[fit]`,
    `[blur][fit]overlay=(W-w)/2:(H-h)/2,setsar=1`,
  ].join(";");
}

/** Fit one still image to an exact size without stretching; returns the mode used. */
export function fitImage(input, output, size) {
  const mode = coverMode(imageSize(input), size);
  run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-filter_complex", coverFilter(mode, size), "-frames:v", "1", "-q:v", "2", output]);
  return mode;
}

export function makeCovers(poster, { outDir }) {
  mkdirSync(outDir, { recursive: true });
  return Object.entries(COVER_TARGETS).map(([id, target]) => {
    const out = path.join(outDir, `${id}.jpg`);
    return { id, label: target.label, mode: fitImage(poster, out, target.size), path: out };
  });
}

function bandEdgeMean(image, [width, height], y, bandHeight) {
  const result = run("ffmpeg", [
    "-hide_banner", "-i", image,
    "-vf", `format=gray,edgedetect=low=0.1:high=0.3,crop=${width}:${bandHeight}:0:${y},signalstats,metadata=print`,
    "-frames:v", "1", "-f", "null", "-",
  ]);
  const match = result.stderr.match(/lavfi\.signalstats\.YAVG=([\d.]+)/);
  return match ? Number(match[1]) : 0;
}

/** For a 9:16 poster, measure detail in the top and bottom rows a 4:5 grid tile crops off. */
export function gridCropRisk(image) {
  const [width, height] = imageSize(image);
  const keptHeight = Math.round((width * 1350) / 1080);
  const band = Math.floor((height - keptHeight) / 2);
  if (band <= 0) return { risky: false, top: 0, bottom: 0, band: 0 };
  const top = bandEdgeMean(image, [width, height], 0, band);
  const bottom = bandEdgeMean(image, [width, height], height - band, band);
  return { risky: Math.max(top, bottom) > BAND_EDGE_THRESHOLD, top, bottom, band };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf("--out");
  const poster = args.find((a, i) => !a.startsWith("--") && i !== outIndex + 1);
  if (!poster || outIndex === -1) {
    console.error("Usage: covers.mjs <shipreel.jpg> --out <dir>");
    process.exitCode = 2;
  } else {
    const covers = makeCovers(poster, { outDir: args[outIndex + 1] });
    const [width, height] = imageSize(poster);
    const grid = height > width ? gridCropRisk(poster) : null;
    console.log(JSON.stringify({ covers, gridCrop: grid }, null, 2));
    if (grid?.risky) console.error("! The poster has detail in the rows Instagram's grid crops; keep the hook inside the center 1080x1350.");
  }
}
