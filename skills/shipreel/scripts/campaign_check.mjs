#!/usr/bin/env node
/**
 * Check a whole campaign before anything is posted: every piece, on every platform.
 *
 *   node <skill-root>/scripts/campaign_check.mjs <campaign-dir> [--claims claims.json] [--no-images]
 *
 * For each campaign/<platform>/<NN-angle>/ folder (written by content.mjs):
 *
 *   missing-file     (error)   a file post.json lists is not there (an unrendered video is a warning)
 *   too-long         (error)   the caption is over the platform's limit; each X post over 280 as X counts it
 *   title-too-long   (error)   a YouTube Shorts title over 100 characters
 *   hashtags         (error)   more hashtags than the platform's range; fewer is a warning
 *   alt-text         (error)   an image with no alt text
 *   uncited-claim    (error)   a number or superlative no claim covers (claims.mjs, line by line)
 *   deceptive        (error)   invented scarcity, urgency, social proof, or a quoted testimonial
 *   banned-word      (error)   generic filler (brand.mjs's list plus the brand kit's)
 *   same-angle       (error)   two pieces on one platform with the same angle or a near-identical hook
 *   em-dash          (warning) reads as generated copy
 *   image checks     (errors)  every rendered image through verify_image.mjs, unless --no-images
 *
 * Persuasive is the job; deceptive is a failure. Nothing here posts anything.
 */

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { hookOverlap } from "./angles.mjs";
import { bannedHits } from "./brand.mjs";
import { deceptiveHits } from "./brief.mjs";
import { findUncitedClaims } from "./claims.mjs";
import { PLATFORM_RULES } from "./content.mjs";
import { parseThread, xLength } from "./copy_check.mjs";
import { verifyCards } from "./verify_image.mjs";

const issue = (code, message) => ({ code, message });
const read = (dir, f) => (existsSync(path.join(dir, f)) ? readFileSync(path.join(dir, f), "utf8") : null);

/** Every check on one piece that needs no browser. Pure apart from reading `dir`. */
/** Everything a piece says in words: caption, thread, alt text and the text on its cards. */
export function pieceText(dir) {
  const strings = (v) => (typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === "object" ? Object.values(v).flatMap(strings) : []);
  let cards = [];
  try {
    cards = strings(JSON.parse(read(dir, "cards.json") ?? "null"));
  } catch {}
  return [read(dir, "caption.txt"), read(dir, "thread.txt"), read(dir, "alt.txt"), ...cards].filter(Boolean).join("\n");
}

export function checkPiece(dir, { claims = [], brand = null } = {}) {
  const errors = [], warnings = [];
  const meta = JSON.parse(read(dir, "post.json") ?? "null");
  if (!meta) return { errors: [issue("missing-file", "post.json is missing.")], warnings, meta: null };
  const rules = PLATFORM_RULES[meta.platform];

  for (const f of meta.files ?? []) {
    if (existsSync(path.join(dir, f))) continue;
    if (/\.(mp4|png|pdf)$/.test(f)) warnings.push(issue("not-rendered", `${f} has not been rendered yet.`));
    else errors.push(issue("missing-file", `${f} is listed in post.json but missing.`));
  }

  const caption = read(dir, "caption.txt");
  const thread = read(dir, "thread.txt");
  if (meta.platform === "x") {
    const posts = thread ? parseThread(thread) : caption ? [caption.trim()] : [];
    posts.forEach((p, i) => {
      if (xLength(p) > 280) errors.push(issue("too-long", `post ${i + 1} is ${xLength(p)} characters as X counts them; the limit is 280.`));
    });
  } else if (caption && caption.trim().length > rules.caption) {
    errors.push(issue("too-long", `the caption is ${caption.trim().length} characters; ${meta.platform} allows ${rules.caption}.`));
  }
  if (rules.title && (meta.title ?? "").length > rules.title) errors.push(issue("title-too-long", `the title is ${meta.title.length} characters; ${meta.platform} allows ${rules.title}.`));

  const tags = (read(dir, "hashtags.txt") ?? "").split(/\s+/).filter((t) => t.startsWith("#"));
  const [min, max] = rules.hashtags;
  if (tags.length > max) errors.push(issue("hashtags", `${tags.length} hashtags; ${meta.platform} works best with ${min} to ${max}.`));
  else if (tags.length < min) warnings.push(issue("hashtags", `${tags.length} hashtag(s); add the brief's hashtags to reach ${min} to ${max}.`));

  const alt = read(dir, "alt.txt") ?? "";
  for (const img of (meta.files ?? []).filter((f) => f.endsWith(".png"))) {
    if (!new RegExp(`^${img.replace(/\./g, "\\.")}: .{8,}`, "m").test(alt)) errors.push(issue("alt-text", `${img} has no alt text.`));
  }

  const text = [caption, thread, alt].filter(Boolean).join("\n");
  const seen = new Set();
  for (const line of text.split("\n")) {
    for (const phrase of findUncitedClaims(line, claims)) {
      if (seen.has(phrase)) continue;
      seen.add(phrase);
      errors.push(issue("uncited-claim", `"${phrase}" needs a claim in claims.json, or it comes out.`));
    }
  }
  for (const what of deceptiveHits(text)) errors.push(issue("deceptive", `the copy contains ${what}; persuasive, never deceptive.`));
  for (const hit of bannedHits(text, brand ?? {})) errors.push(issue("banned-word", `"${hit.phrase}" is generic filler; say what the project does.`));
  const dashes = (text.match(/—/g) ?? []).length;
  if (dashes) warnings.push(issue("em-dash", `${dashes} em dash${dashes > 1 ? "es" : ""}; use a full stop, comma, or colon.`));
  return { errors, warnings, meta };
}

/** Pieces on one platform that say the same thing: a repeated angle or a near-identical hook. */
export function sameAngles(metas) {
  const problems = [];
  for (let i = 0; i < metas.length; i++) {
    for (let j = i + 1; j < metas.length; j++) {
      const [a, b] = [metas[i], metas[j]];
      if (a.angle === b.angle) problems.push(issue("same-angle", `${a.piece} and ${b.piece} are both "${a.angle}".`));
      else if (hookOverlap(a.hook, b.hook) > 0.6) problems.push(issue("same-angle", `${a.piece} and ${b.piece} open with nearly the same hook.`));
    }
  }
  return problems;
}

const subdirs = (dir) => (existsSync(dir) ? readdirSync(dir).filter((d) => statSync(path.join(dir, d)).isDirectory()).sort() : []);

/**
 * Check every piece in a campaign directory. `skip` lists piece keys ("x/01-pain-hook") already posted:
 * they were checked when made and cannot change, so only their hooks still count against repeats.
 */
export async function checkCampaign(dir, { claims = [], brand = null, images = true, skip = [] } = {}) {
  const platforms = [];
  for (const platform of subdirs(dir).filter((d) => PLATFORM_RULES[d])) {
    const pieces = [];
    for (const piece of subdirs(path.join(dir, platform))) {
      const pdir = path.join(dir, platform, piece);
      if (skip.includes(`${platform}/${piece}`)) {
        pieces.push({ piece, errors: [], warnings: [], meta: JSON.parse(read(pdir, "post.json") ?? "null"), posted: true });
        continue;
      }
      const r = checkPiece(pdir, { claims, brand });
      if (images && existsSync(path.join(pdir, "cards.json"))) {
        const v = await verifyCards(pdir, { claims });
        for (const c of v.cards) for (const e of c.errors) r.errors.push(issue(e.code, `${c.file}: ${e.message}`));
      }
      pieces.push({ piece, ...r });
    }
    const metas = pieces.map((p) => p.meta).filter(Boolean);
    platforms.push({ platform, pieces, errors: sameAngles(metas) });
  }
  const ok = platforms.length > 0 && platforms.every((p) => p.errors.length === 0 && p.pieces.every((x) => x.errors.length === 0));
  return { ok, platforms };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const dir = path.resolve(args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--claims") ?? "shipreel-output/campaign");
  const claimsFile = args.includes("--claims") ? args[args.indexOf("--claims") + 1] : path.join(dir, "..", "claims.json");
  const claims = existsSync(claimsFile) ? JSON.parse(readFileSync(claimsFile, "utf8")) : [];
  checkCampaign(dir, { claims, images: !args.includes("--no-images") }).then(
    (report) => {
      for (const p of report.platforms) {
        console.log(p.platform);
        for (const e of p.errors) console.log(`  ✗ ${e.code}: ${e.message}`);
        for (const x of p.pieces) {
          console.log(`  ${x.errors.length ? "✗" : x.warnings.length ? "!" : "✓"} ${x.piece}`);
          for (const e of x.errors) console.log(`      ✗ ${e.code}: ${e.message}`);
          for (const w of x.warnings) console.log(`      ! ${w.code}: ${w.message}`);
        }
      }
      console.log(report.ok ? "✓ Campaign checked." : "✗ Fix the errors above before posting.");
      if (!report.ok) process.exitCode = 1;
    },
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}
