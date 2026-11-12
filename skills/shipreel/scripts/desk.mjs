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

/** The desk page. With `data`, the campaign is built in; without, the page waits for a dropped folder. */
export function deskHtml(data = null) {
  const title = data ? `${data.product} campaign` : "shipreel desk";
  const json = data ? JSON.stringify(data).replace(/</g, "\\u003c") : "null";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&display=swap">
<style>
:root {
  --page: #e8ebef; --panel: #ffffff; --sunk: #f3f5f7; --ink: #191c22; --muted: #5a616c; --line: #d3d8de;
  --accent: #2f5bff; --on-accent: #ffffff; --done: #1f7a4d;
  --r-lg: 14px; --r-sm: 8px;
  font-family: "Hanken Grotesk", system-ui, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root { --page: #15171b; --panel: #1d2026; --sunk: #24282f; --ink: #eef0f3; --muted: #a2a9b4; --line: #333842; --done: #4cc38a; }
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body { background: var(--page); color: var(--ink); font-size: 15px; line-height: 1.5; }
button { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.app { display: grid; grid-template-columns: 300px minmax(0, 1fr) minmax(0, 1.1fr); height: 100vh; }
.bar { grid-column: 1 / -1; display: flex; align-items: center; gap: 16px; padding: 14px 20px; border-bottom: 1px solid var(--line); background: var(--panel); }
.app { grid-template-rows: auto minmax(0, 1fr); }
.bar h1 { margin: 0; font-size: 17px; font-weight: 700; letter-spacing: -0.01em; }
.bar .progress { margin-left: auto; color: var(--muted); font-variant-numeric: tabular-nums; }
.bar .meter { width: 120px; height: 6px; border-radius: 3px; background: var(--sunk); overflow: hidden; }
.bar .meter i { display: block; height: 100%; background: var(--done); width: 0; transition: width .3s; }
.bar .drop-btn { border: 1px solid var(--line); background: transparent; border-radius: 999px; padding: 6px 14px; cursor: pointer; }

.queue { overflow: auto; border-right: 1px solid var(--line); padding: 8px 0 24px; background: var(--panel); }
.filters { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 16px 12px; }
.filters button { border: 1px solid var(--line); background: transparent; border-radius: 999px; padding: 3px 10px; font-size: 13px; cursor: pointer; color: var(--muted); }
.filters button[aria-pressed="true"] { background: var(--ink); color: var(--panel); border-color: var(--ink); }
.day { padding: 10px 16px 4px; font-size: 13px; font-weight: 600; color: var(--muted); }
.item { display: grid; grid-template-columns: 18px 1fr; gap: 10px; align-items: start; width: 100%; text-align: left; border: 0; background: transparent; padding: 8px 16px; cursor: pointer; }
.item:hover { background: var(--sunk); }
.item[aria-current="true"] { background: var(--sunk); box-shadow: inset 3px 0 0 var(--accent); }
.item .dot { width: 14px; height: 14px; margin-top: 3px; border-radius: 50%; border: 2px solid var(--line); }
.item.posted .dot { background: var(--done); border-color: var(--done); }
.item .plat { font-size: 13px; color: var(--muted); }
.item .hook { display: block; font-weight: 500; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.item.posted .hook { color: var(--muted); }

.stage { overflow: auto; padding: 24px; display: flex; flex-direction: column; gap: 16px; }
.stage .media { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 6px; scroll-snap-type: x mandatory; }
.stage figure { margin: 0; flex: 0 0 auto; scroll-snap-align: start; display: flex; flex-direction: column; gap: 6px; max-width: 100%; }
.stage video, .stage img { display: block; max-height: 62vh; max-width: 100%; border-radius: var(--r-sm); background: #000; }
.stage figcaption { display: flex; gap: 10px; font-size: 13px; color: var(--muted); }
.stage figcaption a { color: var(--ink); }
.stage .why { color: var(--muted); max-width: 60ch; }

.copy { overflow: auto; padding: 24px; border-left: 1px solid var(--line); display: flex; flex-direction: column; gap: 14px; }
.head { display: flex; align-items: center; gap: 12px; }
.head h2 { margin: 0; font-size: 22px; line-height: 1.25; letter-spacing: -0.015em; flex: 1; }
.posted-toggle { display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--line); border-radius: 999px; padding: 6px 14px; background: var(--panel); cursor: pointer; white-space: nowrap; }
.posted-toggle[aria-pressed="true"] { background: var(--done); border-color: var(--done); color: #fff; }
.meta { color: var(--muted); font-size: 14px; margin-top: -6px; }

.slab { position: relative; display: block; width: 100%; text-align: left; cursor: copy; border: 1px solid var(--line); border-radius: var(--r-lg); background: var(--panel); padding: 12px 14px 14px; overflow: hidden; }
.slab:hover { border-color: var(--ink); }
.slab .label { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; color: var(--muted); margin-bottom: 6px; position: relative; z-index: 1; }
.slab .label b { font-weight: 600; color: var(--ink); }
.slab .label .right { display: flex; gap: 12px; }
.slab .label .over { color: #c2362b; font-weight: 600; }
.slab .text { white-space: pre-wrap; overflow-wrap: anywhere; position: relative; z-index: 1; max-width: 72ch; }
.slab .hint { color: var(--muted); }
/* The one motion on the page: a copy sweeps the block in the campaign's colour. */
.slab::before { content: ""; position: absolute; inset: 0; background: var(--accent); transform: scaleX(0); transform-origin: left; }
.slab.copied::before { animation: sweep .7s ease-out; }
.slab.copied .label, .slab.copied .label b, .slab.copied .text { color: var(--on-accent); transition: color .1s; }
@keyframes sweep { 0% { transform: scaleX(0); opacity: 1; } 45% { transform: scaleX(1); opacity: 1; } 100% { transform: scaleX(1); opacity: 0; } }
.group { display: flex; flex-direction: column; gap: 8px; }
.group > h3 { margin: 6px 0 0; font-size: 14px; font-weight: 600; }
.keys { color: var(--muted); font-size: 13px; margin-top: auto; padding-top: 12px; }
kbd { font: inherit; border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 5px; padding: 0 5px; }

.empty { grid-column: 1 / -1; display: grid; place-items: center; padding: 24px; }
.dropzone { max-width: 520px; width: 100%; border: 2px dashed var(--line); border-radius: 20px; padding: 48px 32px; text-align: center; background: var(--panel); }
.dropzone h2 { margin: 0 0 8px; font-size: 24px; letter-spacing: -0.015em; }
.dropzone p { margin: 0 0 18px; color: var(--muted); }
.dropzone label { display: inline-block; background: var(--ink); color: var(--panel); border-radius: 999px; padding: 9px 18px; cursor: pointer; font-weight: 600; }
body.dragging .dropzone, body.dragging .app { outline: 3px solid var(--accent); outline-offset: -3px; }
.err { color: #c2362b; margin-top: 14px; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }

@media (max-width: 1000px) {
  .app { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto auto auto auto; height: auto; }
  .bar { flex-wrap: wrap; gap: 8px 12px; padding: 12px 16px; }
  .bar .progress { margin-left: 0; }
  .bar .meter { display: none; }
  .bar .drop-btn { margin-left: auto; }
  .queue { max-height: 40vh; border-right: 0; border-bottom: 1px solid var(--line); }
  .copy { border-left: 0; }
  .stage, .copy { padding: 16px; }
}
@media (prefers-reduced-motion: reduce) { .slab.copied::before { animation-duration: .01s; } .bar .meter i { transition: none; } }
</style>
</head>
<body>
<div id="root"></div>
<input type="file" id="pick" webkitdirectory multiple class="sr" aria-hidden="true" tabindex="-1">
<script id="campaign" type="application/json">${json}</script>
<script>
"use strict";
const $ = (s, el = document) => el.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
};

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
  const said = slab.querySelector(".said"); if (said) { said.textContent = "Copied"; setTimeout(() => (said.textContent = "Click to copy"), 1400); }
}

function slab(label, text, { limit = null, count = null } = {}) {
  if (!text) return null;
  const n = count ? count(text) : [...text].length;
  const el = h("button", { class: "slab", type: "button", "aria-label": "Copy " + label },
    h("span", { class: "label" }, h("b", {}, label),
      h("span", { class: "right" }, limit ? h("span", { class: n > limit ? "over" : "" }, n + " of " + limit) : null, h("span", { class: "said" }, "Click to copy"))),
    h("span", { class: "text" }, text));
  el.addEventListener("click", () => copy(text, el));
  return el;
}

const keys = () => data.days.flatMap((d) => d.posts).filter((k) => filter === "all" || data.pieces[k].platform === filter);

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

  const bar = h("header", { class: "bar" },
    h("h1", {}, data.product + " campaign"),
    h("span", { class: "progress" }, done + " of " + all.length + " posted"),
    h("span", { class: "meter", "aria-hidden": "true" }, h("i", { style: "width:" + (all.length ? (100 * done) / all.length : 0) + "%" })),
    h("button", { class: "drop-btn", type: "button", onclick: () => $("#pick").click() }, "Open another folder"));

  const queue = h("nav", { class: "queue", "aria-label": "Posting order" },
    h("div", { class: "filters" }, ["all", ...platforms].map((p) =>
      h("button", { type: "button", "aria-pressed": String(filter === p), onclick: () => { filter = p; current = keys()[0]; render(); } },
        p === "all" ? "All" : data.pieces[all.find((k) => data.pieces[k].platform === p)].label))),
    data.days.map((d) => {
      const posts = d.posts.filter((k) => filter === "all" || data.pieces[k].platform === filter);
      if (!posts.length) return null;
      return [h("div", { class: "day" }, d.day ? "Day " + d.day : "Not on the calendar"),
        posts.map((k) => {
          const p = data.pieces[k];
          return h("button", { class: "item" + (store.get(k) ? " posted" : ""), type: "button", "aria-current": String(k === current), onclick: () => { current = k; render(); } },
            h("span", { class: "dot", "aria-hidden": "true" }),
            h("span", {}, h("span", { class: "plat" }, p.label + ", " + p.kind), h("span", { class: "hook" }, p.hook || p.id)));
        })];
    }));

  const p = data.pieces[current];
  const altFor = (f) => p.alts.find((a) => a.file === f)?.text;
  const stage = h("main", { class: "stage" },
    h("div", { class: "media" }, p.media.map((m) => h("figure", {},
      m.type === "video"
        ? h("video", { src: urlOf(p.key, m.file), poster: m.poster ? urlOf(p.key, m.poster) : null, controls: true, playsinline: true, preload: "metadata" })
        : h("img", { src: urlOf(p.key, m.file), alt: altFor(m.file) || "", loading: "lazy" }),
      h("figcaption", {}, h("span", {}, m.file), h("a", { href: urlOf(p.key, m.file), download: p.platform + "-" + p.id + "-" + m.file }, "Download"))))),
    p.why ? h("p", { class: "why" }, "Why this piece: " + p.why) : null);

  const limit = p.limits?.caption ?? null;
  const isX = p.platform === "x";
  const panel = h("section", { class: "copy", "aria-label": "Copy" },
    h("div", { class: "head" }, h("h2", {}, p.hook || p.id),
      h("button", { class: "posted-toggle", type: "button", "aria-pressed": String(store.get(p.key)), onclick: () => { store.set(p.key, !store.get(p.key)); render(); } },
        store.get(p.key) ? "Posted" : "Mark as posted")),
    h("div", { class: "meta" }, [p.label, p.kind, p.window ? "post " + p.window : null].filter(Boolean).join(", ")),
    p.thread
      ? h("div", { class: "group" }, h("h3", {}, "Thread, " + p.thread.length + " posts"),
          p.thread.map((t, i) => slab("Post " + (i + 1), t, { limit: 280, count: xLength })),
          slab("Whole thread", p.thread.join("\\n\\n")))
      : slab(p.platform === "youtube-shorts" ? "Description" : "Caption", p.caption, { limit: isX ? 280 : limit, count: isX ? xLength : null }),
    p.platform === "youtube-shorts" ? slab("Title", p.title, { limit: p.limits?.title ?? 100 }) : null,
    slab("Hashtags", p.hashtags),
    p.link ? slab("Link", p.link) : null,
    p.alts.length ? h("div", { class: "group" }, h("h3", {}, "Alt text"), p.alts.map((a) => slab(a.file, a.text))) : null,
    h("p", { class: "keys" }, h("kbd", {}, "J"), " / ", h("kbd", {}, "K"), " next and previous, ", h("kbd", {}, "C"), " copy the caption, ", h("kbd", {}, "P"), " mark as posted"));

  root.append(h("div", { class: "app" }, bar, queue, stage, panel));
  $(".item[aria-current=true]")?.scrollIntoView({ block: "nearest" });
}

function emptyState(error) {
  return h("div", { class: "app" }, h("div", { class: "empty" }, h("div", { class: "dropzone" },
    h("h2", {}, "Drop a campaign folder here"),
    h("p", {}, "The campaign folder shipreel max made (shipreel-output/campaign). It opens here, in your browser; nothing is uploaded."),
    h("label", { for: "pick" }, "Choose a folder"),
    error ? h("p", { class: "err" }, error) : null)));
}

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
  const pieces = {};
  for (const post of posts) {
    const key = post.slice(base.length).replace(/\\/post\\.json$/, "");
    const [platform, id] = key.split("/");
    const meta = JSON.parse(await text(key + "/post.json"));
    const files = paths.filter((p) => p.startsWith(base + key + "/") && !p.slice((base + key + "/").length).includes("/")).map((p) => p.split("/").pop());
    for (const f of files) urls.set(key + "/" + f, () => URL.createObjectURL(byPath.get(base + key + "/" + f)));
    const rank = (f) => (/\\.mp4$/.test(f) ? 0 : /^(slide|frame)-/.test(f) ? 1 : /^image\\./.test(f) ? 2 : /^cover\\./.test(f) ? 3 : 4);
    const thread = await text(key + "/thread.txt");
    pieces[key] = {
      key, platform, id, label: (saved.pieces?.[key]?.label) || ({ tiktok: "TikTok", instagram: "Instagram", "youtube-shorts": "YouTube Shorts", linkedin: "LinkedIn", x: "X" })[platform] || platform,
      kind: meta.kind, angle: meta.angle, why: meta.why, hook: meta.hook, title: meta.title, link: meta.link, window: meta.postingWindow, limits: meta.limits || {},
      caption: (await text(key + "/caption.txt")) || null,
      thread: thread ? thread.split(/\\n\\s*\\n(?=\\d+\\/\\d+\\n)/).map((t) => t.trim()).filter(Boolean) : null,
      hashtags: (await text(key + "/hashtags.txt")).split(/\\s+/).filter(Boolean).join(" ") || null,
      alts: (await text(key + "/alt.txt")).split("\\n").map((l) => l.match(/^([\\w.-]+\\.(?:png|jpe?g|mp4)):\\s*(.+)$/i)).filter(Boolean).map((m) => ({ file: m[1], text: m[2].trim() })),
      media: files.filter((f) => /\\.(mp4|png|jpe?g)$/i.test(f) && f !== "video-poster.jpg").sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
        .map((f) => ({ file: f, type: f.endsWith(".mp4") ? "video" : "image", poster: f.endsWith(".mp4") && files.includes("video-poster.jpg") ? "video-poster.jpg" : null })),
      files,
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
  if (!data || e.metaKey || e.ctrlKey || e.altKey || /input|textarea/i.test(e.target.tagName)) return;
  const list = keys(), i = list.indexOf(current);
  if (e.key === "j" || e.key === "ArrowDown") { current = list[Math.min(list.length - 1, i + 1)]; render(); e.preventDefault(); }
  else if (e.key === "k" || e.key === "ArrowUp") { current = list[Math.max(0, i - 1)]; render(); e.preventDefault(); }
  else if (e.key === "p") { store.set(current, !store.get(current)); render(); }
  else if (e.key === "c") { $(".copy .slab")?.click(); }
});
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
