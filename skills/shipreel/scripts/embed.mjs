#!/usr/bin/env node
/**
 * Embed the shipreel in the project's own site: a reviewable patch, or --apply to make the change.
 *
 *   node <skill-root>/scripts/embed.mjs <project-dir> --video shipreel-output/shipreel.mp4 --poster shipreel-output/shipreel.jpg \
 *        [--patch shipreel-output/embed.patch] [--title "horse tinder launch video"] [--apply]
 *
 * Finds the landing page (Next.js app/ or pages/, Astro, SvelteKit, a Vite/CRA App, Vue, a plain
 * index.html, then README.md), follows its local imports up to two levels to the component that
 * renders the first <h1>, and inserts an autoplaying, muted, looping <video> with the poster right
 * after it (or at the start of <main>). Media goes to public/ (static/ for SvelteKit), beside a
 * plain HTML page (assets/ when it exists), or beside the README, which gets a poster image link
 * instead because GitHub does not autoplay video.
 *
 * Without --apply nothing in the project changes: the patch is written for `git apply`, and the
 * media files to copy are listed. The patch refuses a file that already embeds shipreel.mp4.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { placeholderFiles } from "./capture.mjs";

const SOURCE_EXTS = [".tsx", ".jsx", ".ts", ".js", ".astro", ".svelte", ".vue"];
const PAGE_CANDIDATES = [
  ...["app", "src/app"].flatMap((d) => [".tsx", ".jsx", ".js", ".ts"].map((e) => `${d}/page${e}`)),
  ...["pages", "src/pages"].flatMap((d) => [".tsx", ".jsx", ".js"].map((e) => `${d}/index${e}`)),
  "src/pages/index.astro",
  "src/routes/+page.svelte",
  "src/App.tsx",
  "src/App.jsx",
  "src/app.tsx",
  "src/app.jsx",
  "src/App.vue",
  "index.html",
  "docs/index.html",
  "public/index.html",
];
const IMPORT_DEPTH = 2;

const escapeHtml = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function kindOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".md") return "markdown";
  if ([".tsx", ".jsx", ".ts", ".js"].includes(ext)) return "jsx";
  return "html";
}

function snippet(kind, { src, poster, title }) {
  if (kind === "markdown") return `[![${title}](${poster})](${src})`;
  if (kind === "jsx") {
    return `<video src="${src}" poster="${poster}" autoPlay muted loop playsInline controls preload="metadata" aria-label="${escapeHtml(title)}" style={{ width: "100%", height: "auto", borderRadius: 12 }} />`;
  }
  return `<video src="${escapeHtml(src)}" poster="${escapeHtml(poster)}" autoplay muted loop playsinline controls preload="metadata" aria-label="${escapeHtml(title)}" style="width: 100%; height: auto; border-radius: 12px;"></video>`;
}

const indentAt = (source, index) => source.slice(source.lastIndexOf("\n", index - 1) + 1).match(/^[ \t]*/)[0];

/** Insert `text` on its own line after position `end`, indented with `indent`. */
function insertAfter(source, end, indent, text) {
  const lineEnd = source.indexOf("\n", end);
  const rest = source.slice(end, lineEnd === -1 ? source.length : lineEnd);
  if (!rest.trim()) {
    const at = lineEnd === -1 ? source.length : lineEnd;
    return `${source.slice(0, at)}\n${indent}${text}${source.slice(at)}`;
  }
  return `${source.slice(0, end)}\n${indent}${text}\n${indent}${source.slice(end).trimStart()}`;
}

export function insertVideo(source, kind, media) {
  const text = snippet(kind, media);
  if (kind === "markdown") {
    const lines = source.split("\n");
    const heading = lines.findIndex((line) => /^#\s+\S/.test(line));
    if (heading === -1) return `${text}\n\n${source}`;
    const after = lines[heading + 1] === "" ? heading + 1 : heading;
    return [...lines.slice(0, heading + 1), "", text, ...lines.slice(after)].join("\n");
  }
  const close = source.match(/<\/h1\s*>/i);
  if (close) {
    const open = source.toLowerCase().lastIndexOf("<h1", close.index);
    return insertAfter(source, close.index + close[0].length, indentAt(source, open === -1 ? close.index : open), text);
  }
  const main = source.match(/<main\b[^>]*>/i);
  if (main) {
    const end = main.index + main[0].length;
    const nextLine = source.slice(end).match(/\n([ \t]*)\S/);
    const indent = nextLine ? nextLine[1] : `${indentAt(source, main.index)}  `;
    return insertAfter(source, end, indent, text);
  }
  throw new Error("Found no <h1> or <main> to place the video after; add the snippet by hand.");
}

function readChecked(file) {
  if (placeholderFiles([file]).length) {
    throw new Error(`${file} is an iCloud placeholder that is not downloaded; reading it can hang. Download it first (Finder: Download Now, or: brctl download "${path.dirname(file)}").`);
  }
  return readFileSync(file, "utf8");
}

function resolveImport(root, from, specifier) {
  let base;
  if (specifier.startsWith("./") || specifier.startsWith("../")) base = path.resolve(path.dirname(from), specifier);
  else if (/^[@~]\//.test(specifier)) base = [path.join(root, specifier.slice(2)), path.join(root, "src", specifier.slice(2))].find((p) => SOURCE_EXTS.some((e) => existsSync(p + e)) || existsSync(p)) ?? path.join(root, specifier.slice(2));
  else return null;
  const options = [base, ...SOURCE_EXTS.map((e) => base + e), ...SOURCE_EXTS.map((e) => path.join(base, `index${e}`))];
  return options.find((p) => existsSync(p) && statSync(p).isFile() && SOURCE_EXTS.includes(path.extname(p))) ?? null;
}

/** The first file, from `start` through its local imports, that renders an <h1>. */
function findHeading(root, start) {
  const seen = new Set();
  let level = [start];
  for (let depth = 0; depth <= IMPORT_DEPTH && level.length; depth += 1) {
    const next = [];
    for (const file of level) {
      if (seen.has(file)) continue;
      seen.add(file);
      const source = readChecked(file);
      if (/<\/h1\s*>/i.test(source)) return file;
      for (const match of source.matchAll(/import\s+(?:[^'"]+?\s+from\s+)?["']([^"']+)["']/g)) {
        const resolved = resolveImport(root, file, match[1]);
        if (resolved) next.push(resolved);
      }
    }
    level = next;
  }
  return null;
}

export function findEmbedTarget(projectDir) {
  const root = path.resolve(projectDir);
  const pkgPath = path.join(root, "package.json");
  const pkg = existsSync(pkgPath) ? JSON.parse(readChecked(pkgPath)) : {};
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const has = (name, configs = []) => Boolean(deps[name]) || configs.some((c) => existsSync(path.join(root, c)));
  let publicDir = null;
  if (has("@sveltejs/kit", ["svelte.config.js"])) publicDir = "static";
  else if (has("next", ["next.config.js", "next.config.mjs", "next.config.ts"]) || has("vite", ["vite.config.js", "vite.config.ts", "vite.config.mjs"]) || has("astro", ["astro.config.mjs"]) || has("react-scripts")) publicDir = "public";

  for (const candidate of PAGE_CANDIDATES) {
    const page = path.join(root, candidate);
    if (!existsSync(page)) continue;
    const kind = kindOf(page);
    if (publicDir && kind === "html" && path.extname(page) === ".html") continue;
    const file = findHeading(root, page) ?? (/<main\b/i.test(readChecked(page)) ? page : null);
    if (!file) continue;
    if (publicDir) return { file, kind: kindOf(file), mediaDir: path.join(root, publicDir), src: "/shipreel.mp4", poster: "/shipreel.jpg" };
    const assets = path.join(path.dirname(file), "assets");
    const useAssets = existsSync(assets) && statSync(assets).isDirectory();
    return { file, kind: kindOf(file), mediaDir: useAssets ? assets : path.dirname(file), src: useAssets ? "assets/shipreel.mp4" : "shipreel.mp4", poster: useAssets ? "assets/shipreel.jpg" : "shipreel.jpg" };
  }
  const readme = ["README.md", "readme.md", "Readme.md"].map((f) => path.join(root, f)).find(existsSync);
  if (readme) return { file: readme, kind: "markdown", mediaDir: root, src: "shipreel.mp4", poster: "shipreel.jpg" };
  throw new Error(`Could not find a landing page or README in ${root} to embed the video in.`);
}

export function makeEmbedPatch(projectDir, { video, poster, patchPath, apply = false, title = "launch video" }) {
  const root = path.resolve(projectDir);
  for (const file of [video, poster]) if (!existsSync(file)) throw new Error(`${file} does not exist.`);
  const target = findEmbedTarget(root);
  const before = readChecked(target.file);
  if (before.includes("shipreel.mp4")) throw new Error(`${path.relative(root, target.file)} already embeds shipreel.mp4.`);
  const after = insertVideo(before, target.kind, { src: target.src, poster: target.poster, title });

  const rel = path.relative(root, target.file).split(path.sep).join("/");
  const tmp = `${patchPath}.after`;
  writeFileSync(tmp, after);
  const diff = spawnSync("diff", ["-u", "-L", `a/${rel}`, "-L", `b/${rel}`, target.file, tmp], { encoding: "utf8" });
  spawnSync("rm", ["-f", tmp]);
  if (diff.status !== 1) throw new Error(`diff failed: ${diff.stderr.trim()}`);
  mkdirSync(path.dirname(path.resolve(patchPath)), { recursive: true });
  writeFileSync(patchPath, diff.stdout);

  const media = [
    { from: path.resolve(video), to: path.join(target.mediaDir, "shipreel.mp4") },
    { from: path.resolve(poster), to: path.join(target.mediaDir, "shipreel.jpg") },
  ];
  if (apply) {
    writeFileSync(target.file, after);
    mkdirSync(target.mediaDir, { recursive: true });
    for (const { from, to } of media) copyFileSync(from, to);
  }
  return { file: target.file, kind: target.kind, patch: path.resolve(patchPath), media: media.map(({ from, to }) => ({ from, to: path.relative(root, to) })), applied: apply };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const [dir, ...rest] = process.argv.slice(2);
  const flag = (name, fallback) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : fallback);
  if (!dir || !flag("--video") || !flag("--poster")) {
    console.error('Usage: embed.mjs <project-dir> --video shipreel.mp4 --poster shipreel.jpg [--patch embed.patch] [--title "…"] [--apply]');
    process.exitCode = 2;
  } else {
    try {
      const result = makeEmbedPatch(dir, {
        video: flag("--video"),
        poster: flag("--poster"),
        patchPath: flag("--patch", path.join(path.dirname(path.resolve(flag("--video"))), "embed.patch")),
        title: flag("--title", "launch video"),
        apply: rest.includes("--apply"),
      });
      console.log(JSON.stringify(result, null, 2));
      if (!result.applied) {
        console.error(`\nReview ${result.patch}, then from ${path.resolve(dir)}: git apply ${result.patch} and copy ${result.media.map((m) => `${m.from} → ${m.to}`).join(", ")} (or rerun with --apply).`);
      }
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
