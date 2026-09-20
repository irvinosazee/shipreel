#!/usr/bin/env node
/**
 * Bring your own footage: find the best moments in a screen recording.
 *
 *   node <skill-root>/scripts/footage.mjs analyze <recording.mov> [--count 3] [--seconds 3]
 *   node <skill-root>/scripts/footage.mjs cut <recording.mov> --out <composition-dir>/assets/footage [--count 3] [--seconds 3]
 *
 * Splits the recording at hard scene cuts, slides moment-length windows through each segment
 * (never across a cut), scores every window by the fraction of pixels that change between
 * frames — so a cursor, typing, or a sliding panel counts even when most of the screen is
 * still — and picks the most active non-overlapping windows, skipping idle and blank ones, in
 * chronological order. `cut` trims them to muted H.264 clips for <video> elements (audio stays in
 * <audio> elements).
 */

import { mkdirSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCENE_THRESHOLD = 0.3;
const MIN_CUT_GAP = 0.5;
const SETTLE_AFTER_CUT = 0.15;
// Fraction of pixels that changed by more than CHANGE_LEVEL (0-255) between consecutive frames.
const MIN_ACTIVITY = 0.001;
const CHANGE_LEVEL = 12;
const WINDOW_STEP = 0.25;
const BLANK_SPREAD = 24;
const ANALYSIS_WIDTH = 320;

const round3 = (n) => Math.round(n * 1000) / 1000;

function ffmpegStderr(args) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-nostats", ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${(result.stderr || "").trim().split("\n").slice(-2).join(" ")}`);
  return result.stderr;
}

function duration(video) {
  const result = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`ffprobe could not read ${video}`);
  return Number(result.stdout.trim());
}

export function parseSceneCuts(stderr) {
  return [...String(stderr).matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1]));
}

export function segmentsFromCuts(cuts, total) {
  const kept = [];
  for (const cut of [...cuts].sort((a, b) => a - b)) {
    const previous = kept.at(-1) ?? 0;
    if (cut - previous >= MIN_CUT_GAP && total - cut >= MIN_CUT_GAP) kept.push(cut);
  }
  const bounds = [0, ...kept, total];
  return bounds.slice(0, -1).map((start, i) => ({ start: round3(start), end: round3(bounds[i + 1]) }));
}

/** Per-frame metadata from a `metadata=print` pass: [{ t, value }]. */
function frameSeries(stderr, key) {
  const series = [];
  let t = null;
  for (const line of String(stderr).split("\n")) {
    const time = line.match(/pts_time:([\d.]+)/);
    if (time) t = Number(time[1]);
    const value = line.match(new RegExp(`${key.replace(/\./g, "\\.")}=([\\d.]+)`));
    if (value && t != null) series.push({ t, value: Number(value[1]) });
  }
  return series;
}

export function pickMoments(candidates, { count = 3, seconds = 3, minActivity = MIN_ACTIVITY } = {}) {
  const chosen = [];
  const ranked = candidates.filter((c) => !c.blank && c.activity >= minActivity).sort((a, b) => b.activity - a.activity);
  for (const candidate of ranked) {
    if (chosen.length >= count) break;
    const moment = {
      start: round3(Math.max(candidate.start, candidate.peak - seconds / 2)),
      end: round3(Math.min(candidate.end, candidate.peak + seconds / 2)),
      activity: candidate.activity,
    };
    if (chosen.some((c) => moment.start < c.end && c.start < moment.end)) continue;
    chosen.push(moment);
  }
  return chosen.sort((a, b) => a.start - b.start);
}

/** Moment-length windows through one segment, each scored by the mean changed-pixel fraction of its frames. */
export function slidingWindows(segment, frames, { seconds, step = WINDOW_STEP }) {
  const length = segment.end - segment.start;
  const starts = [];
  if (length <= seconds) starts.push(segment.start);
  else for (let w = segment.start; w + seconds <= segment.end + 1e-6; w += step) starts.push(round3(w));
  return starts.map((start) => {
    const end = round3(Math.min(segment.end, start + seconds));
    const inside = frames.filter((f) => f.t >= start && f.t < end);
    const activity = inside.length ? inside.reduce((sum, f) => sum + f.value, 0) / inside.length : 0;
    return { start, end, peak: round3((start + end) / 2), activity: Number(activity.toFixed(5)) };
  });
}

export function analyzeFootage(video, { count = 3, seconds = 3 } = {}) {
  const total = duration(video);
  const cuts = parseSceneCuts(ffmpegStderr(["-i", video, "-an", "-vf", `select='gt(scene,${SCENE_THRESHOLD})',showinfo`, "-f", "null", "-"]));
  const changed = frameSeries(
    ffmpegStderr([
      "-i", video, "-an",
      "-vf", `scale=${ANALYSIS_WIDTH}:-2,format=gray,tblend=all_mode=difference,lutyuv=y='if(gt(val,${CHANGE_LEVEL}),255,0)',signalstats,metadata=print`,
      "-f", "null", "-",
    ]),
    "lavfi.signalstats.YAVG",
  ).map((f) => ({ t: f.t, value: f.value / 255 }));
  const stats = ffmpegStderr(["-i", video, "-an", "-vf", `scale=${ANALYSIS_WIDTH}:-2,format=gray,signalstats,metadata=print`, "-f", "null", "-"]);
  const lows = frameSeries(stats, "lavfi.signalstats.YMIN");
  const spreads = frameSeries(stats, "lavfi.signalstats.YMAX").map((h, i) => ({ t: h.t, spread: h.value - (lows[i]?.value ?? 0) }));

  const segments = segmentsFromCuts(cuts, total);
  const candidates = segments.flatMap((segment) => {
    // Skip the frames right after a cut (and the baked poster at 0s): the jump is not activity.
    const frames = changed.filter((f) => f.t >= segment.start + SETTLE_AFTER_CUT && f.t < segment.end);
    return slidingWindows(segment, frames, { seconds }).map((window) => {
      const inWindow = spreads.filter((s) => s.t >= window.start && s.t < window.end).map((s) => s.spread).sort((a, b) => a - b);
      const median = inWindow.length ? inWindow[Math.floor(inWindow.length / 2)] : 0;
      return { ...window, blank: median < BLANK_SPREAD };
    });
  });

  return { duration: round3(total), segments, moments: pickMoments(candidates, { count, seconds }) };
}

export function trimClip(video, { start, end }, output) {
  mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  ffmpegStderr([
    "-y", "-ss", String(start), "-i", video, "-t", String(round3(end - start)), "-an",
    "-c:v", "libx264", "-crf", "18", "-preset", "slow", "-pix_fmt", "yuv420p", "-movflags", "+faststart", output,
  ]);
  return output;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const [command, video, ...rest] = process.argv.slice(2);
  const flag = (name, fallback) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : fallback);
  try {
    if (!["analyze", "cut"].includes(command) || !video) throw new Error("Usage: footage.mjs analyze|cut <recording> [--count 3] [--seconds 3] [--out dir]");
    const result = analyzeFootage(video, { count: Number(flag("--count", 3)), seconds: Number(flag("--seconds", 3)) });
    if (command === "cut") {
      const outDir = flag("--out");
      if (!outDir) throw new Error("cut needs --out <dir>");
      result.clips = result.moments.map((moment, i) => trimClip(video, moment, path.join(outDir, `moment-${i + 1}.mp4`)));
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
