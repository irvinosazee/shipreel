#!/usr/bin/env node
/**
 * `shipreel max`: the whole campaign, from the code you just shipped.
 *
 *   node <skill-root>/scripts/campaign.mjs <project-dir> [--out <output-dir>] [--platforms tiktok,instagram,...]
 *        [--brief-only] [--videos] [--no-images]
 *
 *   1. dossier    what the project is (dossier.mjs), with the run's scene stills when there is a video
 *   2. brief      brief.md, pre-filled and yours to edit; your edits survive every re-run (brief.mjs)
 *   3. angles     3 to 5 different pieces per platform (angles.mjs)
 *   4. content    campaign/<platform>/<NN-angle>/: caption, hashtags, alt text, post.json, and the images;
 *                 with --videos, each video piece rendered through the card-video engine (slow)
 *   5. calendar   campaign/calendar.md: what to post where, day by day, over two weeks
 *   6. upload     campaign/index.html: every piece with its caption, a copy button, and its files
 *   7. check      campaign_check.mjs over all of it; campaign/check.json
 *
 * --brief-only stops after step 2, so the brief can be edited before anything is made. A brief with
 * errors (unverified proof, deception, no call to action) stops the run. Nothing is posted anywhere.
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PLATFORMS, planAngles } from "./angles.mjs";
import { briefFacts, initBrief } from "./brief.mjs";
import { cardTheme, extractStills } from "./cards.mjs";
import { checkCampaign } from "./campaign_check.mjs";
import { fetchDisplayFont, PLATFORM_RULES, renderPieceCards, renderPieceVideo, writePiece } from "./content.mjs";
import { buildDossier } from "./dossier.mjs";

const escapeHtml = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/**
 * Two weeks of posts: each day takes the next unposted piece from up to three platforms, rotating
 * which platform leads, so no platform goes quiet and no day carries more than three posts.
 */
export function planCalendar(plan, { days = 14, perDay = 3 } = {}) {
  const queues = Object.entries(plan).map(([platform, pieces]) => ({ platform, pieces: [...pieces] }));
  const calendar = [];
  for (let day = 1; day <= days && queues.some((q) => q.pieces.length); day++) {
    const order = queues.slice((day - 1) % queues.length).concat(queues.slice(0, (day - 1) % queues.length)).filter((q) => q.pieces.length);
    const posts = order.slice(0, perDay).map((q) => {
      const p = q.pieces.shift();
      return { platform: q.platform, piece: p.id, hook: p.hook, kind: p.kind, window: PLATFORM_RULES[q.platform].window };
    });
    calendar.push({ day, posts });
  }
  return calendar;
}

export function calendarMarkdown(calendar, { product }) {
  const lines = [`# ${product}: two-week campaign`, "", "Post in this order. Times are the audience's local time. Reply to every comment in the first hour.", ""];
  for (const { day, posts } of calendar) {
    lines.push(`## Day ${day}`);
    for (const p of posts) lines.push(`- **${PLATFORMS[p.platform].label}** · ${p.kind} · \`${p.platform}/${p.piece}\` · ${p.window}`, `  "${p.hook}"`);
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}

/** campaign/index.html: every piece, its caption with a copy button, hashtags, and links to its files. */
export function uploadPage({ product, plan, dir }) {
  const read = (platform, p, f) => (existsSync(path.join(dir, platform, p.id, f)) ? readFileSync(path.join(dir, platform, p.id, f), "utf8").trim() : "");
  const sections = Object.entries(plan).map(([platform, pieces]) => {
    const cards = pieces.map((p, i) => {
      const meta = JSON.parse(read(platform, p, "post.json") || "{}");
      const text = read(platform, p, "thread.txt") || read(platform, p, "caption.txt");
      const files = (meta.files ?? []).filter((f) => existsSync(path.join(dir, platform, p.id, f)));
      const thumb = files.find((f) => /\.(png|jpg)$/.test(f));
      return `<article><header><b>${escapeHtml(p.id)}</b><span>${escapeHtml(p.kind)} · ${escapeHtml(meta.postingWindow ?? "")}</span></header>
${thumb ? `<img src="${platform}/${p.id}/${thumb}" alt="" loading="lazy">` : ""}
<pre id="c-${platform}-${i}">${escapeHtml(text)}</pre><button data-copy="c-${platform}-${i}">copy caption</button>
<p>${files.map((f) => `<a href="${platform}/${p.id}/${f}">${escapeHtml(f)}</a>`).join(" · ")}</p></article>`;
    });
    return `<section><h2>${escapeHtml(PLATFORMS[platform].label)}</h2><div class="grid">${cards.join("\n")}</div></section>`;
  });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(product)} campaign</title>
<style>body{margin:0;font:15px/1.5 system-ui,sans-serif;background:#111;color:#eee;padding:24px}h1{font-size:28px}h2{margin-top:40px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}article{background:#1c1c1c;border:1px solid #333;border-radius:12px;padding:14px}header{display:flex;justify-content:space-between;gap:8px;font-size:13px;color:#aaa}header b{color:#fff}img{width:100%;border-radius:8px;margin-top:10px}pre{white-space:pre-wrap;font:13px/1.45 ui-monospace,monospace;background:#0b0b0b;padding:10px;border-radius:8px;max-height:220px;overflow:auto}button{font:inherit;padding:6px 12px;border-radius:999px;border:1px solid #555;background:#222;color:#fff;cursor:pointer}a{color:#9cf}</style></head>
<body><h1>${escapeHtml(product)} campaign</h1><p>Nothing here has been posted. See <a href="calendar.md">calendar.md</a> for the order.</p>
${sections.join("\n")}
<script>document.querySelectorAll("[data-copy]").forEach((b)=>b.onclick=()=>{navigator.clipboard.writeText(document.getElementById(b.dataset.copy).textContent);b.textContent="copied";setTimeout(()=>b.textContent="copy caption",1200)});</script></body></html>
`;
}

/** Make the whole campaign. Returns the brief check, the plan, the calendar and the campaign check. */
export async function buildCampaign(projectDir, { outDir, platforms, briefOnly = false, videos = false, images = true, log = () => {} } = {}) {
  const dir = path.resolve(projectDir);
  const out = path.resolve(dir, outDir ?? "shipreel-output");
  mkdirSync(out, { recursive: true });
  extractStills(out);
  const dossier = buildDossier(dir, { outDir: out });
  writeFileSync(path.join(out, "dossier.json"), `${JSON.stringify(dossier, null, 2)}\n`);
  log("dossier ready");

  const { brief, check: briefCheck, files } = initBrief(dir, { outDir: out });
  log(`brief: ${files.md}`);
  if (briefOnly || !briefCheck.ok) return { brief, briefCheck, stopped: briefOnly ? "brief-only" : "brief has errors" };

  const { plan, skipped } = planAngles(brief, { story: dossier.story, platforms });
  writeFileSync(path.join(out, "angles.json"), `${JSON.stringify({ plan, skipped }, null, 2)}\n`);

  const campaignDir = path.join(out, "campaign");
  // Only the platforms being made are cleared: `--platforms x` must not wipe the TikTok pieces.
  for (const platform of Object.keys(plan)) rmSync(path.join(campaignDir, platform), { recursive: true, force: true });
  const theme = cardTheme(dossier.brand);
  const fontFile = videos ? await fetchDisplayFont(theme.display, path.join(out, ".fonts")) : null;
  for (const [platform, pieces] of Object.entries(plan)) {
    for (const piece of pieces) {
      const pdir = path.join(campaignDir, platform, piece.id);
      const { cards, video } = writePiece(piece, { dossier, brief, projectDir: dir, theme, dir: pdir });
      if (images) await renderPieceCards(piece, cards, { theme, projectDir: dir, dir: pdir });
      if (videos && video) {
        log(`rendering ${platform}/${piece.id}`);
        renderPieceVideo(video, { projectDir: dir, dir: pdir, fontFile, fontFamily: theme.display });
      }
    }
    log(`${platform}: ${pieces.length} piece(s)`);
  }

  const calendar = planCalendar(plan);
  writeFileSync(path.join(campaignDir, "calendar.md"), calendarMarkdown(calendar, { product: brief.product }));
  writeFileSync(path.join(campaignDir, "index.html"), uploadPage({ product: brief.product, plan, dir: campaignDir }));

  // Claims the campaign may make: the run's verified claims, plus the facts the brief's proof may cite.
  const claims = [...dossier.claims.filter((c) => c.verified), ...briefFacts(dossier).map((text) => ({ text }))];
  const check = await checkCampaign(campaignDir, { claims, brand: dossier.brand, images });
  writeFileSync(path.join(campaignDir, "check.json"), `${JSON.stringify(check, null, 2)}\n`);
  return { brief, briefCheck, plan, skipped, calendar, check, dir: campaignDir };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const projectDir = args.find((a, i) => !a.startsWith("--") && !["--out", "--platforms"].includes(args[i - 1])) ?? ".";
  buildCampaign(projectDir, {
    outDir: flag("--out"),
    platforms: flag("--platforms")?.split(","),
    briefOnly: args.includes("--brief-only"),
    videos: args.includes("--videos"),
    images: !args.includes("--no-images"),
    log: (m) => console.error(`shipreel: ${m}`),
  }).then(
    (r) => {
      for (const e of r.briefCheck.errors) console.log(`✗ brief ${e.code}: ${e.message}`);
      for (const w of r.briefCheck.warnings) console.log(`! brief ${w.code}: ${w.message}`);
      if (r.stopped) {
        console.log(r.stopped === "brief-only" ? "Edit brief.md, then run shipreel max again." : "Fix the brief, then run shipreel max again.");
        if (r.stopped !== "brief-only") process.exitCode = 1;
        return;
      }
      const count = Object.values(r.plan).flat().length;
      for (const [p, pieces] of Object.entries(r.plan)) console.log(`${PLATFORMS[p].label.padEnd(15)} ${pieces.map((x) => x.id).join("  ")}`);
      for (const s of r.skipped) console.log(`! ${s.platform}${s.angle ? ` ${s.angle}` : ""}: ${s.reason}`);
      const failing = r.check.platforms.flatMap((p) => [...p.errors.map((e) => `${p.platform}: ${e.message}`), ...p.pieces.flatMap((x) => x.errors.map((e) => `${p.platform}/${x.piece}: ${e.code}: ${e.message}`))]);
      for (const f of failing) console.log(`✗ ${f}`);
      console.log(`${count} pieces in ${path.relative(process.cwd(), r.dir)}/ (calendar.md, index.html)`);
      console.log(r.check.ok ? "✓ Campaign checked. Nothing has been posted." : "✗ Fix the errors above before posting.");
      if (!r.check.ok) process.exitCode = 1;
    },
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}
