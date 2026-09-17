import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import http from "node:http";

import { detectDevCommand, parseServerUrl, startProject, capturePages, scrollVideo, parseStatFlags } from "../skills/brag/scripts/capture.mjs";
import { findChrome } from "../skills/brag/scripts/chrome.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ESC = String.fromCharCode(27);

function project(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "brag-capture-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(path.join(dir, name), typeof content === "string" ? content : JSON.stringify(content));
  return dir;
}

test("detectDevCommand picks the dev script and the framework's default port", () => {
  const cases = [
    [{ "package.json": { scripts: { dev: "next dev" }, dependencies: { next: "15" } } }, { kind: "npm", script: "dev", port: 3000 }],
    [{ "package.json": { scripts: { dev: "vite" }, devDependencies: { vite: "5" } } }, { kind: "npm", script: "dev", port: 5173 }],
    [{ "package.json": { scripts: { start: "astro dev" }, dependencies: { astro: "4" } } }, { kind: "npm", script: "start", port: 4321 }],
    [{ "index.html": "<h1>hi</h1>" }, { kind: "static", port: 0 }],
  ];
  for (const [files, expected] of cases) {
    const dir = project(files);
    try {
      assert.deepEqual(detectDevCommand(dir), expected);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const empty = project({ "notes.txt": "" });
  try {
    assert.throws(() => detectDevCommand(empty), /no dev script and no index\.html/);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test("parseStatFlags lists iCloud placeholder files that are not downloaded", () => {
  const output = "compressed,dataless /site/style.css\n- /site/index.html\nhidden /site/.DS_Store\ndataless /site/img/logo.svg";
  assert.deepEqual(parseStatFlags(output), ["/site/style.css", "/site/img/logo.svg"]);
});

test("capturePages gives up on a page that never finishes loading", { skip: !findChrome() && "Chrome not found" }, async () => {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.write("<h1>still loading");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const out = mkdtempSync(path.join(tmpdir(), "brag-hang-"));
  const started = Date.now();
  try {
    await assert.rejects(
      capturePages(`http://127.0.0.1:${server.address().port}/`, { routes: ["/"], viewport: [800, 600], outDir: out, navigationTimeoutMs: 2000 }),
      /did not finish loading within 2s/,
    );
    assert.ok(Date.now() - started < 20000, "fails fast instead of hanging");
  } finally {
    server.closeAllConnections();
    server.close();
    rmSync(out, { recursive: true, force: true });
  }
});

test("scroll frames land exactly where requested even when the site uses smooth scrolling", { skip: !findChrome() && "Chrome not found" }, async () => {
  const dir = project({ "index.html": '<!doctype html><html style="scroll-behavior:smooth"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0"><div style="height:5000px;background:linear-gradient(#000,#fff)"></div></body></html>' });
  const out = mkdtempSync(path.join(tmpdir(), "brag-smooth-"));
  const server = await startProject(dir);
  try {
    const [shot] = await capturePages(server.url, { routes: ["/"], viewport: [800, 1000], outDir: out, scrollFrames: 5 });
    assert.deepEqual(shot.scrollPositions, [0, 1000, 2000, 3000, 4000]);
    const [w, h] = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", shot.scrollFrames[2]], { encoding: "utf8" }).trim().split(",").map(Number);
    assert.deepEqual([w, h], [800, 1000]);
  } finally {
    await server.stop();
    rmSync(out, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a page without a viewport meta tag is captured whole, not cropped to a clip", { skip: !findChrome() && "Chrome not found" }, async () => {
  // Mobile emulation lays such a page out 980px wide and scales it down, like a phone does.
  const dir = project({ "index.html": '<!doctype html><body style="margin:0"><div style="height:3000px;background:linear-gradient(90deg,#f00 0,#f00 50%,#00f 50%,#00f 100%)"></div></body>' });
  const out = mkdtempSync(path.join(tmpdir(), "brag-novp-"));
  const server = await startProject(dir);
  try {
    const [shot] = await capturePages(server.url, { routes: ["/"], viewport: [400, 800], outDir: out });
    const rgba = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", shot.screenshot, "-vf", "crop=4:4:392:400,format=rgb24", "-f", "rawvideo", "-"]);
    assert.ok(rgba[2] > 200 && rgba[0] < 60, `the right edge shows the blue half of the page (rgb ${rgba[0]},${rgba[1]},${rgba[2]})`);
  } finally {
    await server.stop();
    rmSync(out, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("parseServerUrl finds the local URL a dev server prints, ignoring ANSI colour", () => {
  const vite = `  ${ESC}[32m➜${ESC}[39m  Local:   ${ESC}[36mhttp://localhost:${ESC}[1m5173${ESC}[22m/${ESC}[39m`;
  assert.equal(parseServerUrl(vite), "http://localhost:5173/");
  assert.equal(parseServerUrl("- Local:        http://127.0.0.1:3000"), "http://127.0.0.1:3000");
  assert.equal(parseServerUrl("compiling..."), null);
});

test("startProject runs an npm dev script and waits until its URL answers", async () => {
  const dir = project({
    "package.json": { scripts: { dev: "node server.cjs" } },
    "server.cjs": `const http = require("http"); const s = http.createServer((q, r) => r.end("<h1>fixture</h1>")); s.listen(0, "127.0.0.1", () => { setTimeout(() => console.log("ready on http://127.0.0.1:" + s.address().port + "/"), 300); });`,
  });
  const server = await startProject(dir, { timeoutMs: 20000 });
  try {
    assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    assert.equal(await (await fetch(server.url)).text(), "<h1>fixture</h1>");
  } finally {
    await server.stop();
  }
  await assert.rejects(fetch(server.url), undefined, "the dev server is stopped");
  rmSync(dir, { recursive: true, force: true });
});

test("capturePages screenshots a real site at the video's viewport and records a scroll", { skip: !findChrome() && "Chrome not found" }, async () => {
  const out = mkdtempSync(path.join(tmpdir(), "brag-shots-"));
  const server = await startProject(path.join(repoRoot, "examples", "horse-tinder"));
  try {
    const shots = await capturePages(server.url, { routes: ["/"], viewport: [1080, 1920], outDir: out, scrollFrames: 12 });
    assert.equal(shots.length, 1);
    const [w, h] = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", shots[0].screenshot], { encoding: "utf8" }).trim().split(",").map(Number);
    assert.deepEqual([w, h], [1080, 1920]);
    const stats = spawnSync("ffmpeg", ["-hide_banner", "-i", shots[0].screenshot, "-vf", "format=gray,signalstats,metadata=print", "-f", "null", "-"], { encoding: "utf8" }).stderr;
    const ymin = Number(stats.match(/YMIN=(\d+)/)[1]);
    const ymax = Number(stats.match(/YMAX=(\d+)/)[1]);
    assert.ok(ymax - ymin > 80, `the screenshot has real content (Y range ${ymin}-${ymax})`);
    assert.equal(shots[0].scrollFrames.length, 12);
    assert.deepEqual(shots[0].failedStylesheets, [], "the page's own stylesheets loaded");
    assert.ok(shots[0].styledRules > 0, "CSS rules were applied, not an unstyled page");

    const video = scrollVideo(shots[0].scrollFrames, path.join(out, "scroll.mp4"), { secondsPerFrame: 0.2 });
    const duration = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video], { encoding: "utf8" }));
    assert.ok(Math.abs(duration - 12 * 0.2) < 0.2, String(duration));
  } finally {
    await server.stop();
    rmSync(out, { recursive: true, force: true });
  }
});
