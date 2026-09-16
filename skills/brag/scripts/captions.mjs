#!/usr/bin/env node
/**
 * Caption files for brag videos.
 *
 *   node <skill-root>/scripts/captions.mjs <cues.json> --srt brag.srt --vtt brag.vtt [--words] [--max-chars 32]
 *
 * <cues.json> is either caption cues [{ "start": 0.4, "end": 2.2, "text": "..." }]
 * — the on-screen lines with their settled start/end times from the storyboard —
 * or, with --words, word timings [{ "text": "Every", "start": 0, "end": 0.3 }, ...]
 * converted from a voiceover transcript, which are grouped into short lines.
 *
 * Prints any readability problems (overlaps, empty cues, cues shorter than
 * ~0.3s per word) to stderr and exits 1 when there are some.
 */

import { readFileSync, realpathSync, writeFileSync } from "node:fs";
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

function main(argv) {
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
