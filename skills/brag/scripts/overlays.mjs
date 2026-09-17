#!/usr/bin/env node
/**
 * End card with a QR code, and the optional "made with /brag" watermark.
 *
 *   node <skill-root>/scripts/overlays.mjs endcard <composition-dir> --url https://... --handle @name \
 *        --start 19 --duration 3.5 --rect 96,900,816,520 --theme caption-theme.json [--avatar assets/avatar.png]
 *   node <skill-root>/scripts/overlays.mjs watermark <composition-dir> --duration 22.5 --safe 65,250,864,1190 --theme theme.json
 *
 * Both are plain timed markup injected between brag:<name> markers (re-running replaces
 * them), so Hyperframes owns visibility and check/text_audit can measure them. The QR
 * code is inline SVG from the vendored qrcode-generator (MIT).
 */

import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import qrcode from "./vendor/qrcode.mjs";

const QUIET_ZONE = 4;
const URL_MAX_PX = 36;
// Matches text_audit.mjs: nothing on a 1080px-short-side frame renders below 28px.
const URL_MIN_PX = 28;
const QR_MIN_PX = 200;
// Advance width of an average URL character relative to font size, for a proportional sans.
const URL_CHAR_WIDTH = 0.6;
const CARD_PADDING = 32;
const CARD_GAP = 36;
const WATERMARK_HEIGHT = 48;
const escapeHtml = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function qrMatrix(text, level = "M") {
  const qr = qrcode(0, level);
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  return Array.from({ length: count }, (_, y) => Array.from({ length: count }, (_, x) => qr.isDark(y, x)));
}

export function qrSvg(text, { size = 320, fg = "#000000", bg = "#ffffff" } = {}) {
  const matrix = qrMatrix(text);
  const modules = matrix.length + QUIET_ZONE * 2;
  const path = matrix
    .flatMap((row, y) => row.map((dark, x) => (dark ? `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z` : "")))
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${modules} ${modules}" shape-rendering="crispEdges" role="img" aria-label="QR code for ${escapeHtml(text)}"><rect width="${modules}" height="${modules}" fill="${bg}"/><path d="${path}" fill="${fg}"/></svg>`;
}

/** Largest font size (<= 36px) at which the URL fits on one line in the given width. */
export function urlFontPx(displayUrl, availableWidth) {
  const fit = Math.floor(availableWidth / (displayUrl.length * URL_CHAR_WIDTH));
  return Math.max(URL_MIN_PX, Math.min(URL_MAX_PX, fit));
}

/** The start time of an injected end card, or null when there is none. */
export function endCardStart(html) {
  const match = html.match(/class="clip brag-endcard" data-start="([\d.]+)"/);
  return match ? Number(match[1]) : null;
}

const block = (name, lines) => [`<!-- brag:${name}:start -->`, ...lines, `<!-- brag:${name}:end -->`].join("\n");

export function buildEndCard({ url, handle, avatar, start, duration, rect, theme }) {
  const name = handle ? `@${handle.replace(/^@/, "")}` : "";
  const displayUrl = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  // Keep the URL readable: shrink the QR code (still scannable at 200px) before the text, and wrap only after "/".
  const textWidth = (qr) => rect.width - CARD_PADDING * 2 - CARD_GAP - qr;
  const needed = displayUrl.length * URL_CHAR_WIDTH * URL_MIN_PX;
  let qrSize = Math.round(Math.min(rect.height - 80, rect.width * 0.42));
  if (textWidth(qrSize) < needed) qrSize = Math.max(QR_MIN_PX, Math.floor(rect.width - CARD_PADDING * 2 - CARD_GAP - needed));
  const urlPx = urlFontPx(displayUrl, textWidth(qrSize));
  const urlFits = displayUrl.length * URL_CHAR_WIDTH * urlPx <= textWidth(qrSize);
  const urlHtml = urlFits ? escapeHtml(displayUrl) : escapeHtml(displayUrl).split("/").join("/<wbr>");
  const face = avatar
    ? `<img class="brag-avatar" src="${escapeHtml(avatar)}" alt="" />`
    : `<span class="brag-initials">${escapeHtml((name.replace("@", "")[0] ?? "?").toUpperCase())}</span>`;
  return block("endcard", [
    `<div class="clip brag-endcard" data-start="${start}" data-duration="${duration}" data-track-index="95">`,
    `  <style>`,
    `    .brag-captions .clip.brag-endcard, .clip.brag-endcard { right: auto; bottom: auto; }`,
    `    .brag-endcard { position: absolute; z-index: 60; left: ${rect.x}px; top: ${rect.y}px; width: ${rect.width}px; height: ${rect.height}px; display: flex; align-items: center; gap: ${CARD_GAP}px; padding: ${CARD_PADDING}px; border-radius: 28px; background: ${theme.bg}; color: ${theme.fg}; font-family: "${theme.font}", sans-serif; box-sizing: border-box; }`,
    `    .brag-endcard .brag-qr { flex: none; line-height: 0; border-radius: 16px; overflow: hidden; }`,
    `    .brag-endcard .brag-who { display: flex; flex-direction: column; gap: 18px; min-width: 0; }`,
    `    .brag-endcard .brag-avatar, .brag-endcard .brag-initials { width: 96px; height: 96px; border-radius: 50%; object-fit: cover; display: grid; place-items: center; background: ${theme.accent}; color: ${theme.bg}; font-weight: 900; font-size: 48px; }`,
    `    .brag-endcard .brag-handle { font-weight: 800; font-size: 44px; }`,
    `    .brag-endcard .brag-url { font-size: ${urlPx}px; color: ${theme.accent}; white-space: ${urlFits ? "nowrap" : "normal"}; }`,
    `  </style>`,
    `  <div class="brag-qr">${qrSvg(url, { size: qrSize, fg: "#000000", bg: "#ffffff" })}</div>`,
    `  <div class="brag-who">${face}${name ? `<span class="brag-handle">${escapeHtml(name)}</span>` : ""}<span class="brag-url">${urlHtml}</span></div>`,
    `</div>`,
  ]);
}

export function buildWatermark({ duration, until = null, safe, theme, text = "made with /brag" }) {
  // Stop at the end card so the two never overlap.
  const visible = until != null ? Math.min(duration, until) : duration;
  return block("watermark", [
    `<div class="clip brag-watermark" data-start="0" data-duration="${visible}" data-track-index="96">`,
    `  <style>.clip.brag-watermark { right: auto; bottom: auto; } .brag-watermark { position: absolute; z-index: 61; left: ${safe.x}px; top: ${safe.y + safe.height - WATERMARK_HEIGHT}px; height: ${WATERMARK_HEIGHT}px; display: flex; align-items: center; padding: 0 16px; border-radius: 12px; background: ${theme.bg}; color: ${theme.fg}; font-family: "${theme.font}", sans-serif; font-weight: 600; font-size: 30px; opacity: 0.92; }</style>`,
    `  ${escapeHtml(text)}`,
    `</div>`,
  ]);
}

export function injectBlock(html, name, content) {
  const existing = new RegExp(`<!-- brag:${name}:start -->[\\s\\S]*?<!-- brag:${name}:end -->`);
  if (existing.test(html)) return html.replace(existing, content);
  const root = html.match(/<[a-z]+\b[^>]*\bdata-composition-id="[^"]*"[^>]*>/i);
  if (!root) throw new Error("No element with data-composition-id found.");
  return html.replace(root[0], `${root[0]}\n${content}`);
}

const numbers = (text) => text.split(",").map(Number);

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const [command, dir, ...rest] = process.argv.slice(2);
  const flag = (name) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined);
  try {
    if (!dir || !flag("--theme")) throw new Error("Usage: overlays.mjs endcard|watermark <composition-dir> --theme theme.json ...");
    const theme = JSON.parse(readFileSync(flag("--theme"), "utf8"));
    const index = path.join(dir, "index.html");
    let content;
    if (command === "endcard") {
      const [x, y, width, height] = numbers(flag("--rect"));
      content = buildEndCard({ url: flag("--url"), handle: flag("--handle"), avatar: flag("--avatar"), start: Number(flag("--start")), duration: Number(flag("--duration")), rect: { x, y, width, height }, theme });
    } else if (command === "watermark") {
      const [x, y, width, height] = numbers(flag("--safe"));
      content = buildWatermark({ duration: Number(flag("--duration")), until: endCardStart(readFileSync(index, "utf8")), safe: { x, y, width, height }, theme });
    } else {
      throw new Error(`Unknown command "${command}"; use endcard or watermark.`);
    }
    writeFileSync(index, injectBlock(readFileSync(index, "utf8"), command, content));
    console.log(`Injected ${command} into ${index}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
