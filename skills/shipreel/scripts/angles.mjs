#!/usr/bin/env node
/**
 * Angles: 3 to 5 different pieces per platform, planned from the marketing brief (brief.mjs).
 *
 *   node <skill-root>/scripts/angles.mjs <output-dir> [--platforms tiktok,instagram,youtube-shorts,linkedin,x]
 *
 * Each platform gets the formats it rewards (TikTok vertical video, Instagram reels plus a carousel and a
 * story, LinkedIn a text post, a carousel and a feed video, X a thread and a video) and an angle per piece:
 * pain hook, before/after, demo, myth-buster, proof, build story, how-to, hot take. An angle is only planned
 * when the brief has what it needs (a myth-buster needs the workaround it busts, a build story needs git
 * history), and no two pieces on one platform share an angle or a near-identical hook.
 *
 * Every piece has a hook, beats (the lines a video or carousel shows, in order), and the call to action.
 * Hooks here are the floor; with an agent, /shipreel max rewrites them in the brief's tone and keeps the
 * same facts. Writes <output-dir>/angles.json.
 */

import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ANGLES } from "./brief.mjs";

// What each platform rewards, in the order pieces are planned. `kind` decides what gets generated.
export const PLATFORMS = {
  tiktok: { label: "TikTok", formats: [["video", "vertical"]], prefer: ["pain-hook", "before-after", "demo", "myth-buster", "hot-take", "build-story", "proof", "how-to"] },
  instagram: { label: "Instagram", formats: [["video", "vertical"], ["carousel", "feed"], ["story", "vertical"]], prefer: ["pain-hook", "proof", "how-to", "demo", "before-after", "build-story"] },
  "youtube-shorts": { label: "YouTube Shorts", formats: [["video", "vertical"]], prefer: ["demo", "how-to", "build-story", "pain-hook", "proof", "myth-buster"] },
  linkedin: { label: "LinkedIn", formats: [["post", "text"], ["carousel", "feed"], ["video", "feed"]], prefer: ["build-story", "proof", "before-after", "hot-take", "how-to", "demo"] },
  x: { label: "X", formats: [["thread", "text"], ["video", "landscape"], ["post", "text"]], prefer: ["hot-take", "demo", "proof", "build-story", "myth-buster", "pain-hook"] },
};
export const MIN_PER_PLATFORM = 3;
export const MAX_PER_PLATFORM = 5;

const v = (brief, key) => brief?.[key]?.value;
const strip = (t) => String(t ?? "").trim().replace(/[.!]+$/, "");
const lower1 = (t) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : t);

/** "They are stuck with X." becomes "Stuck with X?"; anything else is used as written. */
function painAsQuestion(pain) {
  // The first sentence is the hook; "They are stuck with X" becomes "Stuck with X?", anything else stays a statement.
  const first = strip(String(pain ?? "").match(/^[^.!?]*[.!?]?/)?.[0]);
  const m = first.match(/^(?:they|you) (?:are|re|'re) (.+)$/i);
  if (m) return `${m[1].charAt(0).toUpperCase()}${m[1].slice(1)}?`;
  return first ? `${first}${/[?!]$/.test(String(pain).trim().split(/(?<=[.!?])\s/)[0]) ? "" : "."}`.replace(/\.\.$/, ".") : null;
}

// Capitalise a line's first letter, except the product's own name: "shipreel" stays lowercase.
let productName = "";
// A command ("npx tidy init") is never capitalised either: it has to run as written.
const COMMAND = /^(npx|npm|pip|brew|cargo|go|uv|pnpm|yarn|bunx)\s/;
const cap1 = (t) => (!t || (productName && String(t).startsWith(productName)) || COMMAND.test(t) ? t : t.charAt(0).toUpperCase() + t.slice(1));
// Hooks end once: a question keeps its "?", anything else gets a full stop.
const end = (t) => cap1(/[?!.]$/.test(String(t).trim()) ? String(t).trim() : `${String(t).trim()}.`);
const firstQuestion = (t) => String(t ?? "").match(/^[^.!?]*\?/)?.[0] ?? null;

/** What an angle needs from the brief, and its hook and beats when the brief has it. */
function draft(id, brief, { story } = {}) {
  const product = brief.product;
  const promise = strip(v(brief, "promise"));
  const pain = painAsQuestion(v(brief, "pain"));
  const workaround = strip(v(brief, "workaround"));
  const proof = (v(brief, "proof") ?? []).map(strip).filter(Boolean);
  const cta = strip(v(brief, "cta"));
  const question = firstQuestion(v(brief, "promise"));
  const install = cta.match(/^try it:\s*(npx|npm|pip|brew|cargo|go|uv|pnpm|yarn|bunx)\b(.+)$/i) ? cta.replace(/^try it:\s*/i, "") : null;
  switch (id) {
    case "pain-hook": {
      const hook = pain ?? question;
      // The rest of the pain says why it hurts; the promise answers it.
      const rest = strip(String(v(brief, "pain") ?? "").replace(/^[^.!?]*[.!?]\s*/, "")) || null;
      return hook && { hook, beats: [hook, rest, promise, proof[0]].filter(Boolean) };
    }
    case "before-after": {
      const before = workaround || strip(v(brief, "pain"));
      return before && { hook: `Before: ${lower1(before)}. After: ${product}.`, beats: [`Before: ${before}`, `After: ${product}`, promise] };
    }
    case "demo":
      return { hook: `${product}, start to finish.`, beats: [`${product}, start to finish.`, promise, ...proof.slice(0, 1)] };
    case "myth-buster":
      return workaround && { hook: `You don't need ${lower1(workaround)}.`, beats: [`You don't need ${lower1(workaround)}.`, proof[0] ?? `${product}: ${lower1(promise)}`, proof[1]].filter(Boolean) };
    case "proof": {
      // Lead with a proof point that says something ("Money buys hearts. Hearts buy rank."), not a bare label.
      if (proof.length < 2) return null;
      const lead = proof.find((p) => p.split(/\s+/).length >= 5 && !p.includes("·")) ?? proof[0];
      return { hook: end(lead), beats: [lead, ...proof.filter((p) => p !== lead && !p.includes("·"))].slice(0, 4) };
    }
    case "build-story":
      // A build story is a hook only when it was fast; "built in 147 days" is true but nobody stops for it.
      return story?.commits && story.days <= 30 && { hook: `I built ${product} in ${story.days === 1 ? "a day" : `${story.days} days`}.`, beats: [`I built ${product} in ${story.days === 1 ? "a day" : `${story.days} days`}.`, `${story.commits} commits.`, story.contributors === 1 ? "One developer." : promise] };
    case "how-to":
      // Only with a real install command: "1. open the website" is not a how-to.
      return install && { hook: `${product} in one line.`, beats: [`${product} in one line.`, install, promise] };
    case "hot-take": {
      // "X prove nothing" reads right whether X is one thing or a list.
      const target = workaround || strip(String(v(brief, "pain") ?? "").match(/^[^.!?]*/)?.[0]);
      return target && { hook: `Hot take: ${lower1(target)} prove nothing.`, beats: [`Hot take: ${lower1(target)} prove nothing.`, `${product} settles it.`, promise || proof[0]].filter(Boolean) };
    }
    default:
      return null;
  }
}

const words = (t) => new Set(String(t).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 2));

/** Word overlap of two hooks, 0 to 1. Two pieces on one platform above 0.6 say the same thing. */
export function hookOverlap(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared += 1;
  return shared / Math.min(A.size, B.size);
}

/**
 * Beats that each add something: a beat that opens with the hook keeps only what follows it ("Who does X
 * love? A live table" after the hook "Who does X love?" becomes "A live table"), and a beat that repeats
 * the hook or an earlier beat is dropped. The hook stays first.
 */
export function distinctBeats(hook, beats) {
  const out = [hook];
  const h = strip(hook).replace(/[?.!]+$/, "").toLowerCase();
  for (let b of beats.filter(Boolean)) {
    b = String(b).trim();
    if (b.toLowerCase().startsWith(h) && b.length > h.length + 3) b = b.slice(h.length).replace(/^[\s?.!:,]+/, "");
    if (!b || out.some((o) => hookOverlap(o, b) > 0.6)) continue;
    out.push(b);
  }
  return out;
}

/** Plan the pieces for each platform. Pure. */
export function planAngles(brief, { story = null, platforms = Object.keys(PLATFORMS) } = {}) {
  productName = brief.product ?? "";
  const chosen = v(brief, "angles") ?? [];
  const cta = strip(v(brief, "cta"));
  const plan = {};
  const skipped = [];
  for (const platform of platforms) {
    const profile = PLATFORMS[platform];
    if (!profile) throw new Error(`Unknown platform "${platform}". Use: ${Object.keys(PLATFORMS).join(", ")}.`);
    // The brief's own angles first, in its order, then what this platform rewards.
    const order = [...chosen.filter((a) => profile.prefer.includes(a)), ...profile.prefer.filter((a) => !chosen.includes(a)), ...chosen.filter((a) => !profile.prefer.includes(a))];
    const pieces = [];
    for (const id of order) {
      if (pieces.length >= MAX_PER_PLATFORM) break;
      if (!ANGLES[id] || pieces.some((p) => p.angle === id)) continue;
      const d = draft(id, brief, { story });
      if (!d) {
        if (chosen.includes(id) && !skipped.some((s) => s.angle === id)) skipped.push({ platform: "all", angle: id, reason: "the brief has nothing for it yet" });
        continue;
      }
      if (pieces.some((p) => hookOverlap(p.hook, d.hook) > 0.6)) continue;
      const [kind, format] = profile.formats[pieces.length % profile.formats.length];
      pieces.push({ n: pieces.length + 1, id: `${String(pieces.length + 1).padStart(2, "0")}-${id}`, platform, angle: id, why: ANGLES[id], kind, format, hook: end(d.hook), beats: distinctBeats(d.hook, d.beats).map(cap1), cta });
    }
    plan[platform] = pieces;
    if (pieces.length < MIN_PER_PLATFORM) skipped.push({ platform, angle: null, reason: `only ${pieces.length} piece(s): fill in the brief's pain or workaround for more angles` });
  }
  return { plan, skipped };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const dir = path.resolve(args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--platforms") ?? "shipreel-output");
  const platforms = args.includes("--platforms") ? args[args.indexOf("--platforms") + 1].split(",") : undefined;
  try {
    const brief = JSON.parse(readFileSync(path.join(dir, "brief.json"), "utf8"));
    let story = null;
    try {
      story = JSON.parse(readFileSync(path.join(dir, "dossier.json"), "utf8")).story;
    } catch {
      // No dossier: no build-story angle.
    }
    const result = planAngles(brief, { story, platforms });
    writeFileSync(path.join(dir, "angles.json"), `${JSON.stringify(result, null, 2)}\n`);
    for (const [platform, pieces] of Object.entries(result.plan)) {
      console.log(`${PLATFORMS[platform].label}: ${pieces.length}`);
      for (const p of pieces) console.log(`  ${p.id.padEnd(16)} ${p.kind.padEnd(8)} ${p.hook}`);
    }
    for (const s of result.skipped) console.log(`  ! ${s.platform}${s.angle ? ` ${s.angle}` : ""}: ${s.reason}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
