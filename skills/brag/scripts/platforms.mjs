#!/usr/bin/env node
/**
 * Platform presets for `/brag --for ...`.
 *
 *   node <skill-root>/scripts/platforms.mjs plan --for tiktok,reels,x
 *   node <skill-root>/scripts/platforms.mjs export --for tiktok,x --render vertical=brag-vertical.mp4 \
 *        --render landscape=brag.mp4 --out brag-output/exports
 *   node <skill-root>/scripts/platforms.mjs zones <frame.jpg> --for tiktok --out zones.jpg
 *
 * `plan` prints the renders to make: one per frame size, with the strictest safe
 * zone, caption mode, and size budget of every platform sharing that size.
 * `export` writes brag-<platform>.mp4 for each platform, re-encoding only when a
 * render is over the platform's size budget or wider than its export width.
 * `zones` shades the unsafe margins on a review frame.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATA_PATH = fileURLToPath(new URL("../assets/platforms.json", import.meta.url));
const CONTAINER_HEADROOM = 0.92;
const MIN_VIDEO_KBPS = 150;
const CAPTION_RANK = { none: 0, sidecar: 1, burned: 2 };
const EDGES = ["top", "right", "bottom", "left"];

let cached;
export function loadPlatforms() {
  cached ??= JSON.parse(readFileSync(DATA_PATH, "utf8"));
  return cached;
}

export function resolvePlatforms(spec) {
  const { platforms, groups } = loadPlatforms();
  const ids = [];
  for (const name of String(spec).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    if (groups[name]) ids.push(...groups[name]);
    else if (platforms[name]) ids.push(name);
    else {
      const known = [...Object.keys(platforms), ...Object.keys(groups)].join(", ");
      throw new Error(`Unknown platform "${name}". Use one of: ${known}.`);
    }
  }
  return [...new Set(ids)].map((id) => ({ id, ...platforms[id] }));
}

export function planRenders(selected) {
  const { formats } = loadPlatforms();
  const byFormat = new Map();
  for (const platform of selected) {
    if (!byFormat.has(platform.format)) {
      byFormat.set(platform.format, {
        format: platform.format,
        size: formats[platform.format].size,
        aspect: formats[platform.format].aspect,
        platforms: [],
        safeZone: { top: 0, right: 0, bottom: 0, left: 0 },
        captions: "none",
        maxMb: null,
        maxDurationSec: null,
      });
    }
    const render = byFormat.get(platform.format);
    render.platforms.push(platform.id);
    for (const edge of EDGES) render.safeZone[edge] = Math.max(render.safeZone[edge], platform.safeZone[edge]);
    if (CAPTION_RANK[platform.captions] > CAPTION_RANK[render.captions]) render.captions = platform.captions;
    if (platform.maxMb != null) render.maxMb = Math.min(render.maxMb ?? Infinity, platform.maxMb);
    if (platform.maxDurationSec != null) {
      render.maxDurationSec = Math.min(render.maxDurationSec ?? Infinity, platform.maxDurationSec);
    }
  }
  return [...byFormat.values()].map((render) => ({
    ...render,
    safeZonePx: safeZoneInsets(render.size, render.safeZone),
  }));
}

export function safeZoneInsets([width, height], zone) {
  const top = Math.round(height * zone.top);
  const bottom = Math.round(height * zone.bottom);
  const left = Math.round(width * zone.left);
  const right = Math.round(width * zone.right);
  return { top, right, bottom, left, safe: { x: left, y: top, width: width - left - right, height: height - top - bottom } };
}

export function budgetBitrateKbps({ maxMb, durationSec, audioKbps = 128 }) {
  const totalKbps = (maxMb * 1024 * 1024 * 8 * CONTAINER_HEADROOM) / durationSec / 1000;
  const videoKbps = Math.floor(totalKbps - audioKbps);
  if (videoKbps < MIN_VIDEO_KBPS) {
    throw new Error(`A ${maxMb} MB budget is too small for ${durationSec.toFixed(1)}s of video.`);
  }
  return videoKbps;
}

function run(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${cmd} failed: ${(result.stderr || "").trim().split("\n").slice(-3).join(" ")}`);
  return result.stdout;
}

function probe(file) {
  const data = JSON.parse(run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]));
  const video = data.streams.find((s) => s.codec_type === "video");
  return { duration: Number(data.format.duration), width: video.width, hasAudio: data.streams.some((s) => s.codec_type === "audio") };
}

function encode({ source, target, videoKbps, width }) {
  const scale = width ? ["-vf", `scale=${width}:-2`] : [];
  const common = ["-hide_banner", "-loglevel", "error", "-y", "-i", source, ...scale, "-c:v", "libx264", "-pix_fmt", "yuv420p"];
  if (!videoKbps) {
    run("ffmpeg", [...common, "-crf", "20", "-preset", "slow", "-map", "0:v", "-map", "0:a?", "-c:a", "copy", "-movflags", "+faststart", target]);
    return;
  }
  const passlog = path.join(tmpdir(), `brag-pass-${process.pid}-${Date.now()}`);
  try {
    run("ffmpeg", [...common, "-b:v", `${videoKbps}k`, "-pass", "1", "-passlogfile", passlog, "-an", "-f", "mp4", process.platform === "win32" ? "NUL" : "/dev/null"]);
    run("ffmpeg", [
      ...common, "-b:v", `${videoKbps}k`, "-maxrate", `${Math.round(videoKbps * 1.2)}k`, "-bufsize", `${videoKbps * 2}k`,
      "-pass", "2", "-passlogfile", passlog, "-map", "0:v", "-map", "0:a?", "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart", target,
    ]);
  } finally {
    for (const suffix of ["-0.log", "-0.log.mbtree"]) rmSync(`${passlog}${suffix}`, { force: true });
  }
}

function hasEncoder(name) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8" });
  return new RegExp(`\\s${name}\\s`).test(result.stdout ?? "");
}

function makeWebp(source, target, width = 640) {
  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-i", source,
    "-vf", `fps=15,scale=${width}:-2:flags=lanczos`, "-c:v", "libwebp", "-loop", "0", "-quality", "75", "-an", target,
  ]);
}

function makeGif(source, target, width = 640) {
  const filters = `fps=12,scale=${width}:-2:flags=lanczos`;
  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-i", source,
    "-filter_complex", `[0:v]${filters},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a`,
    target,
  ]);
}

export function exportForPlatforms({ renders, platformIds, outDir, overrides = {} }) {
  const { platforms } = loadPlatforms();
  mkdirSync(outDir, { recursive: true });
  const results = [];

  for (const id of platformIds) {
    const platform = { ...platforms[id], ...overrides[id] };
    const source = renders[platform.format];
    if (!source || !existsSync(source)) {
      results.push({ platform: id, action: "missing-render", message: `No ${platform.format} render for ${platform.label}; render that format first.` });
      continue;
    }

    const target = path.join(outDir, `brag-${id}.mp4`);
    const info = probe(source);
    const tooWide = platform.exportWidth && info.width > platform.exportWidth;
    const overBudget = platform.maxMb && statSync(source).size > platform.maxMb * 1024 * 1024;

    let action = "copied";
    if (overBudget) {
      encode({
        source,
        target,
        width: tooWide ? platform.exportWidth : null,
        videoKbps: budgetBitrateKbps({ maxMb: platform.maxMb, durationSec: info.duration, audioKbps: info.hasAudio ? 128 : 0 }),
      });
      action = "re-encoded";
    } else if (tooWide) {
      encode({ source, target, width: platform.exportWidth });
      action = "scaled";
    } else {
      copyFileSync(source, target);
    }

    const result = { platform: id, action, path: target, sizeMb: Number((statSync(target).size / 1024 / 1024).toFixed(2)) };
    if (platform.maxMb && statSync(target).size > platform.maxMb * 1024 * 1024) {
      result.warning = `Still over the ${platform.maxMb} MB budget; shorten the video or lower the resolution.`;
    }
    if (platform.gif) {
      result.gif = path.join(outDir, `brag-${id}.gif`);
      makeGif(target, result.gif);
      // Animated WebP is smaller than GIF with full color; it needs an ffmpeg built with libwebp.
      if (hasEncoder("libwebp")) {
        result.webp = path.join(outDir, `brag-${id}.webp`);
        makeWebp(target, result.webp);
      } else {
        result.webpSkipped = "ffmpeg has no libwebp encoder; install an ffmpeg build with libwebp for brag-readme.webp";
      }
    }
    results.push(result);
  }
  return results;
}

export function drawSafeZones(framePath, outPath, zone, color = "red@0.35") {
  const boxes = [
    `drawbox=x=0:y=0:w=iw:h=ih*${zone.top}:color=${color}:t=fill`,
    `drawbox=x=0:y=ih*(1-${zone.bottom}):w=iw:h=ih*${zone.bottom}:color=${color}:t=fill`,
    `drawbox=x=0:y=ih*${zone.top}:w=iw*${zone.left}:h=ih*(1-${zone.top}-${zone.bottom}):color=${color}:t=fill`,
    `drawbox=x=iw*(1-${zone.right}):y=ih*${zone.top}:w=iw*${zone.right}:h=ih*(1-${zone.top}-${zone.bottom}):color=${color}:t=fill`,
  ].join(",");
  // Blend in 4:4:4; chroma-subsampled frames make the translucent fill nearly opaque.
  run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", framePath, "-vf", `format=yuv444p,${boxes}`, "-frames:v", "1", outPath]);
  return outPath;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { renders: {}, positional: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--for") options.for = rest[++i];
    else if (arg === "--out") options.out = rest[++i];
    else if (arg === "--render") {
      const [format, file] = rest[++i].split("=");
      options.renders[format] = path.resolve(file);
    } else options.positional.push(arg);
  }
  return { command, options };
}

function main(argv) {
  const { command, options } = parseArgs(argv);
  const usage = "Usage: platforms.mjs plan|export|zones --for <platforms> [--render format=file] [--out path]";
  if (!options.for || !["plan", "export", "zones"].includes(command)) {
    console.error(usage);
    process.exitCode = 2;
    return;
  }
  const selected = resolvePlatforms(options.for);

  if (command === "plan") {
    console.log(JSON.stringify({ platforms: selected.map((p) => p.id), renders: planRenders(selected) }, null, 2));
  } else if (command === "export") {
    if (!options.out) throw new Error("export needs --out <dir>");
    const results = exportForPlatforms({ renders: options.renders, platformIds: selected.map((p) => p.id), outDir: options.out });
    console.log(JSON.stringify(results, null, 2));
    if (results.some((r) => r.action === "missing-render")) process.exitCode = 1;
  } else {
    const [frame] = options.positional;
    if (!frame || !options.out) throw new Error("zones needs <frame> and --out <file>");
    const render = planRenders(selected)[0];
    if (planRenders(selected).length > 1) console.error(`Using the ${render.format} safe zone; pass platforms of one format for others.`);
    console.log(drawSafeZones(frame, options.out, render.safeZone));
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
