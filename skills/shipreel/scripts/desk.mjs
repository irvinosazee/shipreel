#!/usr/bin/env node
/**
 * The posting desk: one page to post a campaign from, without opening a single file.
 *
 *   node <skill-root>/scripts/desk.mjs [campaign-dir] [--no-open]
 *
 * Writes <campaign-dir>/index.html (and campaign.json) and opens it. The page lists every piece in
 * the calendar's order; each piece shows its video or images, and every text it needs (title,
 * caption, each post of an X thread, hashtags, alt text per image, the link) as a block you click to
 * copy, with its length against the platform's limit. A tick marks a piece as posted; the browser
 * remembers it. The page needs no server: double-click it, or drop any campaign folder onto it.
 * Nothing is uploaded or posted anywhere.
 */

import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LABELS = { tiktok: "TikTok", instagram: "Instagram", "youtube-shorts": "YouTube Shorts", linkedin: "LinkedIn", x: "X" };
const read = (file) => (existsSync(file) ? readFileSync(file, "utf8").trim() : "");

/** "1/5\ntext\n\n2/5\ntext" into the posts, each with its counter, as they are posted. */
export function splitThread(text) {
  return String(text ?? "")
    .split(/\n\s*\n(?=\d+\/\d+\n)/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** alt.txt's "file: text" lines into [{ file, text }]. */
export function parseAlt(text) {
  return String(text ?? "")
    .split("\n")
    .map((line) => line.match(/^([\w.-]+\.(?:png|jpe?g|mp4)):\s*(.+)$/i))
    .filter(Boolean)
    .map((m) => ({ file: m[1], text: m[2].trim() }));
}

/** calendar.md into the product name and [{ day, posts: ["platform/piece", ...] }]. */
export function parseCalendar(md) {
  const product = String(md ?? "").match(/^# (.+?): two-week campaign/m)?.[1] ?? null;
  const days = [];
  for (const line of String(md ?? "").split("\n")) {
    const day = line.match(/^## Day (\d+)/);
    if (day) days.push({ day: Number(day[1]), posts: [] });
    const post = line.match(/`([a-z-]+\/\d\d-[a-z-]+)`/);
    if (post && days.length) days.at(-1).posts.push(post[1]);
  }
  return { product, days };
}

// Media first (video, then slides and frames in order, then the cover), so the preview leads with what gets posted.
const mediaRank = (f) => (/\.mp4$/.test(f) ? 0 : /^(slide|frame)-/.test(f) ? 1 : /^image\./.test(f) ? 2 : /^cover\./.test(f) ? 3 : 4);

/** One piece folder into everything the desk shows. Paths are relative to the campaign folder. */
export function readPiece(dir, platform, id) {
  const pdir = path.join(dir, platform, id);
  const meta = JSON.parse(read(path.join(pdir, "post.json")) || "{}");
  const files = readdirSync(pdir).filter((f) => statSync(path.join(pdir, f)).isFile());
  const media = files
    .filter((f) => /\.(mp4|png|jpe?g)$/i.test(f) && f !== "video-poster.jpg")
    .sort((a, b) => mediaRank(a) - mediaRank(b) || a.localeCompare(b))
    .map((f) => ({ file: f, type: f.endsWith(".mp4") ? "video" : "image", ...(f.endsWith(".mp4") && files.includes("video-poster.jpg") ? { poster: "video-poster.jpg" } : {}) }));
  const thread = read(path.join(pdir, "thread.txt"));
  return {
    key: `${platform}/${id}`,
    platform,
    label: LABELS[platform] ?? platform,
    id,
    kind: meta.kind ?? null,
    angle: meta.angle ?? null,
    why: meta.why ?? null,
    hook: meta.hook ?? null,
    title: meta.title ?? null,
    link: meta.link ?? null,
    window: meta.postingWindow ?? null,
    limits: meta.limits ?? {},
    caption: read(path.join(pdir, "caption.txt")) || null,
    thread: thread ? splitThread(thread) : null,
    hashtags: read(path.join(pdir, "hashtags.txt")).split(/\s+/).filter(Boolean).join(" ") || null,
    alts: parseAlt(read(path.join(pdir, "alt.txt"))),
    media,
    files: files.filter((f) => !["post.json", "cards.json", "content.json"].includes(f)),
    format: meta.format ?? null,
    // A still for the queue: the video's poster, else the first image.
    thumb: files.includes("video-poster.jpg") ? "video-poster.jpg" : (media.find((m) => m.type === "image")?.file ?? null),
  };
}

/** A whole campaign folder, in the calendar's order (pieces the calendar does not list come last). */
export function readCampaign(dir, { product = null, accent = null } = {}) {
  const saved = JSON.parse(read(path.join(dir, "campaign.json")) || "{}");
  const cal = parseCalendar(read(path.join(dir, "calendar.md")));
  const pieces = {};
  for (const platform of readdirSync(dir).filter((p) => statSync(path.join(dir, p)).isDirectory()).sort()) {
    for (const id of readdirSync(path.join(dir, platform)).sort()) {
      if (existsSync(path.join(dir, platform, id, "post.json"))) pieces[`${platform}/${id}`] = readPiece(dir, platform, id);
    }
  }
  const listed = new Set(cal.days.flatMap((d) => d.posts));
  const days = cal.days.map((d) => ({ ...d, posts: d.posts.filter((k) => pieces[k]) })).filter((d) => d.posts.length);
  const rest = Object.keys(pieces).filter((k) => !listed.has(k));
  if (rest.length) days.push({ day: null, posts: rest });
  return { product: product ?? cal.product ?? saved.product ?? path.basename(path.resolve(dir, "..", "..")), accent: accent ?? saved.accent ?? null, days, pieces };
}

const escapeHtml = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/**
 * The desk page. With `data`, the campaign is built in; without, the page waits for a dropped folder.
 * `look` picks the design: "night" (dark, dot field, device frames), "feed" (light, each piece as a
 * feed post), or "strip" (dark, one big preview, every piece as a thumbnail along the bottom).
 */
export function deskHtml(data = null, { look = "night" } = {}) {
  const title = data ? `${data.product} campaign` : "shipreel desk";
  const json = data ? JSON.stringify(data).replace(/</g, "\\u003c") : "null";
  return `<!doctype html>
<html lang="en" data-look="${escapeHtml(look)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@500;700;800;900&family=Hanken+Grotesk:wght@400;500;600;700&display=swap">
<style>
:root {
  --accent: #ff6134; --on-accent: #000;
  --head: "Geist", "Hanken Grotesk", system-ui, sans-serif;
  --body: "Hanken Grotesk", system-ui, sans-serif;
  --r-xl: 22px; --r-lg: 16px; --r-sm: 10px;
}
/* Night and strip: the dark desk. */
[data-look="night"], [data-look="strip"] {
  color-scheme: dark;
  --page: #08080a; --panel: rgba(22, 22, 27, 0.78); --solid: #16161b; --sunk: rgba(255, 255, 255, 0.05); --ink: #f4f4f6; --muted: #9b9ba6; --line: rgba(255, 255, 255, 0.09); --done: #4cc38a; --dot: 255, 255, 255;
}
/* Feed: daylight, the post as people will see it. */
[data-look="feed"] {
  color-scheme: light;
  --page: #eceef1; --panel: #ffffff; --solid: #ffffff; --sunk: #f4f5f7; --ink: #15171b; --muted: #5d636d; --line: #dde1e6; --done: #1f8a55; --dot: 0, 0, 0;
}
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body { background: var(--page); color: var(--ink); font: 15px/1.5 var(--body); -webkit-font-smoothing: antialiased; }
button { font: inherit; color: inherit; }
/* Panels scroll without a visible bar: wheel, trackpad, touch and keys all still work. */
.queue, .copy, .stage, .media, .post .slides { scrollbar-width: none; -ms-overflow-style: none; }
.queue::-webkit-scrollbar, .copy::-webkit-scrollbar, .stage::-webkit-scrollbar, .media::-webkit-scrollbar, .post .slides::-webkit-scrollbar { display: none; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
#field { position: fixed; inset: 0; width: 100%; height: 100%; z-index: 0; pointer-events: none; }
[data-look="feed"] #field { display: none; }
#root { position: relative; z-index: 1; }

/* ---------- shared pieces ---------- */
.bar { display: flex; align-items: center; gap: 16px; }
.brand { display: flex; align-items: center; gap: 10px; }
.brand .mark { width: 28px; height: 28px; border-radius: 9px; background: var(--accent); color: var(--on-accent); display: grid; place-items: center; font: 900 15px var(--head); }
.brand h1 { margin: 0; font: 800 17px/1 var(--head); letter-spacing: -0.02em; }
.brand h1 span { color: var(--muted); font-weight: 500; }
.progress { display: flex; align-items: center; gap: 10px; margin-left: auto; color: var(--muted); font-variant-numeric: tabular-nums; font-size: 14px; }
.ring { width: 22px; height: 22px; }
.ring circle { fill: none; stroke-width: 3; }
.ring .track { stroke: var(--line); }
.ring .fill { stroke: var(--done); stroke-linecap: round; transform: rotate(-90deg); transform-origin: center; transition: stroke-dashoffset .4s; }
.pill-btn { border: 1px solid var(--line); background: var(--sunk); border-radius: 999px; padding: 7px 14px; cursor: pointer; font-size: 14px; }
.pill-btn:hover { border-color: var(--muted); }
.filters { display: flex; flex-wrap: wrap; gap: 6px; }
.filters button { border: 1px solid var(--line); background: transparent; border-radius: 999px; padding: 4px 11px; font-size: 13px; cursor: pointer; color: var(--muted); }
.filters button[aria-pressed="true"] { background: var(--ink); color: var(--page); border-color: var(--ink); }
.day { font: 700 12px var(--head); letter-spacing: 0.02em; color: var(--muted); }
.item { display: grid; grid-template-columns: 44px 1fr 16px; gap: 12px; align-items: center; width: 100%; text-align: left; border: 0; background: transparent; padding: 8px 10px; border-radius: 12px; cursor: pointer; }
.item:hover { background: var(--sunk); }
.item[aria-current="true"] { background: var(--sunk); box-shadow: inset 0 0 0 1px var(--line); }
.item .thumb { width: 44px; height: 44px; border-radius: 9px; object-fit: cover; background: var(--sunk); display: block; }
.item .thumb.none { display: grid; place-items: center; color: var(--muted); font: 800 13px var(--head); }
.item .plat { display: block; font-size: 12px; color: var(--muted); }
.item .hook { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-weight: 600; font-size: 14px; line-height: 1.35; }
.item .tick { width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--line); }
.item.posted .tick { background: var(--done); border-color: var(--done); }
.item.posted .hook { color: var(--muted); text-decoration: line-through; text-decoration-color: var(--line); }

.head { display: flex; align-items: flex-start; gap: 14px; }
.head h2 { margin: 0; flex: 1; font: 800 26px/1.15 var(--head); letter-spacing: -0.025em; text-wrap: balance; }
.meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.chip { font-size: 12.5px; color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 2px 10px; }
.chip.plat { color: var(--ink); }
.posted-toggle { display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--line); border-radius: 999px; padding: 8px 15px; background: var(--sunk); cursor: pointer; white-space: nowrap; font-weight: 600; font-size: 14px; }
.posted-toggle::before { content: ""; width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--muted); }
.posted-toggle[aria-pressed="true"] { background: var(--done); border-color: var(--done); color: #fff; }
.posted-toggle[aria-pressed="true"]::before { border-color: #fff; background: #fff; }

.slab { position: relative; display: block; width: 100%; text-align: left; cursor: copy; border: 1px solid var(--line); border-radius: var(--r-lg); background: var(--solid); padding: 14px 16px 16px; overflow: hidden; transition: border-color .15s, transform .15s; }
.slab:hover { border-color: var(--muted); }
.slab:active { transform: scale(.995); }
.slab .label { position: relative; z-index: 1; display: flex; justify-content: space-between; align-items: center; gap: 12px; font-size: 12.5px; color: var(--muted); margin-bottom: 8px; }
.slab .label b { font: 700 13px var(--head); color: var(--ink); letter-spacing: -0.01em; }
.slab .label .right { display: flex; gap: 10px; align-items: center; }
.slab .count { font-variant-numeric: tabular-nums; }
.slab .count.over { color: #ff5a4f; font-weight: 700; }
.slab .said { border: 1px solid var(--line); border-radius: 999px; padding: 1px 9px; }
.slab .text { position: relative; z-index: 1; white-space: pre-wrap; overflow-wrap: anywhere; max-width: 70ch; font-size: 15px; }
/* The one motion that answers you: a copy sweeps the block in the campaign's colour. */
.slab::before { content: ""; position: absolute; inset: 0; background: var(--accent); transform: scaleX(0); transform-origin: left; }
.slab.copied::before { animation: sweep .75s cubic-bezier(.2,.7,.2,1); }
.slab.copied .label, .slab.copied .label b, .slab.copied .text { color: var(--on-accent); }
.slab.copied .said { border-color: currentColor; }
@keyframes sweep { 0% { transform: scaleX(0); opacity: 1; } 40% { transform: scaleX(1); opacity: 1; } 100% { transform: scaleX(1); opacity: 0; } }
.group { display: flex; flex-direction: column; gap: 8px; }
/* Copy blocks keep their full height; the column scrolls instead. */
.copy > *, .group > *, .stage > * { flex-shrink: 0; }
.group > h3 { margin: 8px 0 0; font: 700 13px var(--head); color: var(--muted); letter-spacing: 0.01em; }
.keys { color: var(--muted); font-size: 12.5px; padding-top: 6px; }
kbd { font: 600 11.5px var(--body); border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 6px; padding: 1px 6px; color: var(--ink); }

.media { display: flex; gap: 16px; overflow-x: auto; padding: 4px 4px 10px; scroll-snap-type: x mandatory; align-items: flex-start; }
.media figure { margin: 0; flex: 0 0 auto; scroll-snap-align: start; display: flex; flex-direction: column; gap: 8px; }
.media figcaption { display: flex; justify-content: space-between; gap: 10px; font-size: 12.5px; color: var(--muted); padding: 0 6px; }
.media figcaption a { color: var(--ink); text-decoration: none; border-bottom: 1px solid var(--line); }
.frame { overflow: hidden; background: #000; }
.frame video, .frame img { display: block; width: 100%; height: 100%; object-fit: contain; }
/* Device frames: a phone for vertical, a soft screen for the rest. */
.frame.portrait { height: min(66vh, 640px); aspect-ratio: 9 / 16; border-radius: 34px; border: 9px solid #000; box-shadow: 0 0 0 1px rgba(255,255,255,.12), 0 30px 80px -30px rgba(0,0,0,.7); }
.media figure:has(.landscape) { flex: 0 0 100%; max-width: 640px; }
.frame.landscape { width: 100%; aspect-ratio: 16 / 9; border-radius: 14px; box-shadow: 0 0 0 1px var(--line), 0 30px 80px -30px rgba(0,0,0,.6); }
.frame.square { height: min(52vh, 480px); aspect-ratio: 4 / 5; border-radius: 14px; box-shadow: 0 0 0 1px var(--line), 0 30px 80px -30px rgba(0,0,0,.6); }
.frame.square.sq1 { aspect-ratio: 1; }
.why { color: var(--muted); max-width: 62ch; margin: 0; font-size: 14px; }
.why b { color: var(--ink); font-weight: 600; }

/* ---------- night: three panes on the dot field ---------- */
[data-look="night"] .app { display: grid; grid-template-columns: 320px minmax(0, 1fr) minmax(380px, 0.95fr); grid-template-rows: auto minmax(0, 1fr); height: 100vh; gap: 14px; padding: 14px; }
[data-look="night"] .bar { grid-column: 1 / -1; justify-self: center; width: min(100%, 980px); padding: 8px 8px 8px 14px; border: 1px solid var(--line); border-radius: 999px; background: var(--panel); backdrop-filter: blur(14px); }
[data-look="night"] .queue, [data-look="night"] .copy { background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-xl); backdrop-filter: blur(14px); overflow: auto; }
[data-look="night"] .queue { padding: 14px 10px; display: flex; flex-direction: column; gap: 4px; }
[data-look="night"] .queue .filters { padding: 0 6px 10px; }
[data-look="night"] .queue .day { padding: 12px 10px 4px; }
[data-look="night"] .stage { overflow: auto; display: flex; flex-direction: column; justify-content: center; gap: 18px; padding: 10px; }
[data-look="night"] .stage .media { justify-content: safe center; }
[data-look="night"] .copy { padding: 22px; display: flex; flex-direction: column; gap: 12px; }

/* ---------- feed: the post as it will look ---------- */
[data-look="feed"] .app { display: grid; grid-template-columns: 300px minmax(0, 1fr) minmax(380px, 1fr); grid-template-rows: auto minmax(0, 1fr); height: 100vh; }
[data-look="feed"] .bar { grid-column: 1 / -1; padding: 12px 20px; background: var(--panel); border-bottom: 1px solid var(--line); }
[data-look="feed"] .queue { overflow: auto; background: var(--panel); border-right: 1px solid var(--line); padding: 12px 10px; display: flex; flex-direction: column; gap: 4px; }
[data-look="feed"] .queue .filters { padding: 0 6px 10px; }
[data-look="feed"] .queue .day { padding: 12px 10px 4px; }
[data-look="feed"] .stage { overflow: auto; padding: 28px; display: flex; justify-content: center; align-items: flex-start; }
[data-look="feed"] .copy { overflow: auto; padding: 24px; display: flex; flex-direction: column; gap: 12px; border-left: 1px solid var(--line); background: var(--page); }
.post { width: 100%; background: var(--panel); border: 1px solid var(--line); border-radius: 18px; overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,.04), 0 18px 40px -24px rgba(0,0,0,.25); }
.post header { display: flex; align-items: center; gap: 10px; padding: 12px 14px; }
.post .avatar { width: 36px; height: 36px; border-radius: 50%; background: var(--accent); color: var(--on-accent); display: grid; place-items: center; font: 900 15px var(--head); }
.post .who b { display: block; font-weight: 700; font-size: 14px; line-height: 1.2; }
.post .who span { color: var(--muted); font-size: 12.5px; }
.post .slides { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; background: #000; }
.post .slides > * { flex: 0 0 100%; scroll-snap-align: start; }
.post .slides video, .post .slides img { display: block; width: 100%; max-height: 70vh; object-fit: contain; background: #000; }
.post .body { padding: 12px 14px 14px; white-space: pre-wrap; font-size: 14.5px; }
.post .body .more { color: var(--muted); }
.post .dots { display: flex; gap: 5px; justify-content: center; padding-top: 10px; }
.post .dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--line); }
.post .dots i:first-child { background: var(--accent); }
.post .files { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 14px 14px; font-size: 12.5px; }
.post .files a { color: var(--muted); text-decoration: none; border: 1px solid var(--line); border-radius: 999px; padding: 2px 10px; }
.post .files a:hover { color: var(--ink); }
.feed-col { width: min(100%, 470px); }
.feed-why { margin: 14px 0 0; }

/* ---------- strip: one big preview, the campaign along the bottom ---------- */
[data-look="strip"] .app { display: grid; grid-template-columns: minmax(0, 1fr) minmax(400px, 0.85fr); grid-template-rows: auto minmax(0, 1fr) auto; height: 100vh; gap: 0; }
[data-look="strip"] .bar { grid-column: 1 / -1; grid-row: 1; padding: 16px 24px; }
[data-look="strip"] .stage { grid-column: 1; grid-row: 2; overflow: auto; display: flex; flex-direction: column; justify-content: center; gap: 18px; padding: 8px 24px 20px; }
[data-look="strip"] .stage .media { justify-content: safe center; }
[data-look="strip"] .copy { grid-column: 2; grid-row: 2; overflow: auto; padding: 8px 24px 20px 8px; display: flex; flex-direction: column; gap: 12px; }
[data-look="strip"] .queue { grid-column: 1 / -1; grid-row: 3; display: flex; gap: 22px; overflow-x: auto; padding: 14px 24px 18px; border-top: 1px solid var(--line); background: var(--panel); backdrop-filter: blur(14px); align-items: flex-start; }
[data-look="strip"] .queue .filters { flex-direction: column; flex-wrap: nowrap; min-width: max-content; }
[data-look="strip"] .daycol { display: flex; flex-direction: column; gap: 8px; }
[data-look="strip"] .daycol .row { display: flex; gap: 8px; }
[data-look="strip"] .item { display: block; width: 92px; padding: 0; border-radius: 12px; position: relative; }
[data-look="strip"] .item:hover, [data-look="strip"] .item[aria-current="true"] { background: transparent; box-shadow: none; }
[data-look="strip"] .item .thumb { width: 92px; height: 116px; border-radius: 12px; border: 2px solid transparent; }
[data-look="strip"] .item[aria-current="true"] .thumb { border-color: var(--accent); }
[data-look="strip"] .item .plat { margin-top: 5px; font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
[data-look="strip"] .item .hook { display: none; }
[data-look="strip"] .item .tick { position: absolute; top: 6px; right: 6px; background: rgba(0,0,0,.45); border-color: rgba(255,255,255,.6); }
[data-look="strip"] .item.posted .thumb { opacity: .45; }
[data-look="strip"] .item.posted .tick { background: var(--done); border-color: var(--done); }

/* ---------- empty state ---------- */
.empty { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
.dropzone { max-width: 540px; width: 100%; border: 1.5px dashed var(--line); border-radius: 28px; padding: 56px 36px; text-align: center; background: var(--panel); backdrop-filter: blur(14px); }
.dropzone .mark { width: 52px; height: 52px; margin: 0 auto 18px; border-radius: 16px; background: var(--accent); color: var(--on-accent); display: grid; place-items: center; font: 900 24px var(--head); }
.dropzone h2 { margin: 0 0 8px; font: 800 28px/1.1 var(--head); letter-spacing: -0.025em; }
.dropzone p { margin: 0 auto 22px; color: var(--muted); max-width: 40ch; }
.dropzone label { display: inline-block; background: var(--ink); color: var(--page); border-radius: 999px; padding: 10px 20px; cursor: pointer; font-weight: 700; }
body.dragging .dropzone { border-color: var(--accent); }
body.dragging .app { outline: 2px solid var(--accent); outline-offset: -8px; border-radius: 24px; }
.err { color: #ff5a4f; margin-top: 14px; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }

/* ---------- small screens: one column, in reading order ---------- */
@media (max-width: 1000px) {
  [data-look] .app { display: flex; flex-direction: column; height: auto; gap: 12px; padding: 12px; }
  [data-look] .bar { width: 100%; border-radius: 22px; flex-wrap: wrap; }
  [data-look] .queue { max-height: 46vh; overflow: auto; border-radius: var(--r-xl); }
  [data-look="strip"] .queue { order: 1; max-height: none; }
  [data-look] .copy { order: 3; padding: 16px; border-left: 0; }
  [data-look] .stage { order: 2; padding: 0; }
  [data-look="feed"] .stage { padding: 0; }
  .frame.portrait { height: min(70vh, 560px); }
  .frame.landscape { width: calc(100vw - 48px); }
  .progress .label-long { display: none; }
}
@media (prefers-reduced-motion: reduce) { .slab.copied::before { animation-duration: .01s; } .ring .fill { transition: none; } }
</style>
</head>
<body>
<canvas id="field" aria-hidden="true"></canvas>
<div id="root"></div>
<input type="file" id="pick" webkitdirectory multiple class="sr" aria-hidden="true" tabindex="-1">
<script id="campaign" type="application/json">${json}</script>
<script>
"use strict";
const $ = (s, el = document) => el.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const svg = ["svg", "circle"].includes(tag);
  const el = svg ? document.createElementNS("http://www.w3.org/2000/svg", tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
};
const look = () => document.documentElement.dataset.look;

let data = JSON.parse($("#campaign").textContent);
let urlOf = (key, file) => key + "/" + file;
let current = null;
let filter = "all";

// The browser remembers what is posted; private windows may refuse, and the page still works.
const store = {
  key: (k) => "shipreel-desk:" + data.product + ":" + k,
  get(k) { try { return localStorage.getItem(this.key(k)) === "1"; } catch { return false; } },
  set(k, v) { try { v ? localStorage.setItem(this.key(k), "1") : localStorage.removeItem(this.key(k)); } catch {} },
};

// X counts a link as 23 and an emoji as 2.
const xLength = (t) => [...String(t).replace(/https?:\\/\\/\\S+/g, "x".repeat(23))].reduce((n, c) => n + (/\\p{Extended_Pictographic}/u.test(c) ? 2 : 1), 0);

async function copy(text, slab) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = h("textarea", { class: "sr" }); ta.value = text; document.body.append(ta); ta.select();
    document.execCommand("copy"); ta.remove();
  }
  slab.classList.remove("copied"); void slab.offsetWidth; slab.classList.add("copied");
  const said = slab.querySelector(".said"); if (said) { said.textContent = "Copied"; setTimeout(() => (said.textContent = "Copy"), 1400); }
}

function slab(label, text, { limit = null, count = null } = {}) {
  if (!text) return null;
  const n = count ? count(text) : [...text].length;
  const el = h("button", { class: "slab", type: "button", "aria-label": "Copy " + label },
    h("span", { class: "label" }, h("b", {}, label),
      h("span", { class: "right" }, limit ? h("span", { class: "count" + (n > limit ? " over" : "") }, n + " of " + limit) : null, h("span", { class: "said" }, "Copy"))),
    h("span", { class: "text" }, text));
  el.addEventListener("click", () => copy(text, el));
  return el;
}

const keys = () => data.days.flatMap((d) => d.posts).filter((k) => filter === "all" || data.pieces[k].platform === filter);
const select = (k) => { current = k; render(); };

// Fit a frame to its media once its size is known: a phone for vertical, a screen for wide.
function fit(frame, w, h) {
  if (!w || !h) return;
  frame.classList.remove("portrait", "landscape", "square", "sq1");
  frame.classList.add(h > w * 1.2 ? "portrait" : w > h * 1.2 ? "landscape" : "square");
  if (Math.abs(w - h) < 8) frame.classList.add("sq1");
}
function mediaEl(p, m, alt) {
  const src = urlOf(p.key, m.file);
  if (m.type === "video") {
    const v = h("video", { src, poster: m.poster ? urlOf(p.key, m.poster) : null, controls: true, playsinline: true, preload: "metadata" });
    return v;
  }
  return h("img", { src, alt: alt || "", loading: "lazy" });
}
function framed(p, m, alt) {
  const el = mediaEl(p, m, alt);
  const frame = h("div", { class: "frame " + (p.format === "vertical" ? "portrait" : p.format === "landscape" ? "landscape" : "square") }, el);
  if (m.type === "video") el.addEventListener("loadedmetadata", () => fit(frame, el.videoWidth, el.videoHeight));
  else el.addEventListener("load", () => fit(frame, el.naturalWidth, el.naturalHeight));
  return frame;
}

function ring(done, all) {
  const r = 8.5, c = 2 * Math.PI * r;
  return h("svg", { class: "ring", viewBox: "0 0 22 22", "aria-hidden": "true" },
    h("circle", { class: "track", cx: 11, cy: 11, r }),
    h("circle", { class: "fill", cx: 11, cy: 11, r, "stroke-dasharray": c, "stroke-dashoffset": all ? c * (1 - done / all) : c }));
}

function queueItem(k) {
  const p = data.pieces[k];
  const thumb = p.thumb ? h("img", { class: "thumb", src: urlOf(p.key, p.thumb), alt: "", loading: "lazy" }) : h("span", { class: "thumb none" }, p.label.slice(0, 2));
  return h("button", { class: "item" + (store.get(k) ? " posted" : ""), type: "button", "aria-current": String(k === current), title: p.hook || p.id, onclick: () => select(k) },
    thumb,
    h("span", {}, h("span", { class: "plat" }, p.label + ", " + p.kind), h("span", { class: "hook" }, p.hook || p.id)),
    h("span", { class: "tick", "aria-label": store.get(k) ? "posted" : "not posted" }));
}

function feedPost(p) {
  const text = p.thread ? p.thread[0].replace(/^\\d+\\/\\d+\\n/, "") : p.caption || p.hook || "";
  const cut = text.length > 180 ? text.slice(0, 180).replace(/\\s+\\S*$/, "") : null;
  const visual = p.media.filter((m) => m.file !== "cover.png" || p.media.length === 1);
  return h("article", { class: "post" },
    h("header", {}, h("span", { class: "avatar" }, data.product.charAt(0).toUpperCase()),
      h("span", { class: "who" }, h("b", {}, data.product), h("span", {}, p.label + " preview"))),
    p.platform === "linkedin" || p.platform === "x" ? h("div", { class: "body" }, cut ? [cut, h("span", { class: "more" }, " ...more")] : text) : null,
    visual.length ? h("div", { class: "slides" }, visual.map((m) => mediaEl(p, m, p.alts.find((a) => a.file === m.file)?.text))) : null,
    visual.length > 1 ? h("div", { class: "dots" }, visual.map(() => h("i"))) : null,
    p.platform !== "linkedin" && p.platform !== "x" ? h("div", { class: "body" }, cut ? [cut, h("span", { class: "more" }, " ...more")] : text) : null,
    h("div", { class: "files" }, p.media.map((m) => h("a", { href: urlOf(p.key, m.file), download: p.platform + "-" + p.id + "-" + m.file }, "Download " + m.file))));
}

function render() {
  const root = $("#root");
  root.replaceChildren();
  if (!data) return root.append(emptyState());
  document.title = data.product + " campaign";
  if (data.accent) document.documentElement.style.setProperty("--accent", data.accent);
  if (data.onAccent) document.documentElement.style.setProperty("--on-accent", data.onAccent);
  if (!current || !data.pieces[current]) current = keys()[0];
  const all = data.days.flatMap((d) => d.posts);
  const done = all.filter((k) => store.get(k)).length;
  const platforms = [...new Set(all.map((k) => data.pieces[k].platform))];
  const labelOf = (pl) => data.pieces[all.find((k) => data.pieces[k].platform === pl)].label;

  const bar = h("header", { class: "bar" },
    h("div", { class: "brand" }, h("span", { class: "mark", "aria-hidden": "true" }, data.product.charAt(0).toUpperCase()),
      h("h1", {}, data.product, h("span", {}, " campaign"))),
    h("span", { class: "progress" }, ring(done, all.length), h("span", {}, done + " of " + all.length, h("span", { class: "label-long" }, " posted"))),
    h("button", { class: "pill-btn", type: "button", onclick: () => $("#pick").click() }, "Open another folder"));

  const filters = h("div", { class: "filters" }, ["all", ...platforms].map((pl) =>
    h("button", { type: "button", "aria-pressed": String(filter === pl), onclick: () => { filter = pl; current = keys()[0]; render(); } }, pl === "all" ? "All" : labelOf(pl))));
  const days = data.days.map((d) => {
    const posts = d.posts.filter((k) => filter === "all" || data.pieces[k].platform === filter);
    if (!posts.length) return null;
    const label = h("div", { class: "day" }, d.day ? "Day " + d.day : "Not on the calendar");
    return look() === "strip" ? h("div", { class: "daycol" }, label, h("div", { class: "row" }, posts.map(queueItem))) : [label, posts.map(queueItem)];
  });
  const queue = h("nav", { class: "queue", "aria-label": "Posting order" }, filters, days);

  const p = data.pieces[current];
  const why = p.why ? h("p", { class: look() === "feed" ? "why feed-why" : "why" }, h("b", {}, "Why this piece: "), p.why) : null;
  const stage = look() === "feed"
    ? h("main", { class: "stage" }, h("div", { class: "feed-col" }, feedPost(p), why))
    : h("main", { class: "stage" },
        h("div", { class: "media" }, p.media.map((m) => h("figure", {}, framed(p, m, p.alts.find((a) => a.file === m.file)?.text),
          h("figcaption", {}, h("span", {}, m.file), h("a", { href: urlOf(p.key, m.file), download: p.platform + "-" + p.id + "-" + m.file }, "Download"))))),
        why);

  const isX = p.platform === "x";
  const panel = h("section", { class: "copy", "aria-label": "Copy" },
    h("div", {}, h("div", { class: "head" }, h("h2", {}, p.hook || p.id),
      h("button", { class: "posted-toggle", type: "button", "aria-pressed": String(store.get(p.key)), onclick: () => { store.set(p.key, !store.get(p.key)); render(); } },
        store.get(p.key) ? "Posted" : "Mark as posted")),
      h("div", { class: "meta" }, h("span", { class: "chip plat" }, p.label), p.kind ? h("span", { class: "chip" }, p.kind) : null, p.window ? h("span", { class: "chip" }, "Post " + p.window) : null)),
    p.thread
      ? h("div", { class: "group" }, h("h3", {}, "Thread, " + p.thread.length + " posts"),
          p.thread.map((t, i) => slab("Post " + (i + 1), t, { limit: 280, count: xLength })),
          slab("Whole thread", p.thread.join("\\n\\n")))
      : slab(p.platform === "youtube-shorts" ? "Description" : "Caption", p.caption, { limit: isX ? 280 : p.limits?.caption ?? null, count: isX ? xLength : null }),
    p.platform === "youtube-shorts" ? slab("Title", p.title, { limit: p.limits?.title ?? 100 }) : null,
    slab("Hashtags", p.hashtags),
    p.link ? slab("Link", p.link) : null,
    p.alts.length ? h("div", { class: "group" }, h("h3", {}, "Alt text"), p.alts.map((a) => slab(a.file, a.text))) : null,
    h("p", { class: "keys" }, h("kbd", {}, "J"), " ", h("kbd", {}, "K"), " move   ", h("kbd", {}, "C"), " copy the caption   ", h("kbd", {}, "P"), " posted"));

  root.append(h("div", { class: "app" }, bar, queue, stage, panel));
  $(".item[aria-current=true]")?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function emptyState(error) {
  return h("div", { class: "empty" }, h("div", { class: "dropzone" },
    h("div", { class: "mark", "aria-hidden": "true" }, "s"),
    h("h2", {}, "Drop a campaign folder here"),
    h("p", {}, "The folder shipreel max made, usually shipreel-output/campaign. It opens in your browser; nothing is uploaded."),
    h("label", { for: "pick" }, "Choose a folder"),
    error ? h("p", { class: "err" }, error) : null));
}

// The dot field: a calm grid that swells around the cursor and eases back.
(function field() {
  const canvas = $("#field"), ctx = canvas.getContext("2d");
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let w = 0, ht = 0, dpr = 1, mx = -9999, my = -9999, sx = -9999, sy = -9999, raf = 0;
  const gap = 24;
  const size = () => { dpr = Math.min(2, devicePixelRatio || 1); w = innerWidth; ht = innerHeight; canvas.width = w * dpr; canvas.height = ht * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw(); };
  function draw() {
    if (look() === "feed") return;
    const rgb = getComputedStyle(document.documentElement).getPropertyValue("--dot").trim() || "255,255,255";
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    ctx.clearRect(0, 0, w, ht);
    for (let y = gap / 2; y < ht; y += gap) for (let x = gap / 2; x < w; x += gap) {
      const d = Math.hypot(x - sx, y - sy), near = Math.max(0, 1 - d / 180);
      ctx.beginPath(); ctx.arc(x, y, 0.9 + near * 2.2, 0, Math.PI * 2);
      ctx.fillStyle = near > 0.05 ? accent : "rgba(" + rgb + ",0.13)";
      ctx.globalAlpha = near > 0.05 ? 0.25 + near * 0.6 : 1;
      ctx.fill(); ctx.globalAlpha = 1;
    }
  }
  function tick() {
    sx += (mx - sx) * 0.12; sy += (my - sy) * 0.12; draw();
    raf = Math.abs(mx - sx) + Math.abs(my - sy) > 0.5 ? requestAnimationFrame(tick) : 0;
  }
  addEventListener("resize", size);
  if (!still) addEventListener("pointermove", (e) => { mx = e.clientX; my = e.clientY; if (sx < -999) { sx = mx; sy = my; } if (!raf) raf = requestAnimationFrame(tick); });
  size();
})();

// A dropped or chosen folder: read it the way desk.mjs reads it on disk, with object URLs for media.
async function loadFiles(list) {
  const byPath = new Map(list.map(({ path, file }) => [path.replace(/^\\/+/, ""), file]));
  const paths = [...byPath.keys()];
  const posts = paths.filter((p) => /(^|\\/)[a-z-]+\\/\\d\\d-[a-z-]+\\/post\\.json$/.test(p));
  if (!posts.length) throw new Error("No campaign pieces in that folder. Choose the campaign folder itself, the one with calendar.md.");
  const base = posts[0].replace(/[a-z-]+\\/\\d\\d-[a-z-]+\\/post\\.json$/, "");
  const text = async (p) => (byPath.has(base + p) ? (await byPath.get(base + p).text()).trim() : "");
  const urls = new Map();
  const saved = JSON.parse((await text("campaign.json")) || "{}");
  const LABELS = { tiktok: "TikTok", instagram: "Instagram", "youtube-shorts": "YouTube Shorts", linkedin: "LinkedIn", x: "X" };
  const rank = (f) => (/\\.mp4$/.test(f) ? 0 : /^(slide|frame)-/.test(f) ? 1 : /^image\\./.test(f) ? 2 : /^cover\\./.test(f) ? 3 : 4);
  const pieces = {};
  for (const post of posts) {
    const key = post.slice(base.length).replace(/\\/post\\.json$/, "");
    const [platform, id] = key.split("/");
    const meta = JSON.parse(await text(key + "/post.json"));
    const files = paths.filter((p) => p.startsWith(base + key + "/") && !p.slice((base + key + "/").length).includes("/")).map((p) => p.split("/").pop());
    for (const f of files) urls.set(key + "/" + f, () => URL.createObjectURL(byPath.get(base + key + "/" + f)));
    const thread = await text(key + "/thread.txt");
    const media = files.filter((f) => /\\.(mp4|png|jpe?g)$/i.test(f) && f !== "video-poster.jpg").sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
      .map((f) => ({ file: f, type: f.endsWith(".mp4") ? "video" : "image", poster: f.endsWith(".mp4") && files.includes("video-poster.jpg") ? "video-poster.jpg" : null }));
    pieces[key] = {
      key, platform, id, label: LABELS[platform] || platform,
      kind: meta.kind, angle: meta.angle, why: meta.why, hook: meta.hook, title: meta.title, link: meta.link, window: meta.postingWindow, limits: meta.limits || {}, format: meta.format || null,
      caption: (await text(key + "/caption.txt")) || null,
      thread: thread ? thread.split(/\\n\\s*\\n(?=\\d+\\/\\d+\\n)/).map((t) => t.trim()).filter(Boolean) : null,
      hashtags: (await text(key + "/hashtags.txt")).split(/\\s+/).filter(Boolean).join(" ") || null,
      alts: (await text(key + "/alt.txt")).split("\\n").map((l) => l.match(/^([\\w.-]+\\.(?:png|jpe?g|mp4)):\\s*(.+)$/i)).filter(Boolean).map((m) => ({ file: m[1], text: m[2].trim() })),
      media, files,
      thumb: files.includes("video-poster.jpg") ? "video-poster.jpg" : (media.find((m) => m.type === "image") || {}).file || null,
    };
  }
  const md = await text("calendar.md");
  const product = (md.match(/^# (.+?): two-week campaign/m) || [])[1] || saved.product || "Your";
  const days = [];
  for (const line of md.split("\\n")) {
    const d = line.match(/^## Day (\\d+)/); if (d) days.push({ day: Number(d[1]), posts: [] });
    const p = line.match(/\`([a-z-]+\\/\\d\\d-[a-z-]+)\`/); if (p && days.length && pieces[p[1]]) days.at(-1).posts.push(p[1]);
  }
  const listed = new Set(days.flatMap((d) => d.posts));
  const rest = Object.keys(pieces).filter((k) => !listed.has(k)).sort();
  if (rest.length) days.push({ day: null, posts: rest });
  const made = new Map();
  urlOf = (key, file) => { const k = key + "/" + file; if (!made.has(k) && urls.has(k)) made.set(k, urls.get(k)()); return made.get(k) || ""; };
  data = { product, accent: saved.accent || null, onAccent: saved.onAccent || null, days: days.filter((d) => d.posts.length), pieces };
  current = null; filter = "all";
  render();
}

async function walk(entry, prefix = "") {
  if (entry.isFile) return [{ path: prefix + entry.name, file: await new Promise((res, rej) => entry.file(res, rej)) }];
  const reader = entry.createReader();
  const out = [];
  for (;;) {
    const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
    if (!batch.length) break;
    for (const e of batch) out.push(...(await walk(e, prefix + entry.name + "/")));
  }
  return out;
}

const fail = (e) => { $("#root").replaceChildren(emptyState(e.message)); };
addEventListener("dragover", (e) => { e.preventDefault(); document.body.classList.add("dragging"); });
addEventListener("dragleave", (e) => { if (!e.relatedTarget) document.body.classList.remove("dragging"); });
addEventListener("drop", async (e) => {
  e.preventDefault(); document.body.classList.remove("dragging");
  const entries = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  try { await loadFiles((await Promise.all(entries.map((en) => walk(en)))).flat()); } catch (err) { fail(err); }
});
$("#pick").addEventListener("change", async (e) => {
  try { await loadFiles([...e.target.files].map((file) => ({ path: file.webkitRelativePath || file.name, file }))); } catch (err) { fail(err); }
  e.target.value = "";
});
addEventListener("keydown", (e) => {
  if (!data || e.metaKey || e.ctrlKey || e.altKey || /input|textarea|video/i.test(e.target.tagName)) return;
  const list = keys(), i = list.indexOf(current);
  if (e.key === "j" || e.key === "ArrowDown" || (look() === "strip" && e.key === "ArrowRight")) { select(list[Math.min(list.length - 1, i + 1)]); e.preventDefault(); }
  else if (e.key === "k" || e.key === "ArrowUp" || (look() === "strip" && e.key === "ArrowLeft")) { select(list[Math.max(0, i - 1)]); e.preventDefault(); }
  else if (e.key === "p") { store.set(current, !store.get(current)); render(); }
  else if (e.key === "c") { $(".copy .slab")?.click(); }
});
// A look can be tried without a rebuild: index.html#look=feed
const asked = (location.hash.match(/look=(night|feed|strip)/) || [])[1];
if (asked) document.documentElement.dataset.look = asked;
render();
</script>
</body>
</html>
`;
}

/** Write <dir>/index.html and <dir>/campaign.json for a campaign folder. Returns the page's path. */
export function writeDesk(dir, { product = null, accent = null, onAccent = null } = {}) {
  const data = readCampaign(dir, { product, accent });
  if (onAccent) data.onAccent = onAccent;
  else if (!data.onAccent) data.onAccent = JSON.parse(read(path.join(dir, "campaign.json")) || "{}").onAccent ?? null;
  writeFileSync(path.join(dir, "campaign.json"), `${JSON.stringify({ product: data.product, accent: data.accent, onAccent: data.onAccent }, null, 2)}\n`);
  writeFileSync(path.join(dir, "index.html"), deskHtml(data));
  return path.join(dir, "index.html");
}

export function openInBrowser(file) {
  const [cmd, args] = process.platform === "darwin" ? ["open", [file]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", file]] : ["xdg-open", [file]];
  execFile(cmd, args, () => {});
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const given = args.find((a) => !a.startsWith("--"));
  const dir = path.resolve(given ?? (existsSync("shipreel-output/campaign") ? "shipreel-output/campaign" : "."));
  try {
    if (!existsSync(path.join(dir, "calendar.md")) && !readdirSync(dir).some((p) => existsSync(path.join(dir, p)) && statSync(path.join(dir, p)).isDirectory() && LABELS[p])) {
      throw new Error(`${dir} is not a campaign folder. Run shipreel max first, or pass the folder (usually shipreel-output/campaign).`);
    }
    const page = writeDesk(dir);
    console.log(`Desk: ${page}`);
    if (!args.includes("--no-open")) openInBrowser(page);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
