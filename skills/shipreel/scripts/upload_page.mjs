#!/usr/bin/env node
/**
 * Upload checklist page for a finished shipreel.
 *
 *   node <skill-root>/scripts/upload_page.mjs <output-dir>
 *
 * Reads <output-dir>/exports/shipreel-<platform>.mp4 (plus .gif/.webp), share-copy.txt,
 * share-copy-variants.md, and covers/*.jpg, and writes <output-dir>/exports/index.html:
 * one card per platform with the file to upload, its caption with a copy button,
 * the cover to use, and the platform's notes from platforms.json. Self-contained,
 * works from file://.
 */

import { existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { faviconTag } from "./favicon.mjs";

import { loadPlatforms } from "./platforms.mjs";

const escapeHtml = (text) =>
  String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function parseShareVariants(markdown) {
  const variants = {};
  let current = null;
  for (const line of String(markdown ?? "").split("\n")) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = heading[1];
      variants[current] = [];
    } else if (current) {
      variants[current].push(line);
    }
  }
  // "Cover: ..." lines are instructions for the poster, not part of the post; keep them out of the caption.
  return Object.fromEntries(
    Object.entries(variants).map(([label, lines]) => {
      const coverLine = lines.find((line) => /^cover:/i.test(line.trim()));
      const caption = lines.filter((line) => line !== coverLine).join("\n").trim();
      return [label, { caption, cover: coverLine ? coverLine.trim().replace(/^cover:\s*/i, "") : null }];
    }),
  );
}

function card({ platform, entry, caption, cover, index }) {
  const files = [
    `<a class="file" href="${escapeHtml(entry.path)}">${escapeHtml(path.basename(entry.path))}</a> <span class="meta">${entry.sizeMb ?? "?"} MB</span>`,
    entry.gif ? `<a class="file" href="${escapeHtml(entry.gif)}">${escapeHtml(path.basename(entry.gif))}</a>` : "",
    entry.webp ? `<a class="file" href="${escapeHtml(entry.webp)}">${escapeHtml(path.basename(entry.webp))}</a>` : "",
  ].filter(Boolean);
  const id = `caption-${index}`;
  return `
      <article class="card">
        <label class="check"><input type="checkbox" /> <span>${escapeHtml(platform.label)}</span></label>
        <div class="files">${files.join(" ")}</div>
        <div class="caption-head"><span class="meta">Caption</span><button type="button" data-copy-target="${id}">Copy</button></div>
        <pre id="${id}" class="caption">${escapeHtml(caption)}</pre>
        <p class="note"><strong>Cover:</strong> ${escapeHtml(cover ?? platform.cover)}</p>
        <p class="note">${escapeHtml(platform.notes)}</p>
      </article>`;
}

export function buildUploadPage({ title = "shipreel", exports, shareCopy = "", variants = {}, covers = [] }) {
  const { platforms } = loadPlatforms();
  const order = Object.keys(platforms);
  const cards = exports
    .filter((entry) => platforms[entry.platform])
    .sort((a, b) => order.indexOf(a.platform) - order.indexOf(b.platform))
    .map((entry, index) => {
      const platform = platforms[entry.platform];
      const variant = variants[platform.label];
      return card({ platform, entry, caption: variant?.caption || shareCopy.trim(), cover: variant?.cover, index });
    });
  const coverFigures = covers
    .map((cover) => `<figure><img src="${escapeHtml(cover.path)}" alt="${escapeHtml(cover.id)} cover" /><figcaption>${escapeHtml(cover.id)}</figcaption></figure>`)
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Upload checklist · ${escapeHtml(title)}</title>
    ${faviconTag()}
    <style>
      :root { --bg: #f7f4f0; --card: #ffffff; --ink: #1c1511; --soft: #6b5d55; --rule: #e6ded6; --accent: #d9481c; }
      @media (prefers-color-scheme: dark) { :root { --bg: #120c0a; --card: #1c1411; --ink: #f6efe9; --soft: #b3a59c; --rule: #33271f; --accent: #ff7a4d; } }
      * { box-sizing: border-box; }
      body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif; }
      main { max-width: 1040px; margin: 0 auto; padding: 40px 16px 64px; }
      h1 { font-size: 32px; margin: 0 0 4px; letter-spacing: -0.02em; }
      .lede { color: var(--soft); margin: 0 0 28px; }
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
      .card { background: var(--card); border: 1px solid var(--rule); border-radius: 14px; padding: 18px; display: flex; flex-direction: column; gap: 10px; }
      .check { display: flex; gap: 10px; align-items: center; font-weight: 650; font-size: 18px; }
      .check input { width: 18px; height: 18px; accent-color: var(--accent); }
      .files { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: baseline; }
      .file { color: var(--accent); font-family: ui-monospace, monospace; font-size: 14px; }
      .meta { color: var(--soft); font-size: 13px; }
      .caption-head { display: flex; justify-content: space-between; align-items: center; }
      button { font: inherit; font-size: 13px; padding: 4px 12px; border-radius: 8px; border: 1px solid var(--rule); background: transparent; color: var(--ink); cursor: pointer; }
      .caption { margin: 0; white-space: pre-wrap; font: 14px/1.5 ui-monospace, monospace; background: var(--bg); border-radius: 8px; padding: 10px 12px; }
      .note { margin: 0; color: var(--soft); font-size: 14px; }
      .covers { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 32px; }
      figure { margin: 0; } figure img { display: block; max-width: 240px; height: auto; border-radius: 8px; border: 1px solid var(--rule); }
      figcaption { color: var(--soft); font-size: 13px; margin-top: 4px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Upload checklist</h1>
      <p class="lede">${escapeHtml(title)} · one card per platform. Tick each one off as you post.</p>
      <section class="grid">${cards.join("")}
      </section>
      ${coverFigures ? `<h2>Covers</h2><section class="covers">${coverFigures}</section>` : ""}
    </main>
    <script>
      for (const button of document.querySelectorAll("[data-copy-target]")) {
        button.addEventListener("click", async () => {
          const text = document.getElementById(button.dataset.copyTarget).textContent;
          try { await navigator.clipboard.writeText(text); button.textContent = "Copied"; }
          catch { const range = document.createRange(); range.selectNodeContents(document.getElementById(button.dataset.copyTarget)); getSelection().removeAllRanges(); getSelection().addRange(range); button.textContent = "Selected"; }
        });
      }
    </script>
  </body>
</html>
`;
}

export function writeUploadPage(outputDir) {
  const exportsDir = path.join(outputDir, "exports");
  const read = (file) => (existsSync(file) ? readFileSync(file, "utf8") : "");
  const exportsList = readdirSync(exportsDir)
    .map((name) => name.match(/^shipreel-([a-z]+)\.mp4$/))
    .filter(Boolean)
    .map(([name, platform]) => {
      const entry = { platform, path: name, sizeMb: Number((statSync(path.join(exportsDir, name)).size / 1024 / 1024).toFixed(2)) };
      for (const ext of ["gif", "webp"]) {
        if (existsSync(path.join(exportsDir, `shipreel-${platform}.${ext}`))) entry[ext] = `shipreel-${platform}.${ext}`;
      }
      return entry;
    });
  const coversDir = path.join(outputDir, "covers");
  const covers = existsSync(coversDir)
    ? readdirSync(coversDir).filter((n) => n.endsWith(".jpg")).map((n) => ({ id: n.replace(/\.jpg$/, ""), path: `../covers/${n}` }))
    : [];
  const html = buildUploadPage({
    title: path.basename(path.resolve(outputDir)),
    exports: exportsList,
    shareCopy: read(path.join(outputDir, "share-copy.txt")),
    variants: parseShareVariants(read(path.join(outputDir, "share-copy-variants.md"))),
    covers,
  });
  const target = path.join(exportsDir, "index.html");
  writeFileSync(target, html);
  return target;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const [outputDir] = process.argv.slice(2);
  if (!outputDir || !existsSync(path.join(outputDir, "exports"))) {
    console.error("Usage: upload_page.mjs <output-dir>   (expects <output-dir>/exports/ from platforms.mjs export)");
    process.exitCode = 2;
  } else {
    console.log(writeUploadPage(outputDir));
  }
}
