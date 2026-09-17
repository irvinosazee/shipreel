#!/usr/bin/env node
/**
 * Brand kit for /brag: `.brag/config.json` in the project root.
 *
 *   node <skill-root>/scripts/brand.mjs check <project-dir> [--composition <dir>] [--share share-copy.txt]
 *
 * {
 *   "name": "Horse Tinder", "tone": "yc-parody",
 *   "palette": { "bg": "#1a120c", "fg": "#fff6ec", "accent": "#e8963a" },
 *   "fonts": { "display": "Fraunces", "body": "Inter", "files": { "Fraunces": "brand/Fraunces.woff2" } },
 *   "logo": "brand/logo.svg", "handle": "@horsetinder", "url": "https://horsetinder.app",
 *   "bannedWords": ["dating site"], "watermark": false, "captions": { "style": "lower-third" }
 * }
 *
 * `check` validates the kit and scans the composition's visible text and the share copy for
 * banned phrases — the brand's own plus generic SaaS filler /brag never uses.
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CAPTION_STYLES } from "./captions.mjs";

export const DEFAULT_BANNED = [
  "streamline your workflow", "supercharge", "unlock", "elevate", "revolutionize", "revolutionary",
  "game-changer", "game changer", "seamless", "seamlessly", "leverage", "next-level", "cutting-edge", "synergy",
];
const TONES = ["default", "polished", "yc-parody", "chaotic", "deadpan", "cinematic", "app-store"];
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function validateBrand(config, { projectDir = process.cwd() } = {}) {
  const problems = [];
  const brand = config ?? {};
  const fileExists = (rel) => existsSync(path.resolve(projectDir, rel));

  if (brand.tone != null && !TONES.includes(brand.tone)) problems.push(`tone "${brand.tone}" is not a preset (${TONES.join(", ")})`);
  for (const key of ["bg", "fg", "accent"]) {
    const value = brand.palette?.[key];
    if (value == null) problems.push(`palette.${key} is required`);
    else if (!HEX.test(value)) problems.push(`palette.${key} "${value}" is not a hex color like #1a120c`);
  }
  if (!brand.fonts?.display) problems.push("fonts.display is required");
  for (const [family, file] of Object.entries(brand.fonts?.files ?? {})) {
    if (!fileExists(file)) problems.push(`fonts.files.${family} ${file} does not exist`);
  }
  if (brand.logo != null && !fileExists(brand.logo)) problems.push(`logo ${brand.logo} does not exist`);
  if (brand.handle != null && !/^@?[A-Za-z0-9_.-]{1,39}$/.test(brand.handle)) problems.push(`handle "${brand.handle}" should look like @name`);
  if (brand.url != null && !/^https?:\/\/\S+$/.test(brand.url)) problems.push(`url "${brand.url}" must start with http:// or https:// and have no spaces`);
  if (brand.bannedWords != null && (!Array.isArray(brand.bannedWords) || brand.bannedWords.some((w) => typeof w !== "string"))) {
    problems.push("bannedWords must be a list of phrases");
  }
  if (brand.watermark != null && typeof brand.watermark !== "boolean") problems.push("watermark must be true or false");
  if (brand.captions?.style != null && !CAPTION_STYLES[brand.captions.style]) {
    problems.push(`captions.style "${brand.captions.style}" is not one of ${Object.keys(CAPTION_STYLES).join(", ")}`);
  }
  return { brand, problems };
}

export function loadBrand(projectDir) {
  const file = path.join(projectDir, ".brag", "config.json");
  if (!existsSync(file)) return null;
  try {
    return validateBrand(JSON.parse(readFileSync(file, "utf8")), { projectDir });
  } catch (error) {
    return { brand: null, problems: [`.brag/config.json is not valid JSON (${error.message})`] };
  }
}

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

export function compositionText(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<head\b[\s\S]*?<\/head>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (entity) => ENTITIES[entity])
    .replace(/\s+/g, " ")
    .trim();
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function bannedHits(text, brand = {}) {
  const phrases = [...new Set([...DEFAULT_BANNED, ...(brand?.bannedWords ?? [])].map((p) => p.toLowerCase()))];
  const hits = [];
  for (const phrase of phrases) {
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRegExp(phrase)})(?![\\p{L}\\p{N}])`, "giu");
    for (const match of text.matchAll(pattern)) {
      const index = match.index + match[1].length;
      hits.push({ phrase, context: text.slice(Math.max(0, index - 20), index + phrase.length + 20).trim() });
    }
  }
  return hits;
}

export function captionTheme(brand, band) {
  return { font: brand.fonts.body ?? brand.fonts.display, fg: brand.palette.fg, bg: brand.palette.bg, accent: brand.palette.accent, band };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const [command, projectDir, ...rest] = process.argv.slice(2);
  const flag = (name) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined);
  if (command !== "check" || !projectDir) {
    console.error("Usage: brand.mjs check <project-dir> [--composition <dir>] [--share share-copy.txt]");
    process.exitCode = 2;
  } else {
    const loaded = loadBrand(projectDir);
    const problems = loaded ? [...loaded.problems] : [];
    const texts = [];
    if (flag("--composition")) texts.push(["composition", compositionText(readFileSync(path.join(flag("--composition"), "index.html"), "utf8"))]);
    if (flag("--share")) texts.push(["share copy", readFileSync(flag("--share"), "utf8")]);
    const hits = texts.flatMap(([where, text]) => bannedHits(text, loaded?.brand).map((hit) => ({ where, ...hit })));
    console.log(JSON.stringify({ brand: loaded ? "found" : "none", problems, bannedHits: hits }, null, 2));
    process.exitCode = problems.length || hits.length ? 1 : 0;
  }
}
