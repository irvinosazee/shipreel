#!/usr/bin/env node
/**
 * Launch kit: everything needed to announce a shipreel, in one folder (and a zip).
 *
 *   node <skill-root>/scripts/launch_kit.mjs <output-dir> [--url https://…] [--title name] [--highlights "a|b|c"] [--no-zip]
 *
 * Reads a finished run (shipreel.mp4, shipreel.jpg, exports/, shipreel-<format>.mp4, covers/, share-copy.txt,
 * share-copy-variants.md, scenes.json, composition/) and writes <output-dir>/launch-kit/:
 *
 *   videos/    shipreel.mp4, every per-format render and per-platform export (plus GIF/WebP previews)
 *   images/    poster, og (1200x630), youtube (1280x720), reels-grid, producthunt-N (1270x760, one per scene)
 *   copy/      share-copy.txt, x-thread.txt, linkedin.txt, producthunt.txt (name, ≤60-char tagline, ≤260-char description)
 *   embed/     readme-snippet.md and video.html for the project's README and site
 *   credits.txt  music, sound effects, and tools used
 *   README.md    what is in the kit and where each file goes
 *
 * Nothing is posted anywhere; the kit is for the user to upload. Highlights come from --highlights,
 * then composition/card.json (template videos). The link comes from --url, then .shipreel/config.json.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkCopyDir } from "./copy_check.mjs";
import { fitImage, makeCovers } from "./covers.mjs";
import { loadScenes, stillTime } from "./cuts.mjs";
import { parseShareVariants } from "./upload_page.mjs";

const X_LIMIT = 280;
// Each post goes out with a "1/3" counter line in front of it, so leave room for "99/99\n".
const X_BODY = X_LIMIT - 6;
const PH_TAGLINE = 60;
const PH_DESCRIPTION = 260;
const PH_SIZE = [1270, 760];
const MAX_GALLERY = 6;

const escapeHtml = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function clip(text, limit) {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > limit * 0.5 ? cut.slice(0, space) : cut).replace(/[\s,;:.–—-]+$/, "")}…`;
}

/** Split into posts of at most `limit` characters: whole sentences where possible, then words, then characters. */
export function splitPost(text, limit = X_LIMIT) {
  const clean = String(text ?? "").trim();
  if (clean.length <= limit) return clean ? [clean] : [];
  const pieces = clean.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g).map((s) => s.trim()).filter(Boolean);
  const posts = [];
  let current = "";
  const push = () => {
    if (current) posts.push(current);
    current = "";
  };
  for (const piece of pieces) {
    const units = piece.length <= limit ? [piece] : piece.split(/\s+/).flatMap((w) => (w.length <= limit ? [w] : w.match(new RegExp(`.{1,${limit}}`, "g"))));
    for (const unit of units) {
      const next = current ? `${current} ${unit}` : unit;
      if (next.length <= limit) current = next;
      else {
        push();
        current = unit;
      }
    }
    if (units.length > 1) push();
  }
  push();
  return posts;
}

export function xThread({ caption, highlights = [], url }) {
  const posts = splitPost(caption, X_BODY);
  let list = "what's inside:";
  for (const item of highlights) if (`${list}\n• ${item}`.length <= X_BODY) list += `\n• ${item}`;
  if (highlights.length && list.includes("•")) posts.push(list);
  if (url) posts.push(`try it: ${url}`);
  return posts;
}

export function linkedinPost({ caption, highlights = [], url }) {
  return [String(caption).trim(), highlights.length ? highlights.map((h) => `→ ${h}`).join("\n") : null, url ?? null].filter(Boolean).join("\n\n");
}

export function productHuntCopy({ title, caption, highlights = [] }) {
  const firstSentence = String(caption).trim().match(/^[^.!?]+[.!?]?/)?.[0].replace(/[.!?]$/, "") ?? "";
  const extra = highlights.length ? ` Highlights: ${highlights.join(", ")}.` : "";
  return { name: title, tagline: clip(firstSentence, PH_TAGLINE), description: clip(`${String(caption).trim()}${extra}`, PH_DESCRIPTION) };
}

export function embedSnippets({ video, poster, title = "launch video" }) {
  return {
    markdown: `[![${title}](${poster})](${video})`,
    html: `<video src="${escapeHtml(video)}" poster="${escapeHtml(poster)}" autoplay muted loop playsinline controls preload="metadata" aria-label="${escapeHtml(title)}" style="width: 100%; height: auto; border-radius: 12px;"></video>`,
  };
}

export function creditsFor(compositionHtml) {
  const sources = [...String(compositionHtml ?? "").matchAll(/\bsrc="([^"]+)"/g)].map((m) => m[1]);
  const lines = [];
  const tracks = [...new Set(sources.map((s) => s.match(/happy-beats-business-moves-vol-(\d+)-by-ende-dot-app/)?.[1]).filter(Boolean))];
  // CC BY 4.0 asks for author + licence, not just a link. ende.app waives credit as a courtesy;
  // the licence still requires it, and a paid product should not lean on a waiver.
  for (const vol of tracks) {
    lines.push(`Music: "Happy Beats & Business Moves Vol. ${vol}" by Sascha Ende — ende.app, CC BY 4.0 (https://ende.app/en/standard-license)`);
  }
  const sfx = new Set(sources.filter((s) => /(^|\/)sfx\//.test(s)));
  if (sfx.size) lines.push(`Sound effects: ${sfx.size} sound effect${sfx.size === 1 ? "" : "s"} by Kenney (https://kenney.nl/), CC0`);
  lines.push("Made with /shipreel (https://github.com/irvinosazee/shipreel) and Hyperframes (https://hyperframes.heygen.com/)");
  return `${lines.join("\n")}\n`;
}

function readIf(file) {
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

function variantFor(variants, pattern) {
  const key = Object.keys(variants).find((label) => pattern.test(label));
  return key ? variants[key].caption : null;
}

export function buildLaunchKit(outputDir, { url, title, highlights, zip = true } = {}) {
  const dir = path.resolve(outputDir);
  const video = path.join(dir, "shipreel.mp4");
  const poster = path.join(dir, "shipreel.jpg");
  if (!existsSync(video) || !existsSync(poster)) throw new Error(`${dir} needs shipreel.mp4 and shipreel.jpg; finish the render first.`);

  const kit = path.join(dir, "launch-kit");
  rmSync(kit, { recursive: true, force: true });
  const files = [];
  const put = (rel, source) => {
    const target = path.join(kit, rel);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
    files.push(rel);
  };
  const write = (rel, text) => {
    const target = path.join(kit, rel);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, text.endsWith("\n") ? text : `${text}\n`);
    files.push(rel);
  };

  put("videos/shipreel.mp4", video);
  for (const entry of readdirSync(dir)) if (/^shipreel-[\w-]+\.mp4$/.test(entry)) put(`videos/${entry}`, path.join(dir, entry));
  const exportsDir = path.join(dir, "exports");
  if (existsSync(exportsDir)) {
    for (const entry of readdirSync(exportsDir)) if (/\.(mp4|gif|webp)$/.test(entry)) put(`videos/${entry}`, path.join(exportsDir, entry));
  }

  put("images/poster.jpg", poster);
  const coversDir = path.join(dir, "covers");
  const haveCovers = ["og", "youtube", "reels-grid"].every((id) => existsSync(path.join(coversDir, `${id}.jpg`)));
  const covers = haveCovers ? ["og", "youtube", "reels-grid"].map((id) => ({ id, path: path.join(coversDir, `${id}.jpg`) })) : makeCovers(poster, { outDir: path.join(kit, ".covers") });
  for (const cover of covers) put(`images/${cover.id}.jpg`, cover.path);
  rmSync(path.join(kit, ".covers"), { recursive: true, force: true });

  // Launch cards from `shipreel images` (cards.mjs), when the run has them.
  const cardsDir = path.join(dir, "cards");
  if (existsSync(path.join(cardsDir, "cards.json"))) {
    for (const card of JSON.parse(readFileSync(path.join(cardsDir, "cards.json"), "utf8"))) put(`images/cards/${card.file}`, path.join(cardsDir, card.file));
    if (existsSync(path.join(cardsDir, "linkedin-carousel.pdf"))) put("images/cards/linkedin-carousel.pdf", path.join(cardsDir, "linkedin-carousel.pdf"));
  }

  const scenesPath = path.join(dir, "scenes.json");
  const times = existsSync(scenesPath) ? loadScenes(scenesPath).map(stillTime).slice(0, MAX_GALLERY) : [];
  // Product Hunt's gallery is landscape: use a landscape render when the run has one.
  const galleryVideo = [path.join(dir, "shipreel-landscape.mp4"), video].find(existsSync);
  const galleryTmp = path.join(kit, ".gallery");
  mkdirSync(galleryTmp, { recursive: true });
  times.forEach((time, i) => {
    const frame = path.join(galleryTmp, `frame-${i + 1}.png`);
    const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(time), "-i", galleryVideo, "-frames:v", "1", frame], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`Could not extract the ${time}s frame: ${result.stderr.trim()}`);
    const target = path.join(kit, "images", `producthunt-${i + 1}.jpg`);
    fitImage(frame, target, PH_SIZE);
    files.push(path.relative(kit, target));
  });
  rmSync(galleryTmp, { recursive: true, force: true });

  const brand = JSON.parse(readIf(path.join(dir, "..", ".shipreel", "config.json")) ?? "{}");
  const link = url ?? brand.url ?? null;
  const name = title ?? brand.name ?? path.basename(path.resolve(dir, ".."));
  const card = JSON.parse(readIf(path.join(dir, "composition", "card.json")) ?? "null");
  const points = highlights ?? card?.content?.highlights?.items ?? [];

  const caption = (readIf(path.join(dir, "share-copy.txt")) ?? "").trim();
  if (!caption) throw new Error(`${dir}/share-copy.txt is missing or empty; write the share copy first.`);
  const variants = parseShareVariants(readIf(path.join(dir, "share-copy-variants.md")));
  put("copy/share-copy.txt", path.join(dir, "share-copy.txt"));
  const thread = xThread({ caption: variantFor(variants, /^(x|twitter)\b/i) ?? caption, highlights: points, url: link });
  write("copy/x-thread.txt", thread.map((post, i) => `${i + 1}/${thread.length}\n${post}`).join("\n\n"));
  write("copy/linkedin.txt", linkedinPost({ caption: variantFor(variants, /linkedin/i) ?? caption, highlights: points, url: link }));
  const ph = productHuntCopy({ title: name, caption: variantFor(variants, /product\s*hunt/i) ?? caption, highlights: points });
  write("copy/producthunt.txt", `Name: ${ph.name}\nTagline: ${ph.tagline}\n\nDescription:\n${ph.description}\n\nGallery: images/producthunt-*.jpg (1270x760), thumbnail: images/og.jpg`);

  const embed = embedSnippets({ video: "shipreel.mp4", poster: "shipreel.jpg", title: `${name} launch video` });
  write("embed/readme-snippet.md", `${embed.markdown}\n\nCopy shipreel.mp4 and shipreel.jpg next to your README (or drag shipreel.mp4 into a GitHub README edit to upload it and use the returned URL).`);
  write("embed/video.html", embed.html);
  write("credits.txt", creditsFor(readIf(path.join(dir, "composition", "index.html"))));

  write(
    "README.md",
    [
      `# ${name} launch kit`,
      "",
      "| Folder | What | Where it goes |",
      "| --- | --- | --- |",
      "| `videos/` | the main video, per-format renders, per-platform exports | upload `shipreel-<platform>.mp4` to that platform; `shipreel.mp4` everywhere else |",
      "| `images/` | poster, link preview, thumbnail, Instagram grid, Product Hunt gallery | custom thumbnail fields, og:image, Product Hunt media |",
      "| `images/cards/` | launch cards from `shipreel images`: og, X, GitHub social preview, Product Hunt gallery, LinkedIn carousel (+ PDF) | og:image, the X post, the repo's social preview, Product Hunt media, a LinkedIn document post |",
      "| `copy/` | captions, an X thread, a LinkedIn post, Product Hunt text | paste as-is; each is already within the platform's limits |",
      "| `embed/` | README and HTML snippets | the project's README and landing page |",
      "| `credits.txt` | music, sound effects, tools | the video description where credits are expected |",
      "",
      link ? `Link used in the copy: ${link}` : "No link was set; pass --url or add `url` to .shipreel/config.json to include one.",
      "",
      `${files.length + 1} files. Nothing here has been posted.`,
    ].join("\n"),
  );

  // Check the copy this kit just wrote against each platform's rules (copy_check.mjs).
  const claims = JSON.parse(readIf(path.join(dir, "claims.json")) ?? "[]");
  const copyReport = checkCopyDir(path.join(kit, "copy"), { claims, brand });

  let zipPath = null;
  if (zip) {
    zipPath = path.join(dir, "launch-kit.zip");
    rmSync(zipPath, { force: true });
    const result = spawnSync("zip", ["-qr", zipPath, "launch-kit"], { cwd: dir, encoding: "utf8" });
    if (result.error || result.status !== 0) zipPath = null;
  }
  return { kit, zip: zipPath, files: files.sort(), copy: copyReport };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const [dir, ...rest] = process.argv.slice(2);
  const flag = (name) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined);
  if (!dir) {
    console.error('Usage: launch_kit.mjs <output-dir> [--url https://…] [--title name] [--highlights "a|b|c"] [--no-zip]');
    process.exitCode = 2;
  } else {
    try {
      const result = buildLaunchKit(dir, {
        url: flag("--url"),
        title: flag("--title"),
        highlights: flag("--highlights")?.split("|").map((s) => s.trim()).filter(Boolean),
        zip: !rest.includes("--no-zip"),
      });
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
