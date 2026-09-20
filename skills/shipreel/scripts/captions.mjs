#!/usr/bin/env node
/**
 * Caption files for shipreel videos.
 *
 *   node <skill-root>/scripts/captions.mjs <cues.json> --srt shipreel.srt --vtt shipreel.vtt [--words] [--max-chars 32]
 *
 * <cues.json> is either caption cues [{ "start": 0.4, "end": 2.2, "text": "..." }]
 * — the on-screen lines with their settled start/end times from the storyboard —
 * or, with --words, word timings [{ "text": "Every", "start": 0, "end": 0.3 }, ...]
 * converted from a voiceover transcript, which are grouped into short lines.
 *
 * Prints any readability problems (overlaps, empty cues, cues shorter than
 * ~0.3s per word) to stderr and exits 1 when there are some.
 *
 * Burned-in caption styles:
 *
 *   node <skill-root>/scripts/captions.mjs inject <composition-dir> --cues captions.json \
 *     --style lower-third|word-pop|karaoke --theme caption-theme.json
 *
 * Writes a timed caption block into the composition between shipreel:captions markers
 * (re-running replaces it). Captions are plain data-start/data-duration markup styled
 * with CSS — no timeline code — so Hyperframes owns their visibility and the text audit
 * can measure them. caption-theme.json: { "font", "fg", "bg", "accent",
 * "band": { "x", "y", "width", "height" } } with the band inside the safe rectangle.
 */

import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SECONDS_PER_WORD = 0.3;
const MIN_CUE_SECONDS = 0.8;
const PAUSE_BREAK_SECONDS = 0.6;
const MAX_LINE_SECONDS = 2.5;

export function formatTimestamp(seconds, style = "srt") {
  const ms = Math.round(seconds * 1000);
  const pad = (n, width = 2) => String(n).padStart(width, "0");
  const clock = `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}`;
  return `${clock}${style === "vtt" ? "." : ","}${pad(ms % 1000, 3)}`;
}

export function toSrt(cues) {
  return cues
    .map((cue, i) => `${i + 1}\n${formatTimestamp(cue.start, "srt")} --> ${formatTimestamp(cue.end, "srt")}\n${cue.text.trim()}\n`)
    .join("\n");
}

export function toVtt(cues) {
  const body = cues
    .map((cue) => `${formatTimestamp(cue.start, "vtt")} --> ${formatTimestamp(cue.end, "vtt")}\n${cue.text.trim()}\n`)
    .join("\n");
  return `WEBVTT\n\n${body}`;
}

/** Group word timings into caption lines that fit maxChars and break on pauses and sentence ends. */
export function groupWords(words, { maxChars = 32 } = {}) {
  const lines = [];
  let current = null;
  const flush = () => {
    if (current) lines.push(current);
    current = null;
  };

  for (const word of words) {
    const text = word.text.trim();
    if (!text) continue;
    if (current) {
      const pause = word.start - current.end;
      const tooLong = current.text.length + 1 + text.length > maxChars;
      const tooSlow = word.end - current.start > MAX_LINE_SECONDS;
      if (pause >= PAUSE_BREAK_SECONDS || tooLong || tooSlow) flush();
    }
    if (current) {
      current.text += ` ${text}`;
      current.end = word.end;
    } else {
      current = { start: word.start, end: word.end, text };
    }
    if (/[.!?]$/.test(text)) flush();
  }
  flush();
  return lines;
}

export function lintCues(cues) {
  const problems = [];
  cues.forEach((cue, i) => {
    const n = i + 1;
    const words = cue.text.trim().split(/\s+/).filter(Boolean).length;
    if (words === 0) {
      problems.push(`cue ${n} is empty`);
      return;
    }
    const needed = Math.max(MIN_CUE_SECONDS, words * SECONDS_PER_WORD);
    const shown = cue.end - cue.start;
    if (shown + 1e-9 < needed) {
      problems.push(`cue ${n} is on screen for ${shown.toFixed(1)}s but ${words} words needs about ${needed.toFixed(1)}s`);
    }
    if (i > 0 && cue.start < cues[i - 1].end - 1e-9) problems.push(`cue ${n} starts before cue ${i} ends`);
  });
  return problems;
}

export const CAPTION_STYLES = {
  "lower-third": { description: "The whole line in a solid bar, like a broadcast lower third. Calm, works for any tone." },
  "word-pop": { description: "Words appear one at a time and stay for the rest of the line, big and bold. Energetic, social-native." },
  karaoke: { description: "The whole line shows at once and each word lights up in the accent color as it is said." },
};

const CUE_TRACK = 90;
// Captions are 52px+ bold, which WCAG treats as large text: 3:1 minimum against their plate.
const MIN_CAPTION_CONTRAST = 3;

function luminance(hex) {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? [...value].map((c) => c + c).join("") : value.slice(0, 6);
  const channels = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}
const round3 = (n) => Math.round(n * 1000) / 1000;
const escapeHtml = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** Word timings for a cue: its own `words` when present, otherwise spread evenly across the cue. */
export function cueWords(cue) {
  if (Array.isArray(cue.words) && cue.words.length) return cue.words.map((w) => ({ text: w.text.trim(), start: w.start }));
  const tokens = cue.text.trim().split(/\s+/).filter(Boolean);
  const slot = (cue.end - cue.start) / tokens.length;
  return tokens.map((text, i) => ({ text, start: round3(cue.start + i * slot) }));
}

export function buildCaptionBlock(cues, { style, theme }) {
  if (!CAPTION_STYLES[style]) throw new Error(`Unknown caption style "${style}". Use one of: ${Object.keys(CAPTION_STYLES).join(", ")}.`);
  const { band } = theme;
  // Captions sit over every scene, so they carry their own plate; the text must contrast with that plate.
  for (const key of style === "karaoke" ? ["fg", "accent"] : ["fg"]) {
    const ratio = contrastRatio(theme[key], theme.bg);
    if (ratio < MIN_CAPTION_CONTRAST) {
      throw new Error(`Caption ${key} ${theme[key]} on plate ${theme.bg} has contrast ${ratio.toFixed(1)}:1; captions need at least ${MIN_CAPTION_CONTRAST}:1.`);
    }
  }
  let track = CUE_TRACK + 1;
  const timing = (id, start, duration) => `id="${id}" data-start="${round3(start)}" data-duration="${round3(duration)}" data-track-index="${track++}"`;

  const lines = cues.map((cue, c) => {
    const start = round3(cue.start);
    const duration = round3(cue.end - cue.start);
    const open = `<div id="cap-${c}" class="clip shipreel-cap" data-start="${start}" data-duration="${duration}" data-track-index="${CUE_TRACK}">`;
    if (style === "lower-third") return `${open}<span class="shipreel-line">${escapeHtml(cue.text.trim())}</span></div>`;

    const words = cueWords(cue).map((word, w) => {
      const text = escapeHtml(word.text);
      if (style === "word-pop") {
        return `<span ${timing(`cap-${c}-w${w}`, word.start, cue.end - word.start).replace(" data-start", ' class="clip shipreel-word" data-start')}>${text}</span>`;
      }
      // Karaoke: the base word shows until the word is said, then the lit copy takes over in the same grid cell.
      const baseDuration = word.start - cue.start;
      const base = baseDuration > 0.001
        ? `<span ${timing(`cap-${c}-w${w}-base`, cue.start, baseDuration).replace(" data-start", ' class="clip shipreel-base" data-start')}>${text}</span>`
        : `<span class="shipreel-base shipreel-hold">${text}</span>`;
      const lit = `<span ${timing(`cap-${c}-w${w}`, word.start, cue.end - word.start).replace(" data-start", ' class="clip shipreel-lit" data-start')}>${text}</span>`;
      return `<span class="shipreel-kw">${base}${lit}</span>`;
    });
    return `${open}<span class="shipreel-line" data-read-exempt="time">${words.join(" ")}</span></div>`;
  });

  const css = [
    `.shipreel-captions { position: absolute; inset: 0; z-index: 50; pointer-events: none; }`,
    // Captions are clips; undo any composition-wide `.clip { position: absolute; inset: 0 }`.
    `.shipreel-captions .clip.shipreel-cap { right: auto; bottom: auto; }`,
    `.shipreel-captions .clip.shipreel-word { position: static; inset: auto; display: inline; }`,
    `.shipreel-captions .clip.shipreel-base, .shipreel-captions .clip.shipreel-lit { position: static; inset: auto; grid-area: 1 / 1; }`,
    `.shipreel-cap { position: absolute; left: ${band.x}px; top: ${band.y}px; width: ${band.width}px; height: ${band.height}px; display: flex; align-items: center; justify-content: center; text-align: center; font-family: "${theme.font}", sans-serif; }`,
    `.shipreel-line { background: ${theme.bg}; color: ${theme.fg}; line-height: 1.2; padding: 14px 26px; border-radius: 16px; font-weight: ${style === "lower-third" ? 700 : 900}; font-size: ${{ "lower-third": 52, "word-pop": 72, karaoke: 58 }[style]}px; letter-spacing: -0.01em; }`,
    `.shipreel-kw { display: inline-grid; }`,
    `.shipreel-base { grid-area: 1 / 1; }`,
    `.shipreel-hold { visibility: hidden; }`,
    `.shipreel-lit { grid-area: 1 / 1; color: ${theme.accent}; }`,
  ].join("\n      ");

  return [
    `<!-- shipreel:captions:start style=${style} -->`,
    `<div class="shipreel-captions">`,
    `  <style>\n      ${css}\n  </style>`,
    ...lines.map((line) => `  ${line}`),
    `</div>`,
    `<!-- shipreel:captions:end -->`,
  ].join("\n");
}

export function injectCaptions(html, block) {
  const existing = /<!-- shipreel:captions:start[\s\S]*?<!-- shipreel:captions:end -->/;
  if (existing.test(html)) return html.replace(existing, block);
  const root = html.match(/<[a-z]+\b[^>]*\bdata-composition-id="[^"]*"[^>]*>/i);
  if (!root) throw new Error("No element with data-composition-id found.");
  return html.replace(root[0], `${root[0]}\n${block}`);
}

function injectCommand(argv) {
  const [dir, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 2) options[rest[i].replace(/^--/, "")] = rest[i + 1];
  if (!dir || !options.cues || !options.style || !options.theme) {
    console.error("Usage: captions.mjs inject <composition-dir> --cues captions.json --style lower-third|word-pop|karaoke --theme caption-theme.json");
    process.exitCode = 2;
    return;
  }
  const cues = JSON.parse(readFileSync(options.cues, "utf8"));
  const theme = JSON.parse(readFileSync(options.theme, "utf8"));
  const index = path.join(dir, "index.html");
  writeFileSync(index, injectCaptions(readFileSync(index, "utf8"), buildCaptionBlock(cues, { style: options.style, theme })));
  const problems = lintCues(cues);
  for (const problem of problems) console.error(`! ${problem}`);
  console.log(JSON.stringify({ injected: index, style: options.style, cues: cues.length, problems }, null, 2));
}

function main(argv) {
  if (argv[0] === "inject") {
    injectCommand(argv.slice(1));
    return;
  }
  const options = { maxChars: 32 };
  let input = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--srt") options.srt = argv[++i];
    else if (arg === "--vtt") options.vtt = argv[++i];
    else if (arg === "--words") options.words = true;
    else if (arg === "--max-chars") options.maxChars = Number(argv[++i]);
    else input = arg;
  }
  if (!input || (!options.srt && !options.vtt)) {
    console.error("Usage: captions.mjs <cues.json> --srt out.srt [--vtt out.vtt] [--words] [--max-chars 32]");
    process.exitCode = 2;
    return;
  }

  const data = JSON.parse(readFileSync(input, "utf8"));
  const cues = options.words ? groupWords(data, { maxChars: options.maxChars }) : data;
  if (options.srt) writeFileSync(options.srt, toSrt(cues));
  if (options.vtt) writeFileSync(options.vtt, toVtt(cues));

  const problems = lintCues(cues);
  for (const problem of problems) console.error(`! ${problem}`);
  console.log(JSON.stringify({ cues: cues.length, srt: options.srt ?? null, vtt: options.vtt ?? null, problems }, null, 2));
  process.exitCode = problems.length > 0 ? 1 : 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2));
}
