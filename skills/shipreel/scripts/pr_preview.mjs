#!/usr/bin/env node
/**
 * PR preview videos: a short before/after clip of the pages a pull request changes.
 *
 *   node <skill-root>/scripts/pr_preview.mjs --base https://myapp.com --head https://pr-42.preview.app \
 *        --out shipreel-pr/ [--routes /,/pricing | --changed-files changed.txt] [--viewport 1280x800] [--gif-url URL] [--video-url URL]
 *   node <skill-root>/scripts/pr_preview.mjs --base-dir ../main-checkout --head-dir . --changed-files changed.txt --out shipreel-pr/
 *
 * Routes come from --routes, or from the changed files (Next.js app/ and pages/, Astro, SvelteKit,
 * and HTML pages map to their URLs; any other UI file maps to "/"; docs and config map to nothing).
 * Each route is captured on both deployments at the same viewport, scored with SSIM (below 0.995 is
 * a visible change), and every changed route becomes a labeled before | after card: 3s each, at most
 * three, so the clip stays under 10s. Writes preview.mp4, preview.gif, routes.json, and comment.md,
 * a pull-request comment with a hidden marker so a workflow can update it instead of piling up.
 * Nothing is posted; the workflow template in assets/github/ does that with the repository's token.
 */

import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { capturePages, startProject } from "./capture.mjs";

export const MARKER = "<!-- shipreel:pr-preview -->";
const MAX_ROUTES = 3;
const CHANGED_BELOW = 0.995;
const SECONDS_PER_ROUTE = 3;
const UI_FILE = /\.(tsx|jsx|ts|js|mjs|vue|svelte|astro|html|css|scss|sass|less|mdx)$/;
const NOT_UI = /(^|\/)(api|__tests__|tests?|scripts|\.github)\/|\.(test|spec|stories)\.|(^|\/)[^/]*\.config\.[^/]+$|(^|\/)(middleware|instrumentation)\.[jt]s$/;

const escapeHtml = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function routeFromSegments(segments) {
  const kept = segments.filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith("@"));
  if (kept.some((s) => s.includes("["))) return "/";
  return `/${kept.join("/")}`;
}

export function changedRoutes(files, max = MAX_ROUTES) {
  const routes = [];
  for (const raw of files) {
    const file = raw.trim().replace(/\\/g, "/").replace(/^\.\//, "");
    if (!file || !UI_FILE.test(file) || NOT_UI.test(file)) continue;
    let route = "/";
    let match;
    if ((match = file.match(/^(?:src\/)?app\/(?:(.*)\/)?page\.(?:tsx|jsx|js|ts|mdx)$/))) {
      route = routeFromSegments((match[1] ?? "").split("/"));
    } else if ((match = file.match(/^(?:src\/)?pages\/(.+)\.(?:tsx|jsx|js|ts|mdx|astro)$/))) {
      const segments = match[1].split("/");
      if (segments.at(-1).startsWith("_")) route = "/";
      else {
        if (segments.at(-1) === "index") segments.pop();
        route = routeFromSegments(segments);
      }
    } else if ((match = file.match(/^src\/routes\/(?:(.*)\/)?\+page\.svelte$/))) {
      route = routeFromSegments((match[1] ?? "").split("/"));
    } else if (file.endsWith(".html")) {
      const rel = file.replace(/^public\//, "");
      route = path.posix.basename(rel) === "index.html" ? `/${path.posix.dirname(rel) === "." ? "" : `${path.posix.dirname(rel)}/`}` : `/${rel}`;
    }
    if (!routes.includes(route)) routes.push(route);
  }
  return routes.slice(0, max);
}

export function commentBody({ routes, videoUrl, gifUrl }) {
  const changed = routes.filter((r) => r.changed);
  return [
    MARKER,
    "### /shipreel preview",
    "",
    gifUrl ? `![before and after](${gifUrl})\n` : null,
    changed.length ? `${changed.length} of ${routes.length} page${routes.length === 1 ? "" : "s"} ${changed.length === 1 ? "looks" : "look"} different in this pull request.` : "No visible change on the pages this pull request touches.",
    "",
    "| Page | Result | SSIM |",
    "| --- | --- | --- |",
    ...routes.map((r) => `| \`${r.route}\` | ${r.changed ? "changed" : "no visible change"} | ${r.ssim.toFixed(3)} |`),
    "",
    videoUrl ? `Download the [before/after clip](${videoUrl}).` : null,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

export function compareHtml({ route, before, after, size: [width, height] }) {
  const pane = Math.floor((width - 72) / 2);
  return `<!doctype html>
<html><head><meta charset="utf-8" /><style>
  * { margin: 0; box-sizing: border-box; }
  body { width: ${width}px; height: ${height}px; background: #0f0d15; color: #f5f1ea; font-family: sans-serif; padding: 24px; display: flex; flex-direction: column; gap: 16px; }
  header { display: flex; justify-content: space-between; font-size: 22px; font-weight: 700; }
  header .route { font-family: monospace; color: #ff6b3d; }
  .panes { display: flex; gap: 24px; flex: 1; min-height: 0; align-items: center; }
  figure { width: ${pane}px; max-height: 100%; display: flex; flex-direction: column; gap: 10px; min-height: 0; }
  figure span { font-size: 18px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #b9b2a8; }
  figure.after span { color: #ff6b3d; }
  figure div { min-height: 0; border-radius: 12px; overflow: hidden; background: #1c1924; }
  img { width: 100%; height: auto; max-height: ${height - 130}px; object-fit: cover; object-position: top; display: block; }
</style></head><body>
  <header><span class="route">${escapeHtml(route)}</span><span>/shipreel preview</span></header>
  <div class="panes">
    <figure class="before"><span>before</span><div><img src="${escapeHtml(before)}" alt="" /></div></figure>
    <figure class="after"><span>after</span><div><img src="${escapeHtml(after)}" alt="" /></div></figure>
  </div>
</body></html>
`;
}

function ffmpeg(args) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr.trim().split("\n").slice(-2).join(" ")}`);
}

function ssim(a, b) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-i", a, "-i", b, "-filter_complex", "[0:v]scale=640:400,setsar=1[x];[1:v]scale=640:400,setsar=1[y];[x][y]ssim", "-f", "null", "-"], { encoding: "utf8" });
  return Number(result.stderr.match(/All:([\d.]+)/)?.[1] ?? 0);
}

export async function buildPreview({ baseUrl, headUrl, routes, outDir, viewport = [1280, 800], size = [1280, 720], videoUrl, gifUrl }) {
  if (!routes.length) throw new Error("No routes to preview.");
  const out = path.resolve(outDir);
  mkdirSync(out, { recursive: true });
  const before = await capturePages(baseUrl, { routes, viewport, outDir: path.join(out, "before") });
  const after = await capturePages(headUrl, { routes, viewport, outDir: path.join(out, "after") });

  const scored = routes.map((route, i) => {
    const score = ssim(before[i].screenshot, after[i].screenshot);
    return { route, ssim: Math.round(score * 1000) / 1000, changed: score < CHANGED_BELOW, before: before[i].screenshot, after: after[i].screenshot };
  });
  const shown = (scored.some((r) => r.changed) ? scored.filter((r) => r.changed) : scored.slice(0, 1)).slice(0, MAX_ROUTES);

  const cardsDir = path.join(out, "cards");
  mkdirSync(cardsDir, { recursive: true });
  shown.forEach((r, i) => {
    writeFileSync(path.join(cardsDir, `compare-${i}.html`), compareHtml({ route: r.route, before: pathToFileURL(r.before).href, after: pathToFileURL(r.after).href, size }));
  });
  const cards = await capturePages(pathToFileURL(`${cardsDir}/`).href, { routes: shown.map((_, i) => `compare-${i}.html`), viewport: size, outDir: cardsDir });

  const video = path.join(out, "preview.mp4");
  const inputs = cards.flatMap((card) => ["-loop", "1", "-t", String(SECONDS_PER_ROUTE), "-framerate", "30", "-i", card.screenshot]);
  const chain = cards.map((_, i) => `[${i}:v]scale=${size[0]}:${size[1]},setsar=1,format=yuv420p[v${i}]`).join(";");
  const concat = `${cards.map((_, i) => `[v${i}]`).join("")}concat=n=${cards.length}:v=1:a=0[out]`;
  ffmpeg([...inputs, "-filter_complex", `${chain};${concat}`, "-map", "[out]", "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", video]);
  const gif = path.join(out, "preview.gif");
  ffmpeg(["-i", video, "-vf", "fps=6,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer", gif]);

  const routesReport = scored.map(({ route, ssim: s, changed }) => ({ route, ssim: s, changed }));
  const body = commentBody({ routes: routesReport, videoUrl, gifUrl });
  writeFileSync(path.join(out, "routes.json"), `${JSON.stringify(routesReport, null, 2)}\n`);
  writeFileSync(path.join(out, "comment.md"), `${body}\n`);
  return { routes: routesReport, video, gif, body, comment: path.join(out, "comment.md") };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const servers = [];
  try {
    const out = flag("--out");
    if (!out || !(flag("--base") || flag("--base-dir")) || !(flag("--head") || flag("--head-dir"))) {
      console.error("Usage: pr_preview.mjs (--base URL | --base-dir DIR) (--head URL | --head-dir DIR) --out DIR [--routes /,/x | --changed-files FILE] [--viewport 1280x800]");
      process.exitCode = 2;
    } else {
      const routes = flag("--routes")
        ? flag("--routes").split(",").map((r) => r.trim()).filter(Boolean)
        : flag("--changed-files")
          ? changedRoutes(readFileSync(flag("--changed-files"), "utf8").split("\n"))
          : ["/"];
      if (!routes.length) {
        console.log(JSON.stringify({ routes: [], skipped: "no UI files changed" }));
      } else {
        const serve = async (url, dir) => {
          if (url) return url;
          const server = await startProject(dir);
          servers.push(server);
          return server.url;
        };
        const result = await buildPreview({
          baseUrl: await serve(flag("--base"), flag("--base-dir")),
          headUrl: await serve(flag("--head"), flag("--head-dir")),
          routes,
          outDir: out,
          viewport: (flag("--viewport") ?? "1280x800").split("x").map(Number),
          videoUrl: flag("--video-url"),
          gifUrl: flag("--gif-url"),
        });
        console.log(JSON.stringify({ routes: result.routes, video: result.video, gif: result.gif, comment: result.comment }, null, 2));
      }
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    for (const server of servers) await server.stop();
  }
}
