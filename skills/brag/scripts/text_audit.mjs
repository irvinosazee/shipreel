#!/usr/bin/env node
/**
 * Readability audit for a Hyperframes composition, measured in headless Chrome.
 *
 *   node <skill-root>/scripts/text_audit.mjs <composition-dir> [--step 0.1] [--json]
 *
 * Steps the composition's timeline and, for every element with its own text, records
 * when it is readable (its clip is active, effective opacity >= 0.9, inside the frame)
 * and its rendered font size including transforms. Then:
 *
 *   reading-time     (error)   longest readable stretch < max(0.8s, 0.3s per word)
 *   text-too-small   (error)   rendered size < 28px per 1080px of the frame's short side
 *   body-text-small  (warning) 4+ words rendered < 40px per 1080px of the short side
 *
 * Mark text that is meant to tick past (timers, counters, typing) with data-read-exempt.
 * Needs Chrome or Chromium: set CHROME_PATH, or install Google Chrome.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const READABLE_OPACITY = 0.9;
const SECONDS_PER_WORD = 0.3;
const MIN_READ_SECONDS = 0.8;
const BASE_SHORT_SIDE = 1080;
const MIN_ANY_PX = 28;
const MIN_BODY_PX = 40;
const BODY_WORDS = 4;

export function minLegiblePx([width, height]) {
  const scale = Math.min(width, height) / BASE_SHORT_SIDE;
  return { any: Math.round(MIN_ANY_PX * scale), body: Math.round(MIN_BODY_PX * scale) };
}

export function readingNeed(words) {
  return Math.round(Math.max(MIN_READ_SECONDS, words * SECONDS_PER_WORD) * 100) / 100;
}

export function longestRun(readable, step) {
  let best = 0;
  let run = 0;
  for (const value of readable) {
    run = value ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best * step;
}

// A word needs a letter or digit: "●", "$", and "·" are decoration, not something to read.
const wordCount = (text) => text.trim().split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;

export function analyzeSamples({ frame, step, elements }) {
  const limits = minLegiblePx(frame);
  const errors = [];
  const warnings = [];
  const measured = [];

  for (const element of elements) {
    if (element.exempt) continue;
    const words = wordCount(element.text);
    if (words === 0) continue;
    const seen = element.readable.some(Boolean);
    const longest = longestRun(element.readable, step);
    const need = readingNeed(words);
    const fontPx = element.fontPx.length ? Math.min(...element.fontPx) : null;
    measured.push({ id: element.id, text: element.text, words, longest: Number(longest.toFixed(2)), need, fontPx });
    if (!seen) continue;

    if (longest + step / 2 < need) {
      errors.push({
        code: "reading-time",
        id: element.id,
        message: `${element.id} "${element.text}" is readable for ${longest.toFixed(1)}s at most, but ${words} word(s) needs ${need}s.`,
      });
    }
    if (fontPx != null && fontPx < limits.any) {
      errors.push({
        code: "text-too-small",
        id: element.id,
        message: `${element.id} "${element.text}" renders at ${fontPx.toFixed(0)}px; text on this frame needs at least ${limits.any}px to read on a phone.`,
      });
    } else if (fontPx != null && words >= BODY_WORDS && fontPx < limits.body) {
      warnings.push({
        code: "body-text-small",
        id: element.id,
        message: `${element.id} "${element.text}" renders at ${fontPx.toFixed(0)}px; body copy reads better at ${limits.body}px or more.`,
      });
    }
  }
  return { frame, step, limits, checked: measured.length, elements: measured, errors, warnings };
}

export function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    const found = spawnSync("which", [name], { encoding: "utf8" });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  return null;
}

/** In-page sampler, serialized into Runtime.evaluate. Returns { frame, step, elements }. */
function pageSampler(step, readableOpacity) {
  return async () => {
    await document.fonts.ready;
    for (let i = 0; i < 100 && !(window.__timelines && Object.keys(window.__timelines).length); i += 1) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const root = document.querySelector("[data-composition-id]");
    const frame = [Number(root.dataset.width), Number(root.dataset.height)];
    const duration = Number(root.dataset.duration);
    const timeline = window.__timelines[root.dataset.compositionId] ?? Object.values(window.__timelines)[0];
    const clips = [...root.querySelectorAll("[data-start]")].filter((el) => !["AUDIO", "VIDEO"].includes(el.tagName));

    const textElements = [...root.querySelectorAll("*")].filter(
      (el) => !["SCRIPT", "STYLE", "AUDIO", "VIDEO"].includes(el.tagName) &&
        [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim()),
    );
    const describe = (el) => (el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).trim().split(/\s+/).join(".")}` : ""}:nth(${textElements.indexOf(el)})`);
    const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join(" ").replace(/\s+/g, " ").trim();
    const samples = textElements.map((el) => ({
      id: describe(el),
      text: ownText(el),
      exempt: Boolean(el.closest("[data-read-exempt]")),
      readable: [],
      fontPx: [],
    }));

    const clipActive = (el, t) => {
      const start = Number(el.dataset.start);
      const end = start + Number(el.dataset.duration ?? Infinity);
      return t >= start && t < end;
    };

    for (let i = 0; i * step < duration; i += 1) {
      const t = Number((i * step).toFixed(4));
      for (const clip of clips) clip.style.visibility = clipActive(clip, t) ? "visible" : "hidden";
      timeline.seek(t, false);

      textElements.forEach((el, index) => {
        let opacity = 1;
        let visible = true;
        for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.display === "none" || style.visibility === "hidden") visible = false;
          opacity *= Number(style.opacity);
        }
        const rect = el.getBoundingClientRect();
        const inFrame = rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < frame[0] && rect.top < frame[1];
        const readable = visible && inFrame && opacity >= readableOpacity;
        samples[index].readable.push(readable);
        if (readable) {
          const scale = el.offsetWidth > 0 ? rect.width / el.offsetWidth : 1;
          samples[index].fontPx.push(parseFloat(getComputedStyle(el).fontSize) * scale);
        }
      });
    }
    return { frame, step, elements: samples };
  };
}

/** Minimal Chrome DevTools Protocol session over Node's built-in WebSocket. */
async function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  const listeners = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id != null && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    } else if (message.method && listeners.has(message.method)) {
      for (const listener of listeners.get(message.method)) listener(message.params);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      nextId += 1;
      pending.set(nextId, { resolve, reject });
      socket.send(JSON.stringify({ id: nextId, method, params }));
    });
  const once = (method) => new Promise((resolve) => listeners.set(method, [...(listeners.get(method) ?? []), resolve]));
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };
  return { send, once, evaluate, close: () => socket.close() };
}

export async function auditComposition(compositionDir, { step = 0.1, chromePath = findChrome(), timeoutMs = 120_000 } = {}) {
  if (!chromePath) throw new Error("Chrome or Chromium not found; set CHROME_PATH.");
  const indexUrl = pathToFileURL(path.join(path.resolve(compositionDir), "index.html")).href;
  const profile = mkdtempSync(path.join(tmpdir(), "brag-chrome-"));
  const chrome = spawn(chromePath, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars",
    "--allow-file-access-from-files", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--window-size=4000,4000",
    ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []),
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });

  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Chrome did not start")), timeoutMs);
      let buffer = "";
      chrome.stderr.on("data", (chunk) => {
        buffer += chunk;
        const match = buffer.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//);
        if (match) {
          clearTimeout(timer);
          resolve(Number(match[1]));
        }
      });
      chrome.on("exit", (code) => reject(new Error(`Chrome exited (${code})`)));
    });

    let page;
    for (let attempt = 0; attempt < 50 && !page; attempt += 1) {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      page = targets.find((t) => t.type === "page");
      if (!page) await new Promise((r) => setTimeout(r, 100));
    }
    if (!page) throw new Error("Chrome opened no page.");

    const session = await connect(page.webSocketDebuggerUrl);
    try {
      await session.send("Page.enable");
      // The Hyperframes runtime creates the timeline registry before composition scripts run; do the same.
      await session.send("Page.addScriptToEvaluateOnNewDocument", { source: "window.__timelines = window.__timelines || {};" });
      const loaded = session.once("Page.loadEventFired");
      await session.send("Page.navigate", { url: indexUrl });
      await loaded;
      const samples = await session.evaluate(`(${pageSampler.toString()})(${step}, ${READABLE_OPACITY})()`);
      return analyzeSamples(samples);
    } finally {
      session.close();
    }
  } finally {
    chrome.kill("SIGKILL");
    rmSync(profile, { recursive: true, force: true });
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--step");
  const step = args.includes("--step") ? Number(args[args.indexOf("--step") + 1]) : 0.1;
  if (!dir || !existsSync(path.join(dir, "index.html"))) {
    console.error("Usage: text_audit.mjs <composition-dir> [--step 0.1] [--json]");
    process.exitCode = 2;
  } else {
    auditComposition(dir, { step })
      .then((report) => {
        if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
        else {
          console.log(`Text audit: ${report.checked} text element(s), frame ${report.frame.join("x")}, minimum ${report.limits.any}px (body ${report.limits.body}px).`);
          for (const e of report.errors) console.log(`✗ ${e.message}`);
          for (const w of report.warnings) console.log(`! ${w.message}`);
          if (!report.errors.length && !report.warnings.length) console.log("✓ Every line holds long enough and reads at phone size.");
        }
        process.exitCode = report.errors.length ? 1 : 0;
      })
      .catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
      });
  }
}
