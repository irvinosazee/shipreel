#!/usr/bin/env node
/**
 * Capture the real UI: run the project, screenshot its routes, and record a scroll.
 *
 *   node <skill-root>/scripts/capture.mjs <project-dir> --out <composition-dir>/assets/capture \
 *        [--routes /,/pricing] [--viewport 1080x1920] [--scroll-frames 24]
 *
 * Starts the project's dev server (its `dev`/`start`/`preview` script, framework default port)
 * or, for a plain site, a built-in static server; waits until the URL answers; captures each
 * route at the video's viewport in headless Chrome; and writes scroll frames plus a
 * scroll-<route>.mp4. The server is always stopped afterwards. It never installs dependencies:
 * if node_modules is missing, it says so.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { withPage } from "./chrome.mjs";
import { serveFile } from "./studio.mjs";

const SCRIPTS = ["dev", "start", "preview", "serve"];
const NAVIGATION_TIMEOUT_MS = 30_000;
const PLACEHOLDER_SCAN_DEPTH = 4;
// After each scroll step, let scroll-triggered transitions (reveals, sticky headers) settle.
const SCROLL_SETTLE_MS = 350;
const PORTS = [["next", 3000], ["nuxt", 3000], ["astro", 4321], ["vite", 5173], ["@sveltejs/kit", 5173], ["react-scripts", 3000], ["gatsby", 8000], ["@remix-run/dev", 3000]];

export function detectDevCommand(dir) {
  const pkgFile = path.join(dir, "package.json");
  if (existsSync(pkgFile)) {
    const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
    const script = SCRIPTS.find((name) => pkg.scripts?.[name]);
    if (script) {
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const port = PORTS.find(([dep]) => deps[dep])?.[1] ?? 3000;
      return { kind: "npm", script, port };
    }
  }
  if (existsSync(path.join(dir, "index.html"))) return { kind: "static", port: 0 };
  throw new Error(`${dir} has no dev script and no index.html to capture.`);
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

export function parseServerUrl(text) {
  const match = String(text).replace(ANSI, "").match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d+\/?[^\s]*/);
  return match ? match[0].replace("0.0.0.0", "localhost") : null;
}

/** Files whose macOS flags mark them as iCloud placeholders (not downloaded) in `stat -f "%Sf %N"` output. */
export function parseStatFlags(output) {
  return String(output)
    .split("\n")
    .map((line) => line.match(/^(\S+) (.+)$/))
    .filter((match) => match && match[1].split(",").includes("dataless"))
    .map((match) => match[2]);
}

/** On macOS, list files that are cloud placeholders: reading them waits on a download and can hang a capture. */
function cloudPlaceholders(dir) {
  if (process.platform !== "darwin") return [];
  const files = [];
  const walk = (current, depth) => {
    if (depth > PLACEHOLDER_SCAN_DEPTH) return;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.isFile()) files.push(full);
    }
  };
  walk(dir, 0);
  return placeholderFiles(files);
}

/** The files in `files` that are iCloud placeholders not yet downloaded (macOS only); reading one can hang. */
export function placeholderFiles(files) {
  if (process.platform !== "darwin" || !files.length) return [];
  const result = spawnSync("stat", ["-f", "%Sf %N", ...files], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return parseStatFlags(result.stdout);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function answers(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return response.status < 500;
  } catch {
    return false;
  }
}

function startStatic(dir) {
  const root = path.resolve(dir);
  const server = http.createServer((request, response) => {
    if (new URL(request.url, "http://localhost").pathname.endsWith("/")) request.url = `${request.url.split("?")[0]}index.html`;
    serveFile(root, request, response);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ url: `http://127.0.0.1:${server.address().port}/`, stop: () => new Promise((done) => server.close(done)) });
    });
  });
}

export async function startProject(dir, { timeoutMs = 90_000 } = {}) {
  const command = detectDevCommand(dir);
  const placeholders = cloudPlaceholders(dir);
  if (placeholders.length) {
    const examples = placeholders.slice(0, 3).map((file) => path.relative(dir, file)).join(", ");
    throw new Error(
      `${placeholders.length} file(s) in ${dir} are iCloud placeholders that are not downloaded (${examples}${placeholders.length > 3 ? ", …" : ""}); ` +
        `reading them waits on iCloud and can hang the capture. Download the folder first (Finder: right-click → Download Now, or: brctl download "${dir}").`,
    );
  }
  if (command.kind === "static") return startStatic(dir);

  const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  const hasDeps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length > 0;
  if (hasDeps && !existsSync(path.join(dir, "node_modules"))) {
    throw new Error(`${dir} has dependencies but no node_modules; install them (npm install) before capturing.`);
  }

  const child = spawn("npm", ["run", command.script], {
    cwd: dir,
    env: { ...process.env, PORT: String(command.port), BROWSER: "none", FORCE_COLOR: "0" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let output = "";
  let url = null;
  const onData = (chunk) => {
    output += chunk;
    url ??= parseServerUrl(output);
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);

  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((resolve) => child.once("exit", resolve));
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
    const done = await Promise.race([exited.then(() => true), sleep(5000).then(() => false)]);
    if (!done) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
      await exited;
    }
  };

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`npm run ${command.script} exited (${child.exitCode}):\n${output.slice(-800)}`);
    const candidate = url ?? `http://localhost:${command.port}/`;
    if (await answers(candidate)) return { url: candidate, stop };
    await sleep(300);
  }
  await stop();
  throw new Error(`npm run ${command.script} did not answer within ${Math.round(timeoutMs / 1000)}s:\n${output.slice(-800)}`);
}

const slug = (route) => route.replace(/^\/|\/$/g, "").replace(/[^a-z0-9]+/gi, "-") || "home";

export async function capturePages(baseUrl, { routes = ["/"], viewport = [1080, 1920], outDir, scrollFrames = 0, scale = 1, navigationTimeoutMs = NAVIGATION_TIMEOUT_MS }) {
  mkdirSync(outDir, { recursive: true });
  const [width, height] = viewport;
  return withPage("about:blank", async (session) => {
    // scale 2 gives a retina capture: the same layout at twice the pixels, for README and site images.
    await session.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: width < height });
    const results = [];
    for (const route of routes) {
      const url = new URL(route, baseUrl).href;
      const loaded = session.once("Page.loadEventFired");
      await session.send("Page.navigate", { url });
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${url} did not finish loading within ${Math.round(navigationTimeoutMs / 1000)}s; a request on the page is hanging.`)), navigationTimeoutMs);
      });
      try {
        await Promise.race([loaded, timeout]);
      } finally {
        clearTimeout(timer);
      }
      await session.evaluate("document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 400)))");
      // A same-origin stylesheet that did not load means an unstyled capture; external ones (fonts CDNs) may be offline.
      const styling = await session.evaluate(`(() => {
        const failed = [...document.querySelectorAll('link[rel="stylesheet"]')]
          .filter((link) => new URL(link.href, location.href).origin === location.origin && !link.sheet)
          .map((link) => link.getAttribute("href"));
        let rules = 0;
        for (const sheet of document.styleSheets) {
          try { rules += sheet.cssRules.length; } catch { /* cross-origin sheet */ }
        }
        return { failed, rules };
      })()`);
      if (styling.failed.length) throw new Error(`${url}: stylesheet(s) did not load: ${styling.failed.join(", ")}; the capture would be unstyled.`);
      const name = slug(route);
      const shot = async (file) => {
        // Capture the viewport as displayed: a fixed clip would crop pages that mobile emulation scales down.
        const { data } = await session.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        writeFileSync(file, Buffer.from(data, "base64"));
        return file;
      };
      const screenshot = await shot(path.join(outDir, `${name}.png`));
      const frames = [];
      const positions = [];
      if (scrollFrames > 0) {
        const max = await session.evaluate("Math.max(0, document.documentElement.scrollHeight - innerHeight)");
        for (let i = 0; i < scrollFrames; i += 1) {
          const y = scrollFrames === 1 ? 0 : Math.round((max * i) / (scrollFrames - 1));
          // behavior "instant" overrides a site's `scroll-behavior: smooth`, which would capture mid-animation.
          positions.push(await session.evaluate(`window.scrollTo({ top: ${y}, behavior: "instant" }); new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => r(Math.round(scrollY)), ${SCROLL_SETTLE_MS}))))`));
          frames.push(await shot(path.join(outDir, `${name}-scroll-${String(i + 1).padStart(2, "0")}.png`)));
        }
        await session.evaluate('window.scrollTo({ top: 0, behavior: "instant" })');
      }
      results.push({ route, screenshot, scrollFrames: frames, scrollPositions: positions, failedStylesheets: styling.failed, styledRules: styling.rules });
    }
    return results;
  });
}

export function scrollVideo(frames, output, { secondsPerFrame = 0.2, fps = 30 } = {}) {
  if (!frames.length) throw new Error("No scroll frames to encode.");
  const pattern = frames[0].replace(/-scroll-\d+\.png$/, "-scroll-%02d.png");
  const result = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-framerate", String(1 / secondsPerFrame), "-i", pattern,
    "-vf", `fps=${fps},scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`, "-c:v", "libx264", "-crf", "18", "-movflags", "+faststart", output,
  ], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr.trim()}`);
  return output;
}

async function main(argv) {
  const [dir, ...rest] = argv;
  const flag = (name, fallback) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : fallback);
  const outDir = flag("--out");
  if (!dir || !outDir) throw new Error("Usage: capture.mjs <project-dir> --out <dir> [--routes /,/pricing] [--viewport 1080x1920] [--scale 2] [--scroll-frames 24]");
  const viewport = flag("--viewport", "1080x1920").split("x").map(Number);
  const server = await startProject(dir);
  try {
    const shots = await capturePages(server.url, { routes: flag("--routes", "/").split(","), viewport, outDir, scale: Number(flag("--scale", 1)), scrollFrames: Number(flag("--scroll-frames", 0)) });
    for (const shot of shots) {
      if (shot.scrollFrames.length) shot.scrollVideo = scrollVideo(shot.scrollFrames, path.join(outDir, `scroll-${slug(shot.route)}.mp4`));
    }
    console.log(JSON.stringify({ url: server.url, shots }, null, 2));
  } finally {
    await server.stop();
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
