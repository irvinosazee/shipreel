#!/usr/bin/env node
/**
 * `shipreel max update`: bring a running campaign up to date without touching what has gone out.
 *
 *   node <skill-root>/scripts/campaign_update.mjs <campaign-dir> --note "<what changed>"
 *        [--project <dir>] [--feedback <file>] [--day N | --posted key1,key2] [--plan-only] [--no-images]
 *
 *   1. position   where the user is: --day N (that day and every earlier day posted) or --posted keys,
 *                 written to posted.json; without either, posted.json as the desk saved it (ledger.mjs)
 *   2. scan       the dossier rebuilt from the code, and the git history since the campaign's commit
 *   3. validate   every point in the note and feedback.md checked against commits, claims and docs
 *                 (talking_points.mjs); unbacked points are reported and never written into a post
 *   4. plan       unposted pieces that are now wrong (a claim they use no longer verifies, or a backed
 *                 point is about the same thing) are rewritten; each backed change gets a new piece per
 *                 platform; posted pieces are never touched
 *   5. apply      (without --plan-only) rewrite, add, re-plan the calendar from the day after the current
 *                 one, write changes.md, rebuild the desk, run the campaign check
 */

import { existsSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PLATFORMS, planAngles, updatePiece } from "./angles.mjs";
import { initBrief } from "./brief.mjs";
import { cardTheme } from "./cards.mjs";
import { calendarMarkdown, campaignClaims, planCalendar } from "./campaign.mjs";
import { checkCampaign, pieceText } from "./campaign_check.mjs";
import { claimsUsed, verifyClaims } from "./claims.mjs";
import { PLATFORM_RULES, renderPieceCards, writePiece } from "./content.mjs";
import { parseCalendar, writeDesk } from "./desk.mjs";
import { buildDossier } from "./dossier.mjs";
import { postedThroughDay, readPosted, writePosted } from "./ledger.mjs";
import { parsePoints, topicWords, validatePoints } from "./talking_points.mjs";

const MAX_ADDED = 5;
const readJson = (file, fallback) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};

/** Where brief.md lives: the folder above a `campaign` folder, or the campaign folder itself (a copied campaign). */
const outDirFor = (campaignDir) => (path.basename(campaignDir) === "campaign" ? path.dirname(campaignDir) : campaignDir);

function pieceKeys(campaignDir) {
  const keys = [];
  for (const platform of readdirSync(campaignDir).filter((p) => PLATFORMS[p] && statSync(path.join(campaignDir, p)).isDirectory()).sort()) {
    for (const id of readdirSync(path.join(campaignDir, platform)).sort()) if (existsSync(path.join(campaignDir, platform, id, "post.json"))) keys.push(`${platform}/${id}`);
  }
  return keys;
}

const shared = (a, b) => a.filter((w) => b.includes(w));

/**
 * What an update would do, without changing anything. `posted` defaults to posted.json; `currentDay`
 * defaults to the last calendar day with a posted piece.
 */
export function planUpdate(campaignDir, { projectDir, note = "", feedback = null, posted = null, currentDay = null }) {
  const dir = path.resolve(campaignDir);
  const days = parseCalendar(existsSync(path.join(dir, "calendar.md")) ? readFileSync(path.join(dir, "calendar.md"), "utf8") : "").days;
  if (currentDay != null && posted == null) posted = postedThroughDay(days, currentDay);
  posted = [...new Set(posted ?? readPosted(dir).keys)].sort();
  if (currentDay == null) currentDay = Math.max(0, ...days.filter((d) => d.day != null && d.posts.some((k) => posted.includes(k))).map((d) => d.day));

  const saved = readJson(path.join(dir, "campaign.json"), {});
  const dossier = buildDossier(path.resolve(projectDir), { outDir: outDirFor(dir) });
  const current = campaignClaims(dossier);
  // The claims the campaign was checked against; a campaign from before 0.5 has none saved, so use today's.
  const snapshot = readJson(path.join(dir, "claims.json"), null) ?? dossier.claims;

  const feedbackMd = feedback ?? (existsSync(path.join(dir, "feedback.md")) ? readFileSync(path.join(dir, "feedback.md"), "utf8") : "");
  const points = validatePoints(parsePoints(note, feedbackMd), {
    projectDir: path.resolve(projectDir),
    since: saved.commit ?? null,
    sinceDate: saved.commit ? null : (saved.builtAt ?? null),
    claims: current,
  });
  const backed = points.filter((p) => p.backed);

  const all = pieceKeys(dir);
  const rewrite = [], followUps = [];
  for (const key of all) {
    const text = pieceText(path.join(dir, key));
    const words = topicWords(text);
    const about = backed.filter((p) => shared(topicWords(p.text), words).length >= 2);
    if (posted.includes(key)) {
      for (const p of about.filter((p) => p.kind === "change")) followUps.push({ key, point: p.text });
      continue;
    }
    // A sourced claim is re-checked against its file; a fact with no source (the git story, "1 day · 13 commits")
    // still holds only if today's dossier states it word for word.
    const now = new Set(current.map((c) => c.text));
    const broken = claimsUsed(text, snapshot).filter((c) => (c.source && c.quote ? verifyClaims([c], { projectDir: path.resolve(projectDir) }).verified === 0 : !now.has(c.text)));
    const why = [...broken.map((c) => `"${c.text}" no longer verifies`), ...about.map((p) => `about "${p.text}"`)];
    if (why.length) rewrite.push({ key, why: why.join("; "), broken: broken.map((c) => c.text) });
  }

  const platforms = [...new Set(all.map((k) => k.split("/")[0]))];
  const add = [];
  for (const p of backed.filter((p) => p.kind === "change")) for (const platform of platforms) if (add.length < MAX_ADDED) add.push({ platform, angle: "update", point: p.text });

  return {
    position: { currentDay, posted },
    points,
    keep: all.filter((k) => !rewrite.some((r) => r.key === k)),
    rewrite,
    add,
    followUps,
    feedback: backed.filter((p) => p.kind === "feedback"),
    unbacked: points.filter((p) => !p.backed).map((p) => p.text),
  };
}

/**
 * The brief to redraft from: a git-story fact that has moved on ("1 day · 1 commit") becomes today's line,
 * and any other claim that no longer verifies leaves the proof. brief.md itself is the user's and is not
 * edited; `stale` lists what it still says, for changes.md.
 */
export function freshBrief(brief, brokenTexts, storyNow) {
  const broken = [...new Set(brokenTexts)];
  if (!broken.length) return { brief, stale: [] };
  const story = (t) => /\bcommits?\b/.test(t) && t.includes("·");
  let json = JSON.stringify(brief);
  for (const t of broken.filter(story)) if (storyNow) json = json.split(t).join(storyNow);
  const next = JSON.parse(json);
  if (Array.isArray(next.proof?.value)) next.proof.value = next.proof.value.filter((line) => !broken.some((t) => !story(t) && String(line).includes(t)));
  return { brief: next, stale: broken.filter((t) => JSON.stringify(brief).includes(t)) };
}

function changesMarkdown(plan, { at, changed, stale = [] }) {
  const lines = [`# Campaign update, ${at.slice(0, 10)}`, "", `Posted so far: ${plan.position.posted.length} piece(s), through day ${plan.position.currentDay}. Posted pieces were not touched.`, ""];
  lines.push("## Talking points", "");
  for (const p of plan.points) lines.push(`- ${p.backed ? "Backed" : "Not backed, left out"}: ${p.text}${p.backed ? ` (${p.evidence.slice(0, 2).map((e) => `${e.kind} ${e.ref}`).join(", ")})` : ""}`);
  if (plan.unbacked.length) lines.push("", "To use a point that is not backed, add a claim for it to claims.json (a file and a quote from it) and run the update again.");
  lines.push("", "## Changed", "");
  for (const r of plan.rewrite) lines.push(`- Rewritten: \`${r.key}\`: ${r.why}`);
  for (const k of changed.filter((k) => k.endsWith("-update"))) lines.push(`- Added: \`${k}\``);
  if (!changed.length) lines.push("- Nothing.");
  if (plan.followUps.length) lines.push("", "## Already posted, now followed up", "", ...plan.followUps.map((f) => `- \`${f.key}\`: ${f.point}`));
  if (stale.length) lines.push("", "## brief.md is out of date", "", "These lines in brief.md no longer hold. The update wrote around them; edit brief.md so the next run does too.", "", ...stale.map((t) => `- ${t}`));
  if (plan.feedback.length) lines.push("", "## Feedback the repo answers", "", ...plan.feedback.map((p) => `- ${p.text} (${p.evidence[0].kind} ${p.evidence[0].ref}: "${p.evidence[0].line}")`));
  return `${lines.join("\n")}\n`;
}

/** Carry out a plan from planUpdate. Returns the keys it wrote and the campaign check. */
export async function applyUpdate(campaignDir, plan, { projectDir, images = true, log = () => {} }) {
  const dir = path.resolve(campaignDir);
  const project = path.resolve(projectDir);
  const posted = new Set(plan.position.posted);
  const at = new Date().toISOString();
  const outDir = outDirFor(dir);
  const dossier = buildDossier(project, { outDir });
  const { brief: userBrief } = initBrief(project, { outDir });
  const { brief, stale } = freshBrief(userBrief, plan.rewrite.flatMap((r) => r.broken ?? []), dossier.story?.line ?? null);
  const theme = cardTheme(dossier.brand);
  const changed = [];

  const write = async (piece, why) => {
    const pdir = path.join(dir, piece.platform, piece.id);
    rmSync(pdir, { recursive: true, force: true });
    const { cards } = writePiece(piece, { dossier, brief, projectDir: project, theme, dir: pdir });
    if (images) await renderPieceCards(piece, cards, { theme, projectDir: project, dir: pdir });
    const meta = readJson(path.join(pdir, "post.json"), {});
    writeFileSync(path.join(pdir, "post.json"), `${JSON.stringify({ ...meta, changed: { at, why } }, null, 2)}\n`);
    changed.push(`${piece.platform}/${piece.id}`);
    log(`${piece.platform}/${piece.id}: ${why}`);
  };

  // Rewrite: the same angle, drafted again from today's brief and dossier, in the same slot and format.
  for (const { key, why } of plan.rewrite) {
    if (posted.has(key)) continue; // never, whatever the plan says
    const [platform, id] = key.split("/");
    const old = readJson(path.join(dir, key, "post.json"), {});
    const fresh = planAngles(brief, { story: dossier.story, platforms: [platform] }).plan[platform].find((p) => p.angle === old.angle);
    if (!fresh) {
      log(`${key}: the brief no longer supports the ${old.angle} angle; left as it was`);
      continue;
    }
    await write({ ...fresh, id, n: Number(id.slice(0, 2)), kind: old.kind ?? fresh.kind, format: old.format ?? fresh.format }, why);
  }

  // Add: one piece per backed change and platform, numbered after the platform's last piece.
  for (const a of plan.add) {
    const taken = readdirSync(path.join(dir, a.platform)).map((id) => Number(id.slice(0, 2))).filter(Number.isFinite);
    await write(updatePiece(a.point, { brief, platform: a.platform, n: Math.max(0, ...taken) + 1 }), `new: ${a.point}`);
  }

  // Calendar: the days up to the current one keep only what was posted; everything else is planned from the day after.
  const days = parseCalendar(existsSync(path.join(dir, "calendar.md")) ? readFileSync(path.join(dir, "calendar.md"), "utf8") : "").days;
  const entry = (key) => {
    const [platform, piece] = key.split("/");
    const meta = readJson(path.join(dir, key, "post.json"), {});
    return { platform, piece, id: piece, hook: meta.hook ?? "", kind: meta.kind ?? "post", window: meta.postingWindow ?? PLATFORM_RULES[platform]?.window ?? "" };
  };
  const history = days.filter((d) => d.day != null && d.day <= plan.position.currentDay).map((d) => ({ day: d.day, posts: d.posts.filter((k) => posted.has(k)).map(entry) })).filter((d) => d.posts.length);
  const scheduled = days.flatMap((d) => d.posts);
  const left = [...scheduled, ...pieceKeys(dir).filter((k) => !scheduled.includes(k))].filter((k, i, all) => !posted.has(k) && all.indexOf(k) === i && existsSync(path.join(dir, k, "post.json")));
  // New pieces lead: they are the news.
  left.sort((a, b) => Number(b.endsWith("-update") && changed.includes(b)) - Number(a.endsWith("-update") && changed.includes(a)));
  const queue = {};
  for (const key of left) (queue[key.split("/")[0]] ??= []).push(entry(key));
  const lastPosted = Math.max(plan.position.currentDay, ...history.map((d) => d.day));
  const product = brief.product ?? readJson(path.join(dir, "campaign.json"), {}).product ?? "";
  writeFileSync(path.join(dir, "calendar.md"), calendarMarkdown([...history, ...planCalendar(queue, { startDay: lastPosted + 1 })], { product }));

  writeFileSync(path.join(dir, "changes.md"), changesMarkdown(plan, { at, changed, stale }));
  writeDesk(dir, { product, accent: theme.accent, onAccent: theme.onAccent });
  const check = await checkCampaign(dir, { claims: campaignClaims(dossier), brand: dossier.brand, images, skip: [...posted] });
  writeFileSync(path.join(dir, "check.json"), `${JSON.stringify(check, null, 2)}\n`);
  return { changed, check };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const valued = ["--note", "--project", "--feedback", "--day", "--posted"];
  const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
  const campaignDir = path.resolve(args.find((a, i) => !a.startsWith("--") && !valued.includes(args[i - 1])) ?? "shipreel-output/campaign");
  const projectDir = path.resolve(flag("--project") ?? ".");
  const feedbackFile = flag("--feedback");
  const days = parseCalendar(existsSync(path.join(campaignDir, "calendar.md")) ? readFileSync(path.join(campaignDir, "calendar.md"), "utf8") : "").days;
  let posted = null;
  if (flag("--day") != null) posted = postedThroughDay(days, Number(flag("--day")));
  if (flag("--posted") != null) posted = flag("--posted").split(",").map((k) => k.trim()).filter(Boolean);
  if (posted && !args.includes("--plan-only")) writePosted(campaignDir, posted);
  const plan = planUpdate(campaignDir, {
    projectDir,
    note: flag("--note") ?? "",
    feedback: feedbackFile ? readFileSync(feedbackFile, "utf8") : null,
    posted,
    currentDay: flag("--day") != null ? Number(flag("--day")) : null,
  });
  if (args.includes("--plan-only")) {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    const { changed, check } = await applyUpdate(campaignDir, plan, { projectDir, images: !args.includes("--no-images"), log: (m) => console.error(m) });
    console.log(JSON.stringify({ changed, unbacked: plan.unbacked, check: { ok: check.ok } }, null, 2));
    process.exitCode = check.ok ? 0 : 1;
  }
}
