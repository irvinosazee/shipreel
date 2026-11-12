#!/usr/bin/env node
/**
 * Card video template: a deterministic Hyperframes composition built from structured content, with
 * no agent in the loop. It powers release videos, PR previews, and the standalone `shipreel make`.
 *
 *   node <skill-root>/scripts/template_video.mjs <content.json> --out <composition-dir> [--format vertical] [--no-music]
 *
 * content.json:
 * {
 *   "kicker": "v2.4.0", "title": "shipreel", "subtitle": "turn any project into a launch video",
 *   "stats": [{ "value": "142", "label": "commits" }],
 *   "screenshots": [{ "file": "home.png", "caption": "the landing page" }],
 *   "highlights": { "heading": "what's new", "items": ["vertical exports", "karaoke captions"] },
 *   "outro": { "line": "try it", "detail": "npx @irvinosazee/shipreel make" },
 *   "theme": { "bg": "#0f0d15", "fg": "#f5f1ea", "muted": "#b9b2a8", "accent": "#ff6b3d" }
 * }
 *
 * Scenes are hook → stats → up to two screenshots (tall ones pan) → highlights → outro. Every text
 * line holds for its reading time, the whole video stays within 25s (extra screenshots, highlight
 * items, and then stats are dropped and reported), vertical content stays inside the merged
 * TikTok/Reels/Shorts safe rectangle, and colors are hex so `hyperframes check` can audit contrast.
 * This is the agent-free floor: the /shipreel skill writes a bespoke composition instead.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readingNeed } from "./text_audit.mjs";
import { contrastRatio } from "./captions.mjs";

export const CARD_THEME = { bg: "#0f0d15", fg: "#f5f1ea", muted: "#b9b2a8", accent: "#ff6b3d", panel: "#1c1924" };
export const DEFAULT_MUSIC = fileURLToPath(new URL("../assets/music/happy-beats-business-moves-vol-10-by-ende-dot-app.mp3", import.meta.url));

const MAX_DURATION = 25;
const MAX_SCREENSHOTS = 2;
const MAX_ITEMS = 4;
const MAX_STATS = 3;
// Height/width above which a screenshot is a full-page capture worth panning (a 9:19.5 phone is ~2.17).
const FULL_PAGE_ASPECT = 2.2;
// Average advance of a bold sans glyph, as a fraction of the font size; spaces are narrower.
const GLYPH_EM = 0.56;
const SPACE_EM = 0.28;

const BOXES = {
  landscape: { frame: [1920, 1080], x: 140, y: 110, width: 1640, height: 860, titleMax: 150 },
  // Inside the merged vertical safe rectangle (x 65–929, y 250–1440 on 1080x1920).
  vertical: { frame: [1080, 1920], x: 90, y: 280, width: 810, height: 1130, titleMax: 124 },
  square: { frame: [1080, 1080], x: 90, y: 90, width: 900, height: 900, titleMax: 120 },
  feed: { frame: [1080, 1350], x: 90, y: 110, width: 900, height: 1130, titleMax: 124 },
};

const round3 = (n) => Math.round(n * 1000) / 1000;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const words = (text) => String(text ?? "").trim().split(/\s+/).filter(Boolean).length;
const escapeHtml = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function contentBox(format) {
  const box = BOXES[format];
  if (!box) throw new Error(`Unknown format "${format}". Use one of: ${Object.keys(BOXES).join(", ")}.`);
  return box;
}

function lineCount(tokens, px, width) {
  let lines = 1;
  let used = 0;
  for (const token of tokens) {
    const w = token.length * GLYPH_EM * px;
    const next = used === 0 ? w : used + SPACE_EM * px + w;
    if (next > width && used > 0) {
      lines += 1;
      used = w;
    } else {
      used = next;
    }
  }
  return lines;
}

/** The largest font size (stepping by 2px) at which `text` wraps into `maxLines`; truncates with … only at `minPx`. */
export function fitFontPx(text, { width, maxPx, minPx, maxLines }) {
  const tokens = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  for (let px = maxPx; px >= minPx; px -= 2) {
    if (lineCount(tokens, px, width) <= maxLines) return { px, text: tokens.join(" ") };
  }
  const kept = [...tokens];
  while (kept.length > 1 && lineCount([...kept.slice(0, -1), `${kept.at(-1)}…`], minPx, width) > maxLines) kept.pop();
  return { px: minPx, text: kept.length < tokens.length ? `${kept.join(" ")}…` : kept.join(" ") };
}

function highlightDuration(items) {
  if (!items.length) return 0;
  const lastAppears = 0.6 + (items.length - 1) * 0.4;
  const total = items.reduce((sum, item) => sum + readingNeed(words(item)), 0);
  return round3(clamp(Math.max(lastAppears + readingNeed(words(items.at(-1))) + 0.4, 0.8 + total), 2.4, 8));
}

export function planCardVideo(content, { format = "landscape" } = {}) {
  contentBox(format);
  const dropped = [];
  let stats = (content.stats ?? []).filter((s) => s && s.value != null && String(s.value) !== "");
  if (stats.length > MAX_STATS) dropped.push(...stats.splice(MAX_STATS).map((s) => `stat "${s.label}"`));
  let shots = [...(content.screenshots ?? [])];
  if (shots.length > MAX_SCREENSHOTS) dropped.push(...shots.splice(MAX_SCREENSHOTS).map((s) => `screenshot ${s.file}`));
  let items = (content.highlights?.items ?? []).map((item) => String(item).trim()).filter(Boolean);
  if (items.length > MAX_ITEMS) dropped.push(...items.splice(MAX_ITEMS).map((item) => `highlight "${item}"`));

  const hookWords = words(content.kicker) + words(content.title) + words(content.subtitle);
  const hook = round3(clamp(0.9 + readingNeed(hookWords), 2.6, 4.5));
  const outroWords = words(content.outro?.line ?? content.title) + words(content.outro?.detail);
  const outro = round3(clamp(1.0 + readingNeed(outroWords), 2.8, 4));
  const statsDuration = () => (stats.length ? round3(clamp(1.2 + 0.7 * stats.length, 2.4, 3.6)) : 0);
  const total = () => hook + statsDuration() + shots.length * 3.4 + highlightDuration(items) + outro;

  while (round3(total()) > MAX_DURATION) {
    if (shots.length > 1) dropped.push(`screenshot ${shots.pop().file}`);
    else if (items.length > 1) dropped.push(`highlight "${items.pop()}"`);
    else if (stats.length) {
      dropped.push(...stats.map((s) => `stat "${s.label}"`));
      stats = [];
    } else if (shots.length) dropped.push(`screenshot ${shots.pop().file}`);
    else if (items.length) dropped.push(`highlight "${items.pop()}"`);
    else break;
  }

  const scenes = [];
  let t = 0;
  const add = (id, duration, extra = {}) => {
    scenes.push({ id, start: round3(t), duration: round3(duration), ...extra });
    t = round3(t + duration);
  };
  add("hook", hook);
  if (stats.length) add("stats", statsDuration());
  shots.forEach((shot, i) => add(`shot-${i}`, 3.4, { shot }));
  if (items.length) add("highlights", highlightDuration(items));
  add("outro", outro);

  return { format, duration: t, scenes, stats, highlightItems: items, posterAt: round3(Math.min(1.4, hook - 0.3)), dropped };
}

function resolveTheme(theme = {}) {
  const merged = { ...CARD_THEME, ...theme };
  for (const key of ["fg", "muted", "accent"]) {
    const ratio = contrastRatio(merged[key], merged.bg);
    if (ratio < 4.5) throw new Error(`Theme ${key} ${merged[key]} on ${merged.bg} has contrast ${ratio.toFixed(1)}:1; card text needs at least 4.5:1.`);
  }
  return merged;
}

function shotLayout(box, shot, body) {
  const bar = 44;
  const captionHeight = shot.caption ? Math.round(body * 1.35) + 28 : 0;
  const frameWidth = box.width;
  const maxArea = box.height - bar - captionHeight;
  const known = Boolean(shot.width && shot.height);
  let width = frameWidth;
  let shown = known ? Math.round((shot.height * frameWidth) / shot.width) : maxArea;
  // Only full-page screenshots (taller than a phone screen) pan; a viewport capture is fitted whole,
  // since panning it would scroll into empty background below short pages.
  if (known && shown > maxArea && shot.height / shot.width <= FULL_PAGE_ASPECT) {
    width = Math.round((maxArea * shot.width) / shot.height);
    shown = maxArea;
  }
  const area = Math.min(maxArea, shown);
  const top = box.y + Math.round((box.height - (bar + area + captionHeight)) / 2);
  return { bar, frameWidth: width, left: Math.round((frameWidth - width) / 2), area, shown, top, captionHeight, pan: Math.min(area, Math.max(0, shown - area)) };
}

export function buildCardComposition(content, { format = "landscape", theme, music = null } = {}) {
  const plan = planCardVideo(content, { format });
  const box = contentBox(format);
  const colors = resolveTheme(theme ?? content.theme);
  // A brand display face for titles, when the composition ships its file (content.mjs fetches it).
  const display = (theme ?? content.theme)?.displayFont;
  const displayFile = (theme ?? content.theme)?.displayFontFile;
  const fontFace = display && displayFile ? `@font-face { font-family: "${display}"; src: url("${displayFile}") format("woff2"); font-weight: 100 900; }` : "";
  const titleFont = fontFace ? `font-family: "${display}", sans-serif; letter-spacing: 0;` : "";
  const [W, H] = box.frame;
  const body = 48;
  const vertical = H > W;
  const tweens = [];
  const at = (scene, offset) => round3(scene.start + offset);
  const enter = (selector, scene, offset, [prop, distance], duration) =>
    tweens.push(`tl.fromTo("${selector}", { ${prop}: ${distance}, opacity: 0 }, { ${prop}: 0, opacity: 1, duration: ${duration}, ease: "power3.out" }, ${at(scene, offset)});`);

  const sections = plan.scenes.map((scene, index) => {
    const clip = `id="${scene.id}" class="clip scene" data-start="${scene.start}" data-duration="${scene.duration}" data-track-index="${index}"`;
    tweens.push(`tl.fromTo("#${scene.id}-stage", { opacity: 0 }, { opacity: 1, duration: ${index === 0 ? 0.01 : 0.25}, ease: "none" }, ${at(scene, 0)});`);
    const stage = (inner, style = "") => `<section ${clip}>\n        <div id="${scene.id}-stage" class="stage" style="${style}">\n${inner}\n        </div>\n      </section>`;

    if (scene.id === "hook") {
      // A vertical frame is narrow and tall: a long hook gets more lines rather than an ellipsis.
      const title = fitFontPx(content.title, { width: box.width, maxPx: box.titleMax, minPx: 64, maxLines: vertical ? 5 : 3 });
      const subtitle = content.subtitle ? fitFontPx(content.subtitle, { width: box.width, maxPx: 60, minPx: 44, maxLines: vertical ? 5 : 3 }) : null;
      if (content.kicker) enter("#hook-kicker", scene, 0.1, ["y", 30], 0.45);
      enter("#hook-title", scene, 0.2, ["y", 60], 0.6);
      tweens.push(`tl.fromTo("#hook-rule", { scaleX: 0 }, { scaleX: 1, duration: 0.5, ease: "power2.out" }, ${at(scene, 0.45)});`);
      if (subtitle) enter("#hook-subtitle", scene, 0.5, ["y", 40], 0.5);
      return stage(
        [
          content.kicker ? `          <p id="hook-kicker" class="kicker">${escapeHtml(content.kicker)}</p>` : "",
          `          <h1 id="hook-title" class="title" style="font-size: ${title.px}px">${escapeHtml(title.text)}</h1>`,
          `          <div id="hook-rule" class="rule"></div>`,
          subtitle ? `          <p id="hook-subtitle" class="subtitle" style="font-size: ${subtitle.px}px">${escapeHtml(subtitle.text)}</p>` : "",
        ].filter(Boolean).join("\n"),
        "justify-content: center;",
      );
    }

    if (scene.id === "stats") {
      const cards = plan.stats.map((stat, i) => {
        enter(`#stat-${i}`, scene, 0.15 + i * 0.35, ["y", 50], 0.5);
        const value = fitFontPx(stat.value, { width: vertical ? box.width : box.width / plan.stats.length - 40, maxPx: 150, minPx: 72, maxLines: 1 });
        return `          <div id="stat-${i}" class="stat"><span class="stat-value" style="font-size: ${value.px}px">${escapeHtml(value.text)}</span><span class="stat-label">${escapeHtml(stat.label)}</span></div>`;
      });
      return stage(cards.join("\n"), `justify-content: center; flex-direction: ${vertical ? "column" : "row"}; gap: ${vertical ? 72 : 40}px; ${vertical ? "" : "align-items: center;"}`);
    }

    if (scene.id.startsWith("shot-")) {
      const i = scene.id.slice(5);
      const layout = shotLayout(box, scene.shot, body);
      tweens.push(`tl.fromTo("#${scene.id}-frame", { scale: 0.94, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.5, ease: "power3.out" }, ${at(scene, 0.05)});`);
      if (layout.pan > 0) {
        tweens.push(`tl.fromTo("#${scene.id}-img", { y: 0 }, { y: -${layout.pan}, duration: ${round3(scene.duration - 1.3)}, ease: "sine.inOut" }, ${at(scene, 0.8)});`);
      }
      if (scene.shot.caption) enter(`#${scene.id}-caption`, scene, 0.35, ["y", 30], 0.45);
      const src = `assets/shot-${i}${path.extname(scene.shot.file) || ".png"}`;
      const imgStyle = scene.shot.width && scene.shot.height ? `width: 100%; height: ${layout.shown}px;` : "width: 100%; height: 100%; object-fit: cover; object-position: top;";
      return stage(
        [
          `          <div id="${scene.id}-frame" class="frame" style="top: ${layout.top - box.y}px; left: ${layout.left}px; width: ${layout.frameWidth}px; height: ${layout.bar + layout.area}px;">`,
          `            <div class="frame-bar"><i></i><i></i><i></i></div>`,
          `            <div class="frame-view" style="height: ${layout.area}px;"><img id="${scene.id}-img" src="${src}" alt="" style="${imgStyle}" data-layout-allow-overflow /></div>`,
          `          </div>`,
          scene.shot.caption
            ? `          <p id="${scene.id}-caption" class="caption" style="top: ${layout.top - box.y + layout.bar + layout.area + 28}px; left: ${layout.left}px;">${escapeHtml(scene.shot.caption)}</p>`
            : "",
        ].filter(Boolean).join("\n"),
      );
    }

    if (scene.id === "highlights") {
      const heading = content.highlights?.heading;
      if (heading) enter("#hl-heading", scene, 0.1, ["y", 30], 0.45);
      const items = plan.highlightItems.map((item, i) => {
        enter(`#hl-${i}`, scene, 0.6 + i * 0.4, ["x", -40], 0.45);
        return `            <li id="hl-${i}" class="item"><span class="dot"></span><span>${escapeHtml(item)}</span></li>`;
      });
      return stage(
        [heading ? `          <p id="hl-heading" class="kicker">${escapeHtml(heading)}</p>` : "", `          <ul class="items">`, ...items, `          </ul>`].filter(Boolean).join("\n"),
        "justify-content: center;",
      );
    }

    const line = fitFontPx(content.outro?.line ?? content.title, { width: box.width, maxPx: box.titleMax, minPx: 64, maxLines: 3 });
    enter("#outro-line", scene, 0.15, ["y", 60], 0.6);
    const detail = content.outro?.detail;
    if (detail) enter("#outro-detail", scene, 0.55, ["y", 30], 0.5);
    return stage(
      [
        `          <h2 id="outro-line" class="title" style="font-size: ${line.px}px">${escapeHtml(line.text)}</h2>`,
        detail ? `          <p id="outro-detail" class="pill">${escapeHtml(detail)}</p>` : "",
      ].filter(Boolean).join("\n"),
      "justify-content: center;",
    );
  });

  tweens.push(`tl.fromTo("#progress", { scaleX: 0 }, { scaleX: 1, duration: ${plan.duration}, ease: "none" }, 0);`);

  const html = `<!doctype html>
<html lang="en" data-resolution="${format === "vertical" ? "portrait" : format}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <title>${escapeHtml(content.title)}</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      ${fontFace}
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: ${colors.bg}; }
      #root { position: relative; width: 100%; height: 100%; overflow: hidden; background: ${colors.bg}; color: ${colors.fg}; font-family: sans-serif; }
      .scene { position: absolute; inset: 0; }
      .stage { position: absolute; left: ${box.x}px; top: ${box.y}px; width: ${box.width}px; height: ${box.height}px; display: flex; flex-direction: column; }
      .kicker { font-size: 40px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${colors.accent}; margin-bottom: 28px; }
      .title { font-weight: 900; line-height: 1.02; letter-spacing: -0.02em; color: ${colors.fg}; ${titleFont} }
      .rule { width: 160px; height: 10px; margin: 40px 0 36px; border-radius: 5px; background: ${colors.accent}; transform-origin: 0 50%; }
      .subtitle { font-weight: 500; line-height: 1.25; color: ${colors.muted}; }
      .stat { display: flex; flex-direction: column; ${vertical ? "" : "flex: 1;"} }
      .stat-value { font-weight: 900; line-height: 1; color: ${colors.accent}; ${titleFont} }
      .stat-label { margin-top: 14px; font-size: ${body}px; font-weight: 600; color: ${colors.muted}; }
      .frame { position: absolute; left: 0; width: 100%; border-radius: 22px; overflow: hidden; background: ${colors.panel}; }
      .frame-bar { height: 44px; display: flex; align-items: center; gap: 12px; padding: 0 20px; background: ${colors.panel}; }
      .frame-bar i { width: 16px; height: 16px; border-radius: 50%; background: ${colors.muted}; }
      .frame-view { position: relative; overflow: hidden; background: ${colors.bg}; }
      .frame-view img { display: block; }
      .caption { position: absolute; left: 0; width: 100%; font-size: ${body}px; font-weight: 600; color: ${colors.fg}; }
      .items { list-style: none; display: flex; flex-direction: column; gap: 34px; }
      .item { display: flex; align-items: flex-start; gap: 26px; font-size: ${vertical ? 54 : 60}px; font-weight: 700; line-height: 1.2; color: ${colors.fg}; }
      .dot { flex: none; margin-top: 0.42em; width: 22px; height: 22px; border-radius: 50%; background: ${colors.accent}; }
      .pill { align-self: flex-start; margin-top: 44px; padding: 20px 32px; border-radius: 18px; background: ${colors.panel}; font-family: monospace; font-size: ${body}px; color: ${colors.fg}; }
      #progress { position: absolute; left: 0; bottom: 0; width: 100%; height: 8px; background: ${colors.accent}; transform-origin: 0 50%; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-width="${W}" data-height="${H}" data-duration="${plan.duration}">
      ${sections.join("\n      ")}
      <div id="progress"></div>
${music ? `      <audio id="music" src="${music}" data-start="0" data-duration="${plan.duration}" data-track-index="10" data-volume="0.8"></audio>\n` : ""}    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      ${tweens.join("\n      ")}
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;
  return { html, plan };
}

function imageSize(file) {
  const out = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file], { encoding: "utf8" });
  const [width, height] = out.stdout.trim().split(",").map(Number);
  return width && height ? { width, height } : {};
}

/** Write a renderable composition: index.html, card.json, screenshots and a faded music bed in assets/. */
export function writeCardProject(content, { outDir, format = "landscape", theme, music = DEFAULT_MUSIC, baseDir = process.cwd() }) {
  const assets = path.join(outDir, "assets");
  mkdirSync(assets, { recursive: true });
  const screenshots = (content.screenshots ?? []).map((shot) => {
    const source = path.resolve(baseDir, shot.file);
    if (!existsSync(source)) throw new Error(`Screenshot ${shot.file} does not exist.`);
    return { ...shot, file: source, ...(shot.width && shot.height ? {} : imageSize(source)) };
  });
  const resolved = { ...content, screenshots };
  const { html, plan } = buildCardComposition(resolved, { format, theme, music: music ? "assets/music.wav" : null });
  plan.scenes.filter((s) => s.shot).forEach((scene) => {
    copyFileSync(scene.shot.file, path.join(assets, `${scene.id}${path.extname(scene.shot.file) || ".png"}`));
  });
  if (music) {
    const fadeOut = Math.max(0, plan.duration - 1.5);
    const result = spawnSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y", "-i", music, "-t", String(plan.duration),
      "-af", `afade=t=in:d=0.2,afade=t=out:st=${fadeOut}:d=1.5`, "-ar", "48000", "-ac", "2", path.join(assets, "music.wav"),
    ], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`ffmpeg could not prepare the music bed: ${result.stderr.trim()}`);
  }
  writeFileSync(path.join(outDir, "index.html"), html);
  writeFileSync(path.join(outDir, "card.json"), `${JSON.stringify({ content: resolved, plan: { ...plan, scenes: plan.scenes.map(({ shot, ...s }) => s) } }, null, 2)}\n`);
  return { dir: outDir, plan };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const [input, ...rest] = process.argv.slice(2);
  const flag = (name, fallback) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : fallback);
  if (!input || !flag("--out")) {
    console.error("Usage: template_video.mjs <content.json> --out <composition-dir> [--format landscape|vertical|square|feed] [--no-music]");
    process.exitCode = 2;
  } else {
    try {
      const content = JSON.parse(readFileSync(input, "utf8"));
      const { plan } = writeCardProject(content, {
        outDir: flag("--out"),
        format: flag("--format", "landscape"),
        music: rest.includes("--no-music") ? null : DEFAULT_MUSIC,
        baseDir: path.dirname(path.resolve(input)),
      });
      console.log(JSON.stringify({ duration: plan.duration, posterAt: plan.posterAt, scenes: plan.scenes.map(({ id, start, duration }) => ({ id, start, duration })), dropped: plan.dropped }, null, 2));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
