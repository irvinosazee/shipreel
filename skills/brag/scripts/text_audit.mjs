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
 * Mark text that is meant to tick past (timers, counters) with data-read-exempt, or with
 * data-read-exempt="time" to skip only the reading-time rule and still check its size
 * (per-word caption states, whose line is timed as a whole).
 * Needs Chrome or Chromium: set CHROME_PATH, or install Google Chrome.
 */

import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { findChrome, withPage } from "./chrome.mjs";

export { findChrome };

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
    // data-read-exempt skips the element entirely; data-read-exempt="time" skips only the reading-time rule.
    if (element.exempt === true) continue;
    const words = wordCount(element.text);
    if (words === 0) continue;
    const seen = element.readable.some(Boolean);
    const longest = longestRun(element.readable, step);
    const need = readingNeed(words);
    const fontPx = element.fontPx.length ? Math.min(...element.fontPx) : null;
    measured.push({ id: element.id, text: element.text, words, longest: Number(longest.toFixed(2)), need, fontPx });
    if (!seen) continue;

    if (element.exempt !== "time" && longest + step / 2 < need) {
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
      exempt: (() => {
        const holder = el.closest("[data-read-exempt]");
        if (!holder) return false;
        return holder.getAttribute("data-read-exempt") === "time" ? "time" : true;
      })(),
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

export async function auditComposition(compositionDir, { step = 0.1, chromePath = findChrome() } = {}) {
  const indexUrl = pathToFileURL(path.join(path.resolve(compositionDir), "index.html")).href;
  // The Hyperframes runtime creates the timeline registry before composition scripts run; do the same.
  return withPage(
    indexUrl,
    async (session) => analyzeSamples(await session.evaluate(`(${pageSampler.toString()})(${step}, ${READABLE_OPACITY})()`)),
    { beforeLoad: ["window.__timelines = window.__timelines || {};"], chromePath },
  );
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
