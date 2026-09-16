#!/usr/bin/env node
/**
 * Verify a rendered brag video before it is delivered.
 *
 *   node <skill-root>/scripts/verify_render.mjs <brag.mp4> [options]
 *
 * Options:
 *   --format landscape|vertical|square|feed   expected frame size (default: landscape)
 *   --size WxH                                explicit expected frame size (overrides --format)
 *   --min 15 --max 25                         duration range in seconds
 *   --poster brag.jpg                         check that the poster is baked into frame 0
 *   --no-audio                                the plan intentionally has no audio
 *   --max-mb N                                file size budget
 *   --json                                    machine-readable report
 *
 * Errors (exit 1) break the /brag contract: wrong duration or size, missing or
 * silent audio, poster not baked, over budget. Warnings are delivery-quality
 * issues worth fixing: quiet mix, blank frame 0, no faststart, odd pixel format.
 */

import { spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FORMAT_SIZES = {
  landscape: [1920, 1080],
  vertical: [1080, 1920],
  square: [1080, 1080],
  feed: [1080, 1350],
};

// Social platforms normalize playback to roughly -14 LUFS; a mix far below that sounds weak next to other posts.
const LUFS_RANGE = [-18, -10];
const SILENT_MAX_DB = -50;
const DURATION_TOLERANCE = 0.25;
const POSTER_MIN_SSIM = 0.9;
const FLAT_FRAME_SPREAD = 40;
const COMMON_FPS = [24, 25, 30, 50, 60];

export function parseFps(rate) {
  const [num, den] = String(rate ?? "").split("/").map(Number);
  if (!num || !den) return null;
  return num / den;
}

const numberAfter = (text, pattern) => {
  const match = String(text ?? "").match(pattern);
  return match ? Number(match[1]) : null;
};

export function parseVolumedetect(stderr) {
  return {
    meanDb: numberAfter(stderr, /mean_volume:\s*(-?[\d.]+|-inf) dB/),
    maxDb: numberAfter(stderr, /max_volume:\s*(-?[\d.]+) dB/),
  };
}

export function parseEbur128(stderr) {
  const summary = String(stderr ?? "").split("Integrated loudness:")[1];
  return summary ? numberAfter(summary, /I:\s*(-?[\d.]+) LUFS/) : null;
}

export function parseSignalstats(stderr) {
  const read = (key) => numberAfter(stderr, new RegExp(`lavfi\\.signalstats\\.${key}=([\\d.]+)`));
  const stats = { ymin: read("YMIN"), yavg: read("YAVG"), ymax: read("YMAX") };
  return stats.ymin == null ? null : stats;
}

export function parseSsim(stderr) {
  return numberAfter(stderr, /All:([\d.]+)/);
}

/** Top-level MP4 atom types in file order, up to and including the first moov or mdat. */
export function atomOrder(buffer) {
  const types = [];
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    types.push(type);
    if (type === "moov" || type === "mdat") break;
    if (size === 1 && offset + 16 <= buffer.length) size = Number(buffer.readBigUInt64BE(offset + 8));
    if (size < 8) break;
    offset += size;
  }
  return types;
}

function run(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    failed: result.error != null || result.status !== 0,
  };
}

// ffmpeg writes filter reports (volumedetect, ebur128, signalstats, ssim) to stderr.
function ffmpegStderr(args) {
  return run("ffmpeg", ["-hide_banner", "-nostats", ...args, "-f", "null", "-"]).stderr;
}

function faststart(file) {
  const fd = openSync(file, "r");
  try {
    const buffer = Buffer.alloc(Math.min(statSync(file).size, 1024 * 1024));
    readSync(fd, buffer, 0, buffer.length, 0);
    const order = atomOrder(buffer);
    if (order.includes("moov")) return true;
    if (order.includes("mdat")) return false;
    return null;
  } finally {
    closeSync(fd);
  }
}

export function probeVideo(file, { posterPath } = {}) {
  const probe = run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
  if (probe.failed) throw new Error(`ffprobe could not read ${file}: ${probe.stderr.trim()}`);
  const data = JSON.parse(probe.stdout);
  const video = data.streams.find((s) => s.codec_type === "video");
  const audio = data.streams.find((s) => s.codec_type === "audio");

  const facts = {
    sizeBytes: statSync(file).size,
    duration: Number(data.format?.duration ?? video?.duration ?? 0),
    width: video?.width ?? null,
    height: video?.height ?? null,
    fps: parseFps(video?.avg_frame_rate) ?? parseFps(video?.r_frame_rate),
    videoCodec: video?.codec_name ?? null,
    pixFmt: video?.pix_fmt ?? null,
    hasAudio: Boolean(audio),
    audioCodec: audio?.codec_name ?? null,
    faststart: faststart(file),
    maxVolumeDb: null,
    integratedLufs: null,
    frame0: null,
    posterSsim: null,
  };

  if (audio) {
    facts.maxVolumeDb = parseVolumedetect(ffmpegStderr(["-i", file, "-vn", "-af", "volumedetect"])).maxDb;
    facts.integratedLufs = parseEbur128(ffmpegStderr(["-i", file, "-vn", "-af", "ebur128=framelog=quiet"]));
  }
  if (video) {
    facts.frame0 = parseSignalstats(
      ffmpegStderr(["-i", file, "-an", "-vf", "select=eq(n\\,0),signalstats,metadata=print", "-frames:v", "1"]),
    );
  }
  if (video && posterPath && existsSync(posterPath)) {
    facts.posterSsim = parseSsim(
      ffmpegStderr([
        "-i", file, "-i", posterPath, "-an",
        "-filter_complex", `[0:v]select=eq(n\\,0),setsar=1[f0];[1:v]scale=${video.width}:${video.height},setsar=1,format=${video.pix_fmt ?? "yuv420p"}[p];[f0][p]ssim`,
        "-frames:v", "1",
      ]),
    );
  }
  return facts;
}

export function evaluate(facts, expect = {}) {
  const errors = [];
  const warnings = [];
  const errorCodes = [];
  const warningCodes = [];
  // Stable codes let CI compare runs without depending on message wording or measured numbers.
  const fail = (code, message) => {
    errorCodes.push(code);
    errors.push(message);
  };
  const warn = (code, message) => {
    warningCodes.push(code);
    warnings.push(message);
  };
  const minDuration = expect.minDuration ?? 15;
  const maxDuration = expect.maxDuration ?? 25;
  const [width, height] =
    expect.width && expect.height ? [expect.width, expect.height] : FORMAT_SIZES[expect.format ?? "landscape"];
  const wantsAudio = expect.audio !== false;

  if (facts.duration < minDuration - DURATION_TOLERANCE || facts.duration > maxDuration + DURATION_TOLERANCE) {
    fail("duration", `Duration is ${facts.duration.toFixed(1)}s; the plan allows ${minDuration}–${maxDuration}s.`);
  }
  if (facts.width !== width || facts.height !== height) {
    fail("frame-size", `Frame size is ${facts.width}x${facts.height}; expected ${width}x${height}.`);
  }
  if (wantsAudio && !facts.hasAudio) {
    fail("no-audio", "The video has no audio stream, but the plan includes music or SFX.");
  } else if (wantsAudio && facts.maxVolumeDb != null && facts.maxVolumeDb <= SILENT_MAX_DB) {
    fail("silent-audio", `The audio track is silent (peak ${facts.maxVolumeDb} dB) — check that audio assets were copied into composition/assets/.`);
  }
  if (expect.poster && facts.posterSsim != null && facts.posterSsim < POSTER_MIN_SSIM) {
    fail("poster-not-baked", 
      `The poster is not baked into frame 0 (similarity ${facts.posterSsim.toFixed(2)}); thumbnails on Slack, X, and Discord will show the wrong frame.`,
    );
  }
  if (expect.maxMb && facts.sizeBytes > expect.maxMb * 1024 * 1024) {
    fail("over-budget", `File is ${(facts.sizeBytes / 1024 / 1024).toFixed(1)} MB, over the ${expect.maxMb} MB budget.`);
  }

  if (facts.frame0 && facts.frame0.ymax - facts.frame0.ymin < FLAT_FRAME_SPREAD && facts.posterSsim == null) {
    warn("flat-frame0", "Frame 0 is a flat, featureless frame; bake the best-beat poster into frame 0 so idle thumbnails are postable.");
  }
  if (facts.integratedLufs != null && (facts.integratedLufs < LUFS_RANGE[0] || facts.integratedLufs > LUFS_RANGE[1])) {
    warn("loudness", 
      `Integrated loudness is ${facts.integratedLufs} LUFS; aim for about -14 LUFS (${LUFS_RANGE[0]} to ${LUFS_RANGE[1]}) so it holds up next to other posts.`,
    );
  }
  if (facts.faststart === false) {
    warn("no-faststart", "The moov atom is at the end of the file; re-mux with -movflags +faststart so web players start instantly.");
  }
  if (facts.videoCodec && facts.videoCodec !== "h264") {
    warn("codec", `Video codec is ${facts.videoCodec}; H.264 is the most widely accepted for social uploads.`);
  }
  if (facts.pixFmt && facts.pixFmt !== "yuv420p") {
    warn("pixel-format", `Pixel format is ${facts.pixFmt}; use yuv420p for compatibility with phones and social platforms.`);
  }
  if (facts.fps && !COMMON_FPS.some((fps) => Math.abs(fps - facts.fps) < 0.05 || Math.abs(fps * 1000 / 1001 - facts.fps) < 0.05)) {
    warn("frame-rate", `Frame rate is ${Number(facts.fps.toFixed(2))} fps; use 30 or 60.`);
  }

  return { errors, warnings, errorCodes, warningCodes };
}

export function verifyRender(file, expect = {}) {
  const facts = probeVideo(file, { posterPath: expect.posterPath });
  const result = evaluate(facts, { ...expect, poster: Boolean(expect.posterPath) });
  return { file, ok: result.errors.length === 0, ...result, facts };
}

function parseArgs(argv) {
  const expect = {};
  let file = null;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === "--json") json = true;
    else if (arg === "--no-audio") expect.audio = false;
    else if (arg === "--format") expect.format = next();
    else if (arg === "--size") [expect.width, expect.height] = next().split("x").map(Number);
    else if (arg === "--min") expect.minDuration = Number(next());
    else if (arg === "--max") expect.maxDuration = Number(next());
    else if (arg === "--poster") expect.posterPath = next();
    else if (arg === "--max-mb") expect.maxMb = Number(next());
    else file = arg;
  }
  return { file, expect, json };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const { file, expect, json } = parseArgs(process.argv.slice(2));
  if (!file || !existsSync(file)) {
    console.error("Usage: verify_render.mjs <video.mp4> [--format vertical] [--poster brag.jpg] [--json]");
    process.exitCode = 2;
  } else {
    if (expect.format && !FORMAT_SIZES[expect.format]) {
      console.error(`Unknown format "${expect.format}". Use one of: ${Object.keys(FORMAT_SIZES).join(", ")}.`);
      process.exitCode = 2;
    } else {
      const report = verifyRender(path.resolve(file), expect);
      if (json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        const f = report.facts;
        console.log(
          `${path.basename(file)}: ${f.duration.toFixed(2)}s · ${f.width}x${f.height} · ${f.fps ? Number(f.fps.toFixed(2)) : "?"} fps · ` +
            `${(f.sizeBytes / 1024 / 1024).toFixed(1)} MB · audio ${f.hasAudio ? `${f.integratedLufs ?? "?"} LUFS` : "none"}`,
        );
        for (const error of report.errors) console.log(`✗ ${error}`);
        for (const warning of report.warnings) console.log(`! ${warning}`);
        if (report.ok && report.warnings.length === 0) console.log("✓ Render verified.");
      }
      process.exitCode = report.ok ? 0 : 1;
    }
  }
}
