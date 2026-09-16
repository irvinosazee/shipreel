#!/usr/bin/env node
/**
 * /brag preflight doctor.
 *
 * Resolves the skill root from this script's own location (works for plugin
 * cache installs, `npx skills`, manual copies, and the repo), checks the
 * toolchain and bundled assets, and reports what this run can do.
 *
 *   node <skill-root>/scripts/brag_doctor.mjs [--json] [--no-music] [--no-sfx] [--voice]
 *
 * Exit code 1 only for hard blockers (Node < 22, FFmpeg/ffprobe, Hyperframes).
 * Missing audio assets or beat-sync tooling degrade the run instead.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIN_NODE = [22, 0, 0];
const MIN_HYPERFRAMES_BEATS = [0, 6, 99];

export function parseVersion(text) {
  const match = String(text ?? "").match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

export function compareVersions(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

export function resolveSkillRoot(scriptUrl = import.meta.url) {
  return path.resolve(path.dirname(fileURLToPath(scriptUrl)), "..");
}

function listFiles(dir, pattern) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => pattern.test(name) && statSync(path.join(dir, name)).isFile())
    .sort();
}

export function checkAssets(skillRoot) {
  const musicDir = path.join(skillRoot, "assets/music");
  const cuesDir = path.join(musicDir, "cues");
  const sfxDir = path.join(skillRoot, "assets/sfx");

  const tracks = listFiles(musicDir, /\.(mp3|wav|ogg|m4a)$/i);
  const missingCues = tracks
    .map((track) => track.replace(/\.[^.]+$/, ""))
    .filter((stem) => !existsSync(path.join(cuesDir, `${stem}.music-cues.json`)));

  const families = {};
  if (existsSync(sfxDir)) {
    for (const name of readdirSync(sfxDir)) {
      const dir = path.join(sfxDir, name);
      if (!statSync(dir).isDirectory()) continue;
      const count = listFiles(dir, /\.(ogg|wav|mp3)$/i).length;
      if (count > 0) families[name] = count;
    }
  }

  return {
    root: path.join(skillRoot, "assets"),
    music: { tracks, missingCues },
    sfx: { families, analysis: existsSync(path.join(sfxDir, "sfx-analysis.json")) },
  };
}

function defaultRun(cmd, args) {
  try {
    return execFileSync(cmd, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
    });
  } catch {
    return null;
  }
}

export function detectTools({ nodeVersion = process.version, run = defaultRun } = {}) {
  const version = (cmd, args) => parseVersion(run(cmd, args));
  return {
    node: parseVersion(nodeVersion),
    ffmpeg: version("ffmpeg", ["-version"]),
    ffprobe: version("ffprobe", ["-version"]),
    hyperframes: version("npx", ["-y", "hyperframes", "--version"]),
    uv: version("uv", ["--version"]),
  };
}

const fmt = (v) => (v ? v.join(".") : "missing");

export function summarize({ tools, assets, flags = {} }) {
  const blockers = [];
  const warnings = [];

  if (!tools.node || compareVersions(tools.node, MIN_NODE) < 0) {
    blockers.push(`Node.js 22+ is required (found ${fmt(tools.node)}).`);
  }
  if (!tools.ffmpeg || !tools.ffprobe) {
    blockers.push("FFmpeg and ffprobe must be on PATH (brew install ffmpeg / apt install ffmpeg).");
  }
  if (!tools.hyperframes) {
    blockers.push("Hyperframes CLI is unavailable (`npx hyperframes --version` failed).");
  }

  const hasMusic = assets.music.tracks.length > 0;
  const hasSfx = Object.keys(assets.sfx.families).length > 0;
  const music = !flags.noMusic && hasMusic;
  const sfx = !flags.noSfx && hasSfx;

  if (!flags.noMusic && !hasMusic) {
    warnings.push(`No bundled music found under ${assets.root ?? "assets"}/music — the video will render without a music bed.`);
  }
  if (!flags.noSfx && !hasSfx) {
    warnings.push(`No bundled SFX found under ${assets.root ?? "assets"}/sfx — the video will render without sound effects.`);
  }
  if (music && assets.music.missingCues.length > 0) {
    warnings.push(`Cue presets missing for: ${assets.music.missingCues.join(", ")}.`);
  }

  const beatsSupported = tools.hyperframes && compareVersions(tools.hyperframes, MIN_HYPERFRAMES_BEATS) >= 0;
  let custom = "unavailable";
  if (tools.uv) custom = "analyze-script";
  else if (beatsSupported) custom = "hyperframes-beats";

  let bundled = "unavailable";
  if (hasMusic) bundled = assets.music.missingCues.length < assets.music.tracks.length ? "preset" : custom;

  if (flags.voice && !tools.hyperframes) {
    warnings.push("--voice needs Hyperframes TTS; narration will be skipped.");
  }

  return {
    blockers,
    warnings,
    capabilities: {
      music,
      sfx,
      beatSync: flags.noMusic ? { bundled: "unavailable", custom: "unavailable" } : { bundled, custom },
      voice: Boolean(flags.voice && tools.hyperframes),
    },
  };
}

function printReport({ skillRoot, tools, assets, report }) {
  const line = (ok, label, detail) => console.log(`${ok ? "✓" : "✗"} ${label.padEnd(12)} ${detail}`);
  console.log(`/brag doctor — skill root: ${skillRoot}\n`);
  line(Boolean(tools.node) && compareVersions(tools.node, MIN_NODE) >= 0, "node", fmt(tools.node));
  line(Boolean(tools.ffmpeg), "ffmpeg", fmt(tools.ffmpeg));
  line(Boolean(tools.ffprobe), "ffprobe", fmt(tools.ffprobe));
  line(Boolean(tools.hyperframes), "hyperframes", fmt(tools.hyperframes));
  line(Boolean(tools.uv), "uv", `${fmt(tools.uv)} (optional: rich beat analysis for custom tracks)`);
  line(assets.music.tracks.length > 0, "music", `${assets.music.tracks.length} tracks`);
  const sfxCount = Object.values(assets.sfx.families).reduce((a, b) => a + b, 0);
  line(sfxCount > 0, "sfx", `${sfxCount} files`);

  const { capabilities } = report;
  console.log(
    `\nThis run: music ${capabilities.music ? "on" : "off"} · sfx ${capabilities.sfx ? "on" : "off"} · ` +
      `beat sync ${capabilities.beatSync.bundled} (bundled) / ${capabilities.beatSync.custom} (custom) · ` +
      `voice ${capabilities.voice ? "on" : "off"}`,
  );
  for (const warning of report.warnings) console.log(`! ${warning}`);
  for (const blocker of report.blockers) console.log(`BLOCKER: ${blocker}`);
}

function main(argv) {
  const flags = {
    json: argv.includes("--json"),
    noMusic: argv.includes("--no-music"),
    noSfx: argv.includes("--no-sfx"),
    voice: argv.includes("--voice"),
  };
  const skillRoot = resolveSkillRoot();
  const tools = detectTools();
  const assets = checkAssets(skillRoot);
  const report = summarize({ tools, assets, flags });

  if (flags.json) {
    console.log(JSON.stringify({ skillRoot, assetsRoot: assets.root, tools, assets, ...report }, null, 2));
  } else {
    printReport({ skillRoot, tools, assets, report });
  }
  process.exitCode = report.blockers.length > 0 ? 1 : 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2));
}
