#!/usr/bin/env node
/**
 * Brag Studio: a local review page for a finished run.
 *
 *   node <skill-root>/scripts/studio.mjs serve <output-dir> [--port 4318]
 *   node <skill-root>/scripts/studio.mjs build <output-dir>     # static studio.html, notes download as a file
 *
 * Shows every render side by side (brag.mp4 plus brag-<format>.mp4), the storyboard from
 * scenes.json synced to playback (click a scene to seek every video), share copy with
 * copy buttons, saved versions, and a notes box per scene. With `serve`, notes save to
 * <output-dir>/feedback.json so the next /brag re-roll can read them. The server binds
 * to 127.0.0.1 only and serves nothing outside the output directory.
 */

import { createReadStream, existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { listVersions } from "./versions.mjs";

const TYPES = { ".html": "text/html; charset=utf-8", ".mp4": "video/mp4", ".jpg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".json": "application/json", ".md": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".srt": "text/plain; charset=utf-8", ".vtt": "text/vtt", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf", ".ico": "image/x-icon", ".jpeg": "image/jpeg", ".avif": "image/avif", ".webm": "video/webm", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".xml": "application/xml", ".webmanifest": "application/manifest+json" };
const MAX_FEEDBACK_BYTES = 256 * 1024;

const escapeHtml = (text) => String(text ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const readJson = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback);
const clock = (seconds) => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;

export function findRenders(dir) {
  const files = readdirSync(dir).filter((name) => /^brag(-[a-z]+)?\.mp4$/.test(name) && !/draft|poster|mastered/.test(name));
  return files
    .map((file) => ({ file, label: file === "brag.mp4" ? "primary" : file.replace(/^brag-|\.mp4$/g, "") }))
    .sort((a, b) => (a.file === "brag.mp4" ? -1 : b.file === "brag.mp4" ? 1 : a.file.localeCompare(b.file)));
}

export function buildStudioPage({ title, renders, scenes = [], shareCopy = "", versions = [], feedback = { notes: {} }, mode = "serve" }) {
  const videos = renders
    .map((render) => {
      const poster = render.file === "brag.mp4" ? "brag.jpg" : render.file.replace(/\.mp4$/, ".jpg");
      return `<figure class="render"><video src="${escapeHtml(render.file)}" poster="${escapeHtml(poster)}" controls preload="metadata" playsinline></video><figcaption>${escapeHtml(render.label)}</figcaption></figure>`;
    })
    .join("");
  const storyboard = scenes
    .map((scene) => `
        <li class="scene" data-start="${scene.start}" data-end="${scene.end}">
          <button type="button" class="seek"><span class="time">${clock(scene.start)}–${clock(scene.end)}</span> <strong>${escapeHtml(scene.name)}</strong> <span class="role">${escapeHtml(scene.role ?? "")}</span></button>
          <textarea data-scene="${escapeHtml(scene.name)}" rows="2" placeholder="Notes for a re-roll…">${escapeHtml(feedback.notes?.[scene.name] ?? "")}</textarea>
        </li>`)
    .join("");
  const versionCards = versions
    .map((v) => `<figure class="version"><img src="versions/v${v.version}/sheet.jpg" alt="Version ${v.version} scene stills" /><figcaption>v${v.version} · ${escapeHtml(v.label)} · ${v.duration}s${v.warnings?.length ? ` · ⚠ ${escapeHtml(v.warnings.join("; "))}` : ""}</figcaption></figure>`)
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Brag Studio · ${escapeHtml(title)}</title>
    <style>
      :root { --bg: #f6f2ee; --panel: #ffffff; --ink: #1d1612; --soft: #6e6058; --rule: #e5dcd4; --accent: #d9481c; --active: #fff0e8; }
      @media (prefers-color-scheme: dark) { :root { --bg: #110b09; --panel: #1b1310; --ink: #f5eee8; --soft: #b0a197; --rule: #32251e; --accent: #ff7a4d; --active: #2a1a12; } }
      * { box-sizing: border-box; }
      body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif; }
      main { max-width: 1280px; margin: 0 auto; padding: 32px 16px 64px; }
      h1 { margin: 0; font-size: 28px; letter-spacing: -0.02em; } h2 { font-size: 18px; margin: 32px 0 12px; }
      .lede { color: var(--soft); margin: 4px 0 24px; }
      .renders { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; }
      .render { margin: 0; } .render video { display: block; max-height: 62vh; max-width: 100%; border-radius: 12px; background: #000; }
      figcaption { color: var(--soft); font-size: 13px; margin-top: 6px; }
      .layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; }
      @media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }
      ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
      .scene { background: var(--panel); border: 1px solid var(--rule); border-radius: 12px; padding: 10px 12px; }
      .scene.active { background: var(--active); border-color: var(--accent); }
      .seek { all: unset; cursor: pointer; display: block; width: 100%; }
      .time { font-family: ui-monospace, monospace; color: var(--soft); font-size: 13px; } .role { color: var(--soft); font-size: 13px; }
      textarea { width: 100%; margin-top: 8px; font: inherit; color: inherit; background: var(--bg); border: 1px solid var(--rule); border-radius: 8px; padding: 6px 8px; resize: vertical; }
      pre { white-space: pre-wrap; background: var(--panel); border: 1px solid var(--rule); border-radius: 12px; padding: 12px; margin: 0; font: 14px/1.5 ui-monospace, monospace; }
      button.action { font: inherit; padding: 6px 14px; border-radius: 8px; border: 1px solid var(--rule); background: var(--panel); color: var(--ink); cursor: pointer; margin-top: 10px; }
      .status { color: var(--soft); margin-left: 8px; }
      .versions { display: flex; flex-wrap: wrap; gap: 16px; } .version { margin: 0; max-width: 100%; } .version img { max-width: 100%; max-height: 180px; border-radius: 8px; border: 1px solid var(--rule); }
    </style>
  </head>
  <body>
    <main>
      <h1>Brag Studio</h1>
      <p class="lede">${escapeHtml(title)} · click a scene to seek every render; notes save for the next re-roll.</p>
      <section class="renders">${videos}</section>
      <div class="layout">
        <section>
          <h2>Storyboard</h2>
          <ol>${storyboard}</ol>
          <button type="button" class="action" id="save">Save notes</button><span class="status" id="status"></span>
        </section>
        <section>
          <h2>Share copy</h2>
          <pre id="share">${escapeHtml(shareCopy)}</pre>
          <button type="button" class="action" data-copy="share">Copy</button>
          ${versionCards ? `<h2>Versions</h2><div class="versions">${versionCards}</div>` : ""}
        </section>
      </div>
    </main>
    <script>
      const videos = [...document.querySelectorAll("video")];
      const scenes = [...document.querySelectorAll(".scene")];
      for (const scene of scenes) {
        scene.querySelector(".seek").addEventListener("click", () => {
          for (const video of videos) video.currentTime = Number(scene.dataset.start);
        });
      }
      if (videos[0]) {
        videos[0].addEventListener("timeupdate", () => {
          const t = videos[0].currentTime;
          for (const scene of scenes) scene.classList.toggle("active", t >= Number(scene.dataset.start) && t < Number(scene.dataset.end));
        });
      }
      document.querySelector("[data-copy]")?.addEventListener("click", async (event) => {
        await navigator.clipboard.writeText(document.getElementById("share").textContent);
        event.target.textContent = "Copied";
      });
      document.getElementById("save").addEventListener("click", async () => {
        const notes = Object.fromEntries([...document.querySelectorAll("textarea[data-scene]")].map((t) => [t.dataset.scene, t.value]));
        const body = JSON.stringify({ notes }, null, 2);
        const status = document.getElementById("status");
        try {
          if (${JSON.stringify(mode)} !== "serve") throw new Error("static");
          const response = await fetch("feedback", { method: "POST", headers: { "content-type": "application/json" }, body });
          if (!response.ok) throw new Error(await response.text());
          status.textContent = "Saved to feedback.json";
        } catch {
          const link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([body], { type: "application/json" })), download: "feedback.json" });
          link.click();
          status.textContent = "Downloaded feedback.json — put it in the output folder";
        }
      });
    </script>
  </body>
</html>
`;
}

function pageFor(dir, mode) {
  return buildStudioPage({
    title: path.basename(path.resolve(dir)),
    renders: findRenders(dir),
    scenes: readJson(path.join(dir, "scenes.json"), []),
    shareCopy: existsSync(path.join(dir, "share-copy.txt")) ? readFileSync(path.join(dir, "share-copy.txt"), "utf8").trim() : "",
    versions: listVersions(dir),
    feedback: readJson(path.join(dir, "feedback.json"), { notes: {} }),
    mode,
  });
}

export function serveFile(root, request, response) {
  let rel;
  try {
    rel = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  } catch {
    response.writeHead(400).end();
    return;
  }
  const file = path.resolve(root, `.${rel}`);
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404).end("Not found");
    return;
  }
  const size = statSync(file).size;
  const type = TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  // A read can fail after the stat succeeded (permissions, a cloud placeholder that times out);
  // answer 500 instead of letting the stream error crash the server.
  const send = (status, headers, options) => {
    const stream = createReadStream(file, options);
    stream.once("open", () => {
      response.writeHead(status, headers);
      stream.pipe(response);
    });
    stream.once("error", () => {
      if (!response.headersSent) response.writeHead(500, { "Content-Type": "text/plain" }).end("Could not read file");
      else response.destroy();
    });
  };
  const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? "");
  if (match) {
    const start = match[1] === "" ? Math.max(0, size - Number(match[2])) : Number(match[1]);
    const end = match[1] !== "" && match[2] !== "" ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      response.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
      return;
    }
    send(206, { "Content-Type": type, "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes" }, { start, end });
    return;
  }
  send(200, { "Content-Type": type, "Content-Length": size, "Accept-Ranges": "bytes" });
}

export function startStudio(dir, { port = 4318, host = "127.0.0.1" } = {}) {
  const root = path.resolve(dir);
  const server = http.createServer((request, response) => {
    if (request.method === "POST" && request.url === "/feedback") {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
        if (body.length > MAX_FEEDBACK_BYTES) request.destroy();
      });
      request.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          if (typeof parsed !== "object" || typeof parsed.notes !== "object") throw new Error("expected { notes: {...} }");
          const notes = Object.fromEntries(Object.entries(parsed.notes).map(([scene, text]) => [String(scene), String(text)]));
          writeFileSync(path.join(root, "feedback.json"), `${JSON.stringify({ notes }, null, 2)}\n`);
          response.writeHead(200, { "Content-Type": "application/json" }).end('{"saved":true}');
        } catch (error) {
          response.writeHead(400, { "Content-Type": "text/plain" }).end(`Bad feedback: ${error.message}`);
        }
      });
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405).end();
      return;
    }
    if (request.url === "/" || request.url === "/index.html") {
      response.writeHead(200, { "Content-Type": TYPES[".html"] }).end(pageFor(root, "serve"));
      return;
    }
    serveFile(root, request, response);
  });
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      resolve({ url: `http://${host}:${server.address().port}/`, close: () => new Promise((done) => server.close(done)) });
    });
  });
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const [command, dir, ...rest] = process.argv.slice(2);
  if (!["serve", "build"].includes(command) || !dir || !existsSync(dir)) {
    console.error("Usage: studio.mjs serve|build <output-dir> [--port 4318]");
    process.exitCode = 2;
  } else if (command === "build") {
    const target = path.join(dir, "studio.html");
    writeFileSync(target, pageFor(dir, "static"));
    console.log(target);
  } else {
    const port = rest.includes("--port") ? Number(rest[rest.indexOf("--port") + 1]) : 4318;
    startStudio(dir, { port }).then(({ url }) => console.log(`Brag Studio: ${url}  (Ctrl+C to stop)`));
  }
}
