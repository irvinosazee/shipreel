#!/usr/bin/env node
/**
 * Cutdowns, story segments, and carousels from a finished brag and its scene list.
 *
 *   node <skill-root>/scripts/cuts.mjs cutdown <brag.mp4> --scenes scenes.json --seconds 6 --out brag-cut6.mp4
 *   node <skill-root>/scripts/cuts.mjs stories <brag.mp4> --scenes scenes.json --out stories/ [--max 15]
 *   node <skill-root>/scripts/cuts.mjs carousel <brag.mp4> --scenes scenes.json --out carousel/
 *   node <skill-root>/scripts/cuts.mjs plan --scenes scenes.json --seconds 18   # which scenes a shorter cut keeps, no render
 *
 * scenes.json is written in Step 2 next to brag-plan.md:
 *   [{ "name": "Hook", "start": 0, "end": 3.55, "role": "hook", "settled": 1.6 }, ...]
 * roles: hook, reveal, highlight, payoff. `settled` is when the scene's text is first fully readable;
 * optional `still` is the scene's most complete frame (after every build), used for carousel slides and
 * story posters, falling back to `settled`.
 */

import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fitImage } from "./covers.mjs";

const ROLES = new Set(["hook", "reveal", "highlight", "payoff"]);
const EPS = 1e-6;
const FIT_TOLERANCE = 0.5;
const HOOK_SHARE = 0.45;
const AUDIO_EDGE_FADE = 0.03;

export function loadScenes(input) {
  const scenes = typeof input === "string" ? JSON.parse(readFileSync(input, "utf8")) : input;
  if (!Array.isArray(scenes) || scenes.length === 0) throw new Error("scenes.json needs at least one scene.");
  scenes.forEach((scene, i) => {
    if (!(scene.end > scene.start)) throw new Error(`Scene ${i + 1} (${scene.name}) must end after it starts.`);
    if (scene.role && !ROLES.has(scene.role)) throw new Error(`Scene ${i + 1} has role "${scene.role}"; use hook, reveal, highlight, or payoff.`);
    if (i > 0 && scene.start < scenes[i - 1].end - EPS) throw new Error(`Scene ${i + 1} (${scene.name}) starts before scene ${i} ends; scenes must not overlap.`);
  });
  return scenes;
}

export function settledTime(scene) {
  return scene.settled ?? Math.max(scene.start, scene.end - 0.4);
}

export function stillTime(scene) {
  return scene.still ?? settledTime(scene);
}

const length = (scene) => scene.end - scene.start;
const segment = (scene, start = scene.start, end = scene.end) => ({ name: scene.name, start, end });

/** Keep the hook and the payoff; fill with whole middle scenes (reveal first) while they fit. */
export function planCutdown(input, seconds) {
  const scenes = loadScenes(input);
  if (scenes.length === 1) return [segment(scenes[0], scenes[0].start, Math.min(scenes[0].end, scenes[0].start + seconds))];
  const hook = scenes.find((s) => s.role === "hook") ?? scenes[0];
  const payoff = [...scenes].reverse().find((s) => s.role === "payoff") ?? scenes.at(-1);

  if (length(hook) + length(payoff) > seconds + EPS) {
    // Too short for whole scenes: keep the hook's opening and the payoff's landing.
    const hookLength = Math.min(length(hook), seconds * HOOK_SHARE);
    const payoffLength = Math.min(length(payoff), seconds - hookLength);
    return [segment(hook, hook.start, hook.start + hookLength), segment(payoff, payoff.end - payoffLength, payoff.end)];
  }

  const chosen = [hook, payoff];
  let used = length(hook) + length(payoff);
  const middle = scenes.filter((s) => s !== hook && s !== payoff);
  const byPriority = [...middle.filter((s) => s.role === "reveal"), ...middle.filter((s) => s.role !== "reveal")];
  for (const scene of byPriority) {
    if (used + length(scene) <= seconds + FIT_TOLERANCE) {
      chosen.push(scene);
      used += length(scene);
    }
  }
  return chosen.sort((a, b) => a.start - b.start).map((s) => segment(s));
}

/** Consecutive whole scenes packed into segments no longer than `max` seconds. */
export function planStories(input, max = 15) {
  const scenes = loadScenes(input);
  const stories = [];
  let current = null;
  for (const scene of scenes) {
    if (current && scene.end - current.start <= max + EPS) {
      current.end = scene.end;
      current.scenes.push(scene.name);
      continue;
    }
    if (current) stories.push(current);
    let start = scene.start;
    while (scene.end - start > max + EPS) {
      stories.push({ start, end: start + max, scenes: [scene.name] });
      start += max;
    }
    current = { start, end: scene.end, scenes: [scene.name] };
  }
  stories.push(current);
  return stories;
}

function run(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${cmd} failed: ${(result.stderr || "").trim().split("\n").slice(-2).join(" ")}`);
  return result.stdout;
}

function hasAudio(video) {
  return run("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", video]).trim() !== "";
}

/**
 * Hard-cut segments together; each audio edge gets a tiny fade so cuts do not click.
 * `posterAt` bakes that source frame into frame 0, so a segment cut from the middle of the video
 * does not show an entrance frame as its thumbnail.
 */
export function renderSegments(video, segments, output, { posterAt } = {}) {
  mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  const audio = hasAudio(video);
  const parts = [];
  const inputs = [];
  segments.forEach((s, i) => {
    const d = s.end - s.start;
    parts.push(`[0:v]trim=start=${s.start}:end=${s.end},setpts=PTS-STARTPTS[v${i}]`);
    inputs.push(`[v${i}]`);
    if (audio) {
      parts.push(
        `[0:a]atrim=start=${s.start}:end=${s.end},asetpts=PTS-STARTPTS,afade=t=in:d=${AUDIO_EDGE_FADE},afade=t=out:st=${Math.max(0, d - AUDIO_EDGE_FADE)}:d=${AUDIO_EDGE_FADE}[a${i}]`,
      );
      inputs.push(`[a${i}]`);
    }
  });
  const posterInput = posterAt == null ? [] : ["-ss", String(posterAt), "-i", video];
  if (posterAt == null) {
    parts.push(`${inputs.join("")}concat=n=${segments.length}:v=1:a=${audio ? 1 : 0}[v]${audio ? "[a]" : ""}`);
  } else {
    parts.push(`${inputs.join("")}concat=n=${segments.length}:v=1:a=${audio ? 1 : 0}[cut]${audio ? "[a]" : ""}`);
    parts.push(`[1:v]trim=end_frame=1,setpts=PTS-STARTPTS[poster]`);
    parts.push(`[cut][poster]overlay=0:0:enable='eq(n,0)':eof_action=pass[v]`);
  }
  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-i", video, ...posterInput,
    "-filter_complex", parts.join(";"), "-map", "[v]", ...(audio ? ["-map", "[a]", "-c:a", "aac", "-b:a", "192k", "-ar", "48000"] : []),
    "-c:v", "libx264", "-crf", "18", "-preset", "slow", "-pix_fmt", "yuv420p", "-movflags", "+faststart", output,
  ]);
  return output;
}

/** Minimal PDF: one page per JPEG, each image filling its page. */
export function buildPdf(images) {
  const chunks = [];
  const offsets = [];
  let size = 0;
  const push = (data) => {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, "latin1");
    chunks.push(buffer);
    size += buffer.length;
  };
  const object = (id, body, stream) => {
    offsets[id - 1] = size;
    push(`${id} 0 obj\n${body}\n`);
    if (stream) {
      push("stream\n");
      push(stream);
      push("\nendstream\n");
    }
    push("endobj\n");
  };

  push("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
  const pageIds = images.map((_, i) => 3 + i * 3);
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${images.length} >>`);
  images.forEach(({ data, width, height }, i) => {
    const pageId = pageIds[i];
    const content = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`;
    object(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 ${pageId + 1} 0 R >> >> /Contents ${pageId + 2} 0 R >>`);
    object(pageId + 1, `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${data.length} >>`, data);
    object(pageId + 2, `<< /Length ${content.length} >>`, content);
  });

  const xref = size;
  push(`xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`);
  for (const offset of offsets) push(`${String(offset).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(chunks);
}

/** One 1080x1350 slide per scene at its settled moment, plus the same slides as a PDF document. */
export function makeCarousel(video, input, { outDir, size = [1080, 1350] }) {
  const scenes = loadScenes(input);
  mkdirSync(outDir, { recursive: true });
  const slides = scenes.map((scene, i) => {
    const raw = path.join(outDir, `raw-${String(i + 1).padStart(2, "0")}.jpg`);
    const slide = path.join(outDir, `slide-${String(i + 1).padStart(2, "0")}.jpg`);
    run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(stillTime(scene)), "-i", video, "-frames:v", "1", "-q:v", "2", raw]);
    fitImage(raw, slide, size);
    rmSync(raw, { force: true });
    return slide;
  });
  const pdf = path.join(outDir, "carousel.pdf");
  writeFileSync(pdf, buildPdf(slides.map((file) => ({ data: readFileSync(file), width: size[0], height: size[1] }))));
  return { slides, pdf };
}

function parseArgs(argv) {
  const [command, video, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const key = rest[i].replace(/^--/, "");
    options[key] = rest[i + 1];
    i += 1;
  }
  return { command, video, options };
}

function main(argv) {
  if (argv[0] === "plan") {
    const { options } = parseArgs(["plan", "", ...argv.slice(1)]);
    const segments = planCutdown(loadScenes(options.scenes), Number(options.seconds));
    console.log(JSON.stringify({ seconds: Number(options.seconds), keep: segments }, null, 2));
    return;
  }
  const { command, video, options } = parseArgs(argv);
  if (!["cutdown", "stories", "carousel"].includes(command) || !video || !options.scenes || !options.out) {
    console.error("Usage: cuts.mjs cutdown|stories|carousel <brag.mp4> --scenes scenes.json --out <path> [--seconds 6|15] [--max 15]");
    process.exitCode = 2;
    return;
  }
  const scenes = loadScenes(options.scenes);
  if (command === "cutdown") {
    const segments = planCutdown(scenes, Number(options.seconds ?? 15));
    renderSegments(video, segments, options.out);
    console.log(JSON.stringify({ output: options.out, segments }, null, 2));
  } else if (command === "stories") {
    mkdirSync(options.out, { recursive: true });
    const stories = planStories(scenes, Number(options.max ?? 15)).map((story, i) => {
      const output = path.join(options.out, `story-${String(i + 1).padStart(2, "0")}.mp4`);
      // Story 1 starts at 0 and keeps the video's own baked poster; later stories get their first scene's still.
      const first = scenes.find((scene) => scene.name === story.scenes[0]);
      const posterAt = story.start > 0 ? Math.min(Math.max(stillTime(first), story.start), story.end - 0.05) : undefined;
      renderSegments(video, [{ name: story.scenes.join("+"), start: story.start, end: story.end }], output, { posterAt });
      return { ...story, output };
    });
    console.log(JSON.stringify(stories, null, 2));
  } else {
    console.log(JSON.stringify(makeCarousel(video, scenes, { outDir: options.out }), null, 2));
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
