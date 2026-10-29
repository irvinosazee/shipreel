#!/usr/bin/env node
/**
 * Check launch copy against each platform's rules before anyone posts it.
 *
 *   node <skill-root>/scripts/copy_check.mjs <copy-dir> [--claims claims.json] [--project <project-dir>]
 *
 * Reads the files launch_kit.mjs writes (and showhn.txt when present) from <copy-dir>:
 *
 *   x-thread.txt     posts separated by a blank line before their "1/3" counter; each post is weighted
 *                    the way X counts it (every link is 23, emoji and CJK count 2) and must fit 280
 *   linkedin.txt     at most 3000 characters; warns when the hook is not in the first 210, the part
 *                    LinkedIn shows before "see more"
 *   showhn.txt       first line is the title: it must start "Show HN: " and fit 80 characters
 *   producthunt.txt  "Name:", "Tagline:" (60) and "Description:" (260)
 *   share-copy.txt   the plain caption: only the checks below
 *
 * Every file is also checked for generic filler (brand.mjs's banned words plus the brand kit's own),
 * numbers and superlatives no claim covers (claims.mjs, line by line), em dashes (a warning: they read
 * as generated copy), and more than three hashtags in a post.
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { bannedHits, loadBrand } from "./brand.mjs";
import { findUncitedClaims } from "./claims.mjs";

export const LIMITS = { x: 280, xUrl: 23, linkedin: 3000, linkedinFold: 210, showHnTitle: 80, phTagline: 60, phDescription: 260, hashtags: 3 };

// X counts most Latin text as 1 and CJK, emoji, and other wide characters as 2; every URL is 23 (t.co).
const URL = /\bhttps?:\/\/\S+|\b(?:[a-z0-9-]+\.)+(?:com|dev|io|app|me|org|net|co|lol|so|ai|sh)(?:\/\S*)?/gi;
const LIGHT = /[\u0000-ჿ -‍‐-‟′-‷]/;

/** The length X counts for a post. */
export function xLength(text) {
  let urls = 0;
  const rest = String(text).replace(URL, () => {
    urls += 1;
    return "";
  });
  let n = urls * LIMITS.xUrl;
  for (const ch of rest) n += LIGHT.test(ch) ? 1 : 2;
  return n;
}

const issue = (code, message) => ({ code, message });
const preview = (text) => `"${text.length > 48 ? `${text.slice(0, 48)}…` : text}"`;

/** Problems common to every platform: filler, uncited claims, em dashes, hashtag piles. */
export function checkCommon(text, { brand = null, claims = [] } = {}) {
  const errors = [], warnings = [];
  for (const hit of bannedHits(text, brand ?? {})) errors.push(issue("banned-word", `"${hit.phrase}" is generic filler (…${hit.context}…); say what the project actually does.`));
  const seen = new Set();
  for (const line of String(text).split(/\n+/)) {
    for (const phrase of findUncitedClaims(line, claims)) {
      if (seen.has(phrase)) continue;
      seen.add(phrase);
      errors.push(issue("uncited-claim", `"${phrase}" needs a claim in claims.json with its source, or it comes out.`));
    }
  }
  const dashes = (String(text).match(/—/g) ?? []).length;
  if (dashes) warnings.push(issue("em-dash", `${dashes} em dash${dashes > 1 ? "es" : ""}; they read as generated copy. Use a full stop, comma, or colon.`));
  return { errors, warnings };
}

/** X: each post weighted the way X counts it, with its counter. */
export function checkX(posts) {
  const errors = [], warnings = [];
  posts.forEach((post, i) => {
    const n = xLength(post);
    if (n > LIMITS.x) errors.push(issue("too-long", `post ${i + 1} is ${n} characters as X counts them (links are ${LIMITS.xUrl}); the limit is ${LIMITS.x}.`));
    const tags = (post.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length;
    if (tags > LIMITS.hashtags) warnings.push(issue("hashtags", `post ${i + 1} has ${tags} hashtags; more than ${LIMITS.hashtags} reads as spam.`));
  });
  if (!posts.length) errors.push(issue("empty", "the thread has no posts."));
  return { errors, warnings };
}

export function checkLinkedIn(text) {
  const errors = [], warnings = [];
  const t = String(text).trim();
  if (t.length > LIMITS.linkedin) errors.push(issue("too-long", `${t.length} characters; LinkedIn posts take at most ${LIMITS.linkedin}.`));
  const hook = t.split(/\n/)[0] ?? "";
  if (t.length > LIMITS.linkedinFold && hook.length > LIMITS.linkedinFold) warnings.push(issue("hook-below-fold", `the first line is ${hook.length} characters; LinkedIn shows about ${LIMITS.linkedinFold} before "see more", so lead with a shorter hook.`));
  const tags = (t.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length;
  if (tags > LIMITS.hashtags) warnings.push(issue("hashtags", `${tags} hashtags; ${LIMITS.hashtags} or fewer.`));
  if (!t) errors.push(issue("empty", "the post is empty."));
  return { errors, warnings };
}

export function checkShowHN({ title, body = "" }) {
  const errors = [], warnings = [];
  if (!/^Show HN: \S/.test(title ?? "")) errors.push(issue("show-hn-title", `the title must start with "Show HN: " (it is ${preview(title ?? "")}).`));
  if ((title ?? "").length > LIMITS.showHnTitle) errors.push(issue("too-long", `the title is ${title.length} characters; Hacker News allows ${LIMITS.showHnTitle}.`));
  if (/!/.test(title ?? "") || /\b[A-Z]{4,}\b/.test((title ?? "").replace(/^Show HN: /, ""))) warnings.push(issue("hn-tone", "exclamation marks and ALL CAPS in a Show HN title read as marketing; HN edits them out."));
  if (body && !/\bhttps?:\/\//.test(`${title} ${body}`)) warnings.push(issue("no-link", "there is no link to try the project."));
  return { errors, warnings };
}

export function checkProductHunt({ name, tagline, description }) {
  const errors = [];
  if (!name) errors.push(issue("empty", "no Name: line."));
  if (!tagline) errors.push(issue("empty", "no Tagline: line."));
  else if (tagline.length > LIMITS.phTagline) errors.push(issue("too-long", `the tagline is ${tagline.length} characters; Product Hunt allows ${LIMITS.phTagline}.`));
  if (description && description.length > LIMITS.phDescription) errors.push(issue("too-long", `the description is ${description.length} characters; Product Hunt allows ${LIMITS.phDescription}.`));
  return { errors, warnings: [] };
}

// ---------------------------------------------------------------- reading the copy files

/** x-thread.txt: posts begin with a "1/3" counter line; the counter is part of the post. */
export function parseThread(text) {
  return String(text).trim().split(/\n\s*\n(?=\d+\/\d+\s*\n)/).map((p) => p.trim()).filter(Boolean);
}

export function parseProductHunt(text) {
  const t = String(text);
  const line = (label) => t.match(new RegExp(`^${label}:[ \\t]*(.+)$`, "m"))?.[1].trim() ?? null;
  const description = t.match(/(?:^|\n)Description:[ \t]*\n([\s\S]*?)(?=\n\s*\n(?:Gallery|Topics|Thumbnail):|$(?![\s\S]))/)?.[1].trim() ?? null;
  return { name: line("Name"), tagline: line("Tagline"), description };
}

export function parseShowHN(text) {
  const [title = "", ...rest] = String(text).trim().split("\n");
  return { title: title.trim(), body: rest.join("\n").trim() };
}

const FILES = {
  "x-thread.txt": (t) => checkX(parseThread(t)),
  "linkedin.txt": (t) => checkLinkedIn(t),
  "showhn.txt": (t) => checkShowHN(parseShowHN(t)),
  "producthunt.txt": (t) => checkProductHunt(parseProductHunt(t)),
  "share-copy.txt": () => ({ errors: [], warnings: [] }),
};

/** Check every copy file present in a directory. */
export function checkCopyDir(dir, { claims = [], brand = null } = {}) {
  const files = [];
  for (const [name, platformCheck] of Object.entries(FILES)) {
    const file = path.join(dir, name);
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    const own = platformCheck(text);
    const common = checkCommon(text, { brand, claims });
    files.push({ file: name, errors: [...own.errors, ...common.errors], warnings: [...own.warnings, ...common.warnings] });
  }
  return { ok: files.length > 0 && files.every((f) => f.errors.length === 0), files };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const dir = path.resolve(args.find((a, i) => !a.startsWith("--") && !["--claims", "--project"].includes(args[i - 1])) ?? "shipreel-output/launch-kit/copy");
  const claimsFile = flag("--claims") ?? [path.join(dir, "..", "..", "claims.json"), path.join(dir, "..", "claims.json")].find(existsSync);
  const claims = claimsFile && existsSync(claimsFile) ? JSON.parse(readFileSync(claimsFile, "utf8")) : [];
  const brand = flag("--project") ? loadBrand(path.resolve(flag("--project")))?.brand ?? null : null;
  const report = checkCopyDir(dir, { claims, brand });
  if (!report.files.length) console.log(`No launch copy found in ${dir}.`);
  for (const f of report.files) {
    console.log(`${f.errors.length ? "✗" : f.warnings.length ? "!" : "✓"} ${f.file}`);
    for (const e of f.errors) console.log(`    ✗ ${e.code}: ${e.message}`);
    for (const w of f.warnings) console.log(`    ! ${w.code}: ${w.message}`);
  }
  console.log(report.ok ? "✓ Copy checked." : "✗ Fix the errors above before posting.");
  if (!report.ok) process.exitCode = 1;
}
