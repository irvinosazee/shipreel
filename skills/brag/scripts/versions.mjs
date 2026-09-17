#!/usr/bin/env node
/**
 * Versioned renders for /brag re-rolls.
 *
 *   node <skill-root>/scripts/versions.mjs save <output-dir> --label "retone deadpan"
 *   node <skill-root>/scripts/versions.mjs list <output-dir>
 *   node <skill-root>/scripts/versions.mjs compare <output-dir> 1 2
 *
 * `save` copies the current deliverables into <output-dir>/versions/vN/ with meta.json
 * and sheet.jpg (one still per scene from scenes.json). `compare` writes
 * versions/compare-vA-vB.jpg — version A on the left, B on the right, one row per
 * scene — and reports the duration change.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadScenes, stillTime } from "./cuts.mjs";

const DELIVERABLES = ["brag.mp4", "brag.jpg", "brag-plan.md", "scenes.json", "review.md", "share-copy.txt", "composition-brief.md"];
const TILE = [270, 480];

function run(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${cmd} failed: ${(result.stderr || "").trim().split("\n").slice(-2).join(" ")}`);
  return result.stdout;
}

const duration = (video) => Number(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video]).trim());
const versionsDir = (dir) => path.join(dir, "versions");
const versionDir = (dir, n) => path.join(versionsDir(dir), `v${n}`);

export function listVersions(dir) {
  if (!existsSync(versionsDir(dir))) return [];
  return readdirSync(versionsDir(dir))
    .map((name) => name.match(/^v(\d+)$/))
    .filter(Boolean)
    .map(([name]) => JSON.parse(readFileSync(path.join(versionsDir(dir), name, "meta.json"), "utf8")))
    .sort((a, b) => a.version - b.version);
}

/** One frame per scene at its still time, each fitted into a TILE-sized cell (letterboxed, never stretched). */
function sceneFrames(video, scenes, outDir, prefix) {
  // Never seek past the last frame: a stale scenes.json can outlast a shorter re-render.
  const last = Math.max(0, duration(video) - 0.1);
  return scenes.map((scene, i) => {
    const file = path.join(outDir, `${prefix}-${String(i + 1).padStart(2, "0")}.png`);
    run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y", "-ss", String(Math.min(stillTime(scene), last)), "-i", video, "-frames:v", "1",
      "-vf", `scale=${TILE[0]}:${TILE[1]}:force_original_aspect_ratio=decrease,pad=${TILE[0]}:${TILE[1]}:(ow-iw)/2:(oh-ih)/2:black`,
      file,
    ]);
    return file;
  });
}

function tileImages(files, output, columns) {
  const inputs = files.flatMap((file) => ["-i", file]);
  const layout = files.map((_, i) => `${(i % columns) * TILE[0]}_${Math.floor(i / columns) * TILE[1]}`).join("|");
  const filter = files.length === 1 ? "[0:v]copy[out]" : `${files.map((_, i) => `[${i}:v]`).join("")}xstack=inputs=${files.length}:layout=${layout}:fill=black[out]`;
  run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...inputs, "-filter_complex", filter, "-map", "[out]", "-frames:v", "1", "-q:v", "3", output]);
  return output;
}

function scenesFor(dir, video) {
  const file = path.join(dir, "scenes.json");
  if (existsSync(file)) return loadScenes(file);
  const length = duration(video);
  return Array.from({ length: Math.max(1, Math.round(length / 3)) }, (_, i) => ({ name: `t${i}`, start: i * 3, end: Math.min(length, (i + 1) * 3) }));
}

export function saveVersion(dir, { label = "" } = {}) {
  const video = path.join(dir, "brag.mp4");
  if (!existsSync(video)) throw new Error(`No brag.mp4 in ${dir} to version.`);
  const version = (listVersions(dir).at(-1)?.version ?? 0) + 1;
  const target = versionDir(dir, version);
  mkdirSync(target, { recursive: true });

  const files = DELIVERABLES.filter((name) => existsSync(path.join(dir, name)));
  for (const name of files) copyFileSync(path.join(dir, name), path.join(target, name));

  const scenes = scenesFor(target, path.join(target, "brag.mp4"));
  const frames = sceneFrames(path.join(target, "brag.mp4"), scenes, target, "scene");
  const sheet = tileImages(frames, path.join(target, "sheet.jpg"), Math.min(scenes.length, 6));
  for (const frame of frames) rmSync(frame, { force: true });

  const length = duration(path.join(target, "brag.mp4"));
  const warnings = [];
  const scenesEnd = scenes.at(-1).end;
  if (scenesEnd > length + 0.25) {
    warnings.push(`scenes.json runs to ${scenesEnd}s but brag.mp4 is ${length.toFixed(1)}s; update scenes.json after re-rolls`);
  }
  const meta = { version, label, files, scenes: scenes.length, duration: Number(length.toFixed(2)), warnings };
  writeFileSync(path.join(target, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
  return { ...meta, dir: target, sheet };
}

export function compareVersions(dir, a, b) {
  for (const n of [a, b]) if (!existsSync(path.join(versionDir(dir, n), "meta.json"))) throw new Error(`No version v${n} in ${versionsDir(dir)}.`);
  const [left, right] = [a, b].map((n) => ({ dir: versionDir(dir, n), meta: JSON.parse(readFileSync(path.join(versionDir(dir, n), "meta.json"), "utf8")) }));
  const leftScenes = scenesFor(left.dir, path.join(left.dir, "brag.mp4"));
  const rightScenes = scenesFor(right.dir, path.join(right.dir, "brag.mp4"));
  const rows = Math.max(leftScenes.length, rightScenes.length);

  const work = path.join(versionsDir(dir), `.compare-${a}-${b}`);
  mkdirSync(work, { recursive: true });
  const blank = path.join(work, "blank.png");
  run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `color=black:size=${TILE[0]}x${TILE[1]}`, "-frames:v", "1", blank]);
  const leftFrames = sceneFrames(path.join(left.dir, "brag.mp4"), leftScenes, work, "a");
  const rightFrames = sceneFrames(path.join(right.dir, "brag.mp4"), rightScenes, work, "b");
  const cells = [];
  for (let row = 0; row < rows; row += 1) cells.push(leftFrames[row] ?? blank, rightFrames[row] ?? blank);

  const image = tileImages(cells, path.join(versionsDir(dir), `compare-v${a}-v${b}.jpg`), 2);
  rmSync(work, { recursive: true, force: true });
  return {
    image,
    left: { version: a, label: left.meta.label, scenes: leftScenes.map((s) => s.name) },
    right: { version: b, label: right.meta.label, scenes: rightScenes.map((s) => s.name) },
    durationDelta: Number((right.meta.duration - left.meta.duration).toFixed(2)),
  };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const [command, dir, ...rest] = process.argv.slice(2);
  try {
    if (command === "save") console.log(JSON.stringify(saveVersion(dir, { label: rest.includes("--label") ? rest[rest.indexOf("--label") + 1] : "" }), null, 2));
    else if (command === "list") console.log(JSON.stringify(listVersions(dir), null, 2));
    else if (command === "compare") console.log(JSON.stringify(compareVersions(dir, Number(rest[0]), Number(rest[1])), null, 2));
    else {
      console.error("Usage: versions.mjs save|list|compare <output-dir> [--label text] [a b]");
      process.exitCode = 2;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
