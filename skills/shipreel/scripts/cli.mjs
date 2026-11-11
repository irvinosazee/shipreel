#!/usr/bin/env node
/**
 * shipreel: /shipreel for people who do not use a coding agent. Published as @irvinosazee/shipreel,
 * so without a global install every line below starts `npx @irvinosazee/shipreel` instead.
 *
 *   shipreel make [project-dir] [--format landscape|vertical|square] [--out shipreel-output] [--screenshot home.png] [--no-capture]
 *   shipreel release [project-dir] --tag v1.2.0 [--out shipreel-release]
 *   shipreel preview --base https://site.com --head https://pr-7.preview.app --changed-files changed.txt --out shipreel-pr
 *   shipreel kit [output-dir] [--url https://…]
 *   shipreel embed [project-dir] --video shipreel-output/shipreel.mp4 --poster shipreel-output/shipreel.jpg [--apply]
 *   shipreel github install release|pr-preview [project-dir]
 *   shipreel doctor | verify | platforms | captions | covers | cuts | … (every skill script)
 *
 * `make` is the agent-free floor: it reads the project (package metadata, README features, git
 * history), captures the running site when it can, fills the card template, renders, masters,
 * bakes the poster, verifies, and writes share copy and scenes.json so `kit` and `cuts` work on it.
 * With a coding agent, /shipreel writes a bespoke video instead; this CLI never calls a model.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = { release: "release-video.yml", "pr-preview": "pr-preview.yml" };
const MAX_WORDS = 10;
const DANGLING = /^(and|or|with|the|a|an|to|of|for|in|on|by)$/i;

export const COMMANDS = {
  make: { summary: "make a launch video for a project, no agent needed" },
  release: { script: "release_video.mjs", summary: "a release video from a git tag" },
  preview: { script: "pr_preview.mjs", summary: "a before/after clip of the pages a pull request changes" },
  max: { script: "campaign.mjs", summary: "a whole campaign: brief, 3 to 5 pieces per platform, calendar, checked" },
  brief: { script: "brief.mjs", summary: "the marketing brief behind a campaign (init|read)" },
  "campaign-check": { script: "campaign_check.mjs", summary: "check a campaign: limits, hashtags, alt text, claims, honesty" },
  images: { summary: "launch images (link preview, X, GitHub, Product Hunt, LinkedIn), checked" },
  kit: { script: "launch_kit.mjs", summary: "bundle videos, images, captions, and embeds into a launch kit" },
  embed: { script: "embed.mjs", summary: "a patch that adds the video to the project's own site" },
  github: { summary: "install a workflow: github install release|pr-preview [project-dir]" },
  doctor: { script: "doctor.mjs", summary: "check Node, FFmpeg, Hyperframes, and bundled audio" },
  detect: { script: "detect_project.mjs", summary: "classify a project" },
  template: { script: "template_video.mjs", summary: "build a card composition from content.json" },
  render: { script: "deliver.mjs", summary: "render or finish a composition (deliver.mjs render|finish)" },
  verify: { script: "verify_render.mjs", summary: "check a rendered video against the delivery contract" },
  "verify-images": { script: "verify_image.mjs", summary: "check launch images: size, budget, legibility, contrast, claims" },
  "copy-check": { script: "copy_check.mjs", summary: "check launch copy against each platform's limits" },
  dossier: { script: "dossier.mjs", summary: "everything shipreel knows about a project, as one JSON file" },
  platforms: { script: "platforms.mjs", summary: "plan and export per-platform files" },
  captions: { script: "captions.mjs", summary: "write and burn captions" },
  covers: { script: "covers.mjs", summary: "thumbnails and link previews from the poster" },
  cuts: { script: "cuts.mjs", summary: "cutdowns, stories, carousels, chapters" },
  formats: { script: "formats.mjs", summary: "stamp vertical, square, and feed compositions" },
  "text-audit": { script: "text_audit.mjs", summary: "check on-screen text is legible and held long enough" },
  capture: { script: "capture.mjs", summary: "start a project and screenshot its pages" },
  footage: { script: "footage.mjs", summary: "find the active moments in a screen recording" },
  golden: { script: "golden.mjs", summary: "golden-frame regression for renders" },
  i18n: { script: "i18n.mjs", summary: "translate a composition" },
  studio: { script: "studio.mjs", summary: "review renders and leave notes" },
  versions: { script: "versions.mjs", summary: "save and compare render versions" },
  "upload-page": { script: "upload_page.mjs", summary: "an upload checklist page for exports" },
  skill: { script: "skill_install.mjs", summary: "install the skill where your agent will find it" },
};

function version() {
  for (const candidate of ["../../../package.json", "../../../.claude-plugin/plugin.json"]) {
    const file = path.join(HERE, candidate);
    if (!existsSync(file)) continue;
    const data = JSON.parse(readFileSync(file, "utf8"));
    if (data.version) return data.version;
  }
  return "0.0.0";
}

function help() {
  const width = Math.max(...Object.keys(COMMANDS).map((n) => n.length));
  return [
    `shipreel ${version()}: launch videos for your projects`,
    "",
    "Usage: shipreel <command> [options]",
    "",
    "Commands:",
    ...Object.entries(COMMANDS).map(([name, { summary }]) => `  ${name.padEnd(width)}  ${summary}`),
    "",
    "Run a command without options for its usage. Needs Node 22+, FFmpeg, and Chrome; renders use `npx hyperframes`.",
    "",
  ].join("\n");
}

const strip = (text) => text.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\*\*|__|`|\*/g, "").replace(/\s+/g, " ").trim();
const shorten = (text, maxWords = MAX_WORDS) => {
  const tokens = text.split(" ");
  if (tokens.length <= maxWords) return text;
  const kept = tokens.slice(0, maxWords);
  while (kept.length > 1 && DANGLING.test(kept.at(-1))) kept.pop();
  return `${kept.join(" ").replace(/[,;:]$/, "")}…`;
};

/** Up to four feature bullets: a Features/Highlights/Why section first, otherwise the first list that is not install steps or links. */
export function readmeHighlights(markdown, max = 4, { maxWords = MAX_WORDS } = {}) {
  const sections = [];
  let current = { heading: "", bullets: [] };
  for (const line of String(markdown ?? "").split("\n")) {
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      sections.push(current);
      current = { heading: heading[1], bullets: [] };
      continue;
    }
    // Top-level bullets only: nested ones are sub-steps. Environment variable lists are configuration, not features.
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet && !/^`?[A-Z][A-Z0-9_]{2,}`?(\s|$)/.test(bullet[1])) current.bullets.push(bullet[1]);
  }
  sections.push(current);
  // File listings ("src/ — the app") describe the repository, not the product.
  const useful = (s) => s.bullets.map(strip).filter((b) => b.split(" ").length >= 2 && !/^(npm|npx|pnpm|yarn|pip|cargo|brew|git|curl)\b/i.test(b) && !/^\.?[\w.-]+(\/[\w.-]*)+\s/.test(b));
  const skip = /install|setup|getting started|license|contribut|usage|requirements|develop|test|changelog|credits|links?|docs|deploy|environment|config|architecture|stack|run it|in this repo|repo(sitory)? (layout|structure)|layout|structure|folders|files/i;
  const preferred = sections.find((s) => /feature|highlight|what it does|why|capabilit/i.test(s.heading) && useful(s).length);
  const fallback = sections.find((s) => !skip.test(s.heading) && useful(s).length >= 2);
  return (preferred ?? fallback) ? useful(preferred ?? fallback).slice(0, max).map((b) => shorten(b, maxWords)) : [];
}

export function scenesFromPlan(plan) {
  const role = (id, i) => (id === "hook" ? "hook" : id === "outro" ? "payoff" : i === 1 ? "reveal" : "highlight");
  return plan.scenes.map((scene, i) => ({
    name: scene.id,
    start: scene.start,
    end: Math.round((scene.start + scene.duration) * 1000) / 1000,
    role: role(scene.id, i),
    settled: Math.round((scene.start + Math.min(1.2, scene.duration - 0.3)) * 1000) / 1000,
  }));
}

export function shareCopyFor(info, url) {
  const line = info.description ? `${info.name}: ${info.description.replace(/[.!?]+$/, "")}.` : `${info.name}.`;
  return url ? `${line}\n${url}` : line;
}

export function installWorkflow(projectDir, kind) {
  const template = TEMPLATES[kind];
  if (!template) throw new Error(`Unknown workflow "${kind}". Use one of: ${Object.keys(TEMPLATES).join(", ")}.`);
  const target = path.join(projectDir, ".github", "workflows", `shipreel-${template}`);
  if (existsSync(target)) throw new Error(`${target} already exists; delete it first to reinstall.`);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(path.join(HERE, "..", "assets", "github", template), target);
  return target;
}

/** `shipreel images`: dossier, then cards, then the checks, in one go. Exits 1 when a card fails. */
async function images(args) {
  const { buildDossier } = await import("./dossier.mjs");
  const { extractStills, renderCards } = await import("./cards.mjs");
  const { verifyCards } = await import("./verify_image.mjs");
  const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const dir = path.resolve(args.find((a, i) => !a.startsWith("--") && !["--out", "--only"].includes(args[i - 1])) ?? ".");
  const out = path.resolve(dir, flag("--out") ?? "shipreel-output");
  mkdirSync(out, { recursive: true });
  extractStills(out);
  const dossier = buildDossier(dir, { outDir: out });
  writeFileSync(path.join(out, "dossier.json"), `${JSON.stringify(dossier, null, 2)}\n`);
  if (!dossier.media.posters.length && !dossier.media.frames.length && !dossier.media.captures.length) {
    console.error("shipreel: no posters, frames, or captures in the output folder yet; the cards will be text-only. Make a video first for cards that show the product.");
  }
  const { dir: cardsDir, cards, pdf } = await renderCards(dossier, { projectDir: dir, outDir: out, targets: flag("--only")?.split(",") });
  const claims = dossier.claims.map(({ text, source, quote }) => ({ text, source, quote }));
  const report = await verifyCards(cardsDir, { claims });
  for (const c of report.cards) {
    console.log(`${c.errors.length ? "✗" : "✓"} ${path.relative(process.cwd(), path.join(cardsDir, c.file))}  ${c.size.join("x")}`);
    for (const e of c.errors) console.log(`    ✗ ${e.code}: ${e.message}`);
    for (const w of c.warnings) console.log(`    ! ${w.code}: ${w.message}`);
  }
  if (pdf) console.log(`  ${path.relative(process.cwd(), pdf)}`);
  console.error(report.ok ? `shipreel: ${cards.length} image(s) verified.` : "shipreel: fix the errors above before posting.");
  return report.ok ? 0 : 1;
}

async function make(args) {
  const { projectInfo } = await import("./release_video.mjs");
  const { detectProject } = await import("./detect_project.mjs");
  const { gitStory } = await import("./git_story.mjs");
  const { DEFAULT_MUSIC, writeCardProject } = await import("./template_video.mjs");
  const { finishVideo, renderComposition } = await import("./deliver.mjs");
  const { makeCovers } = await import("./covers.mjs");

  const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--") && !["--no-capture", "--no-music"].includes(args[i - 1])));
  const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
  const dir = path.resolve(positional[0] ?? ".");
  const format = flag("--format", "landscape");
  const out = path.resolve(flag("--out", path.join(dir, "shipreel-output")));
  mkdirSync(out, { recursive: true });
  const log = (message) => console.error(`shipreel: ${message}`);

  const info = projectInfo(dir);
  const detected = detectProject(dir);
  const readme = ["README.md", "readme.md", "Readme.md"].map((f) => path.join(dir, f)).find(existsSync);
  const highlights = readme ? readmeHighlights(readFileSync(readme, "utf8")) : [];
  log(`${info.name} looks like a ${detected.type}${detected.framework ? ` (${detected.framework})` : ""}`);

  const stats = [];
  try {
    const story = gitStory(dir);
    if (story.commits > 1) stats.push({ value: String(story.commits), label: "commits" });
    if (story.days > 1) stats.push({ value: String(story.days), label: "days of work" });
  } catch {
    // Not a git repository: no build-story stats.
  }

  const screenshots = [];
  if (flag("--screenshot")) {
    screenshots.push({ file: path.resolve(flag("--screenshot")), caption: "the real thing" });
  } else if (!args.includes("--no-capture") && ["web-app", "landing-page"].includes(detected.type)) {
    const { capturePages, startProject } = await import("./capture.mjs");
    try {
      log("starting the project to capture it…");
      const server = await startProject(dir);
      try {
        const viewport = format === "landscape" ? [1440, 900] : [1080, 1920];
        const [shot] = await capturePages(server.url, { routes: ["/"], viewport, outDir: path.join(out, "capture") });
        screenshots.push({ file: shot.screenshot, caption: "the real thing" });
      } finally {
        await server.stop();
      }
    } catch (error) {
      log(`skipping the screenshot: ${error.message.split("\n")[0]}`);
    }
  }

  const url = info.homepage ?? info.repository ?? null;
  const content = {
    kicker: detected.type === "unknown" ? "introducing" : `a new ${detected.type.replace("-", " ")}`,
    title: info.name,
    subtitle: info.tagline ?? undefined,
    stats,
    screenshots,
    highlights: highlights.length ? { heading: "what it does", items: highlights } : undefined,
    outro: { line: `try ${info.name}`, detail: info.install ?? url ?? undefined },
  };
  writeFileSync(path.join(out, "content.json"), `${JSON.stringify(content, null, 2)}\n`);
  const composition = path.join(out, "composition");
  const music = args.includes("--no-music") ? null : DEFAULT_MUSIC;
  const { plan } = writeCardProject(content, { outDir: composition, format, music });
  if (plan.dropped.length) log(`left out to stay under 25s: ${plan.dropped.join(", ")}`);

  log("rendering…");
  const video = renderComposition(composition, { output: path.join(out, "shipreel.mp4"), quality: flag("--quality", "looks") });
  const report = finishVideo(video, { posterAt: plan.posterAt, poster: path.join(out, "shipreel.jpg"), expect: { format, minDuration: 5, maxDuration: 25, audio: Boolean(music) } });
  makeCovers(path.join(out, "shipreel.jpg"), { outDir: path.join(out, "covers") });
  writeFileSync(path.join(out, "scenes.json"), `${JSON.stringify(scenesFromPlan(plan), null, 2)}\n`);
  writeFileSync(path.join(out, "share-copy.txt"), `${shareCopyFor(info, url)}\n`);

  console.log(JSON.stringify({ video, poster: path.join(out, "shipreel.jpg"), duration: plan.duration, ok: report.ok, errors: report.errors, warnings: report.warnings, next: `shipreel kit ${path.relative(process.cwd(), out).startsWith("..") ? out : path.relative(process.cwd(), out) || "."}` }, null, 2));
  return report.ok ? 0 : 1;
}

export async function main(argv) {
  const [command, ...args] = argv;
  if (!command || command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(help());
    return 0;
  }
  if (command === "--version" || command === "-v") {
    console.log(version());
    return 0;
  }
  const entry = COMMANDS[command];
  if (!entry) {
    console.error(`Unknown command "${command}". Run shipreel --help.`);
    return 2;
  }
  if (command === "make") return make(args);
  if (command === "images") return images(args);
  if (command === "github") {
    if (args[0] !== "install" || !args[1]) {
      console.error("Usage: shipreel github install release|pr-preview [project-dir]");
      return 2;
    }
    const file = installWorkflow(path.resolve(args[2] ?? "."), args[1]);
    console.log(file);
    console.error("Commit it. The workflow's header lists the repository settings it needs.");
    return 0;
  }
  const result = spawnSync(process.execPath, [path.join(HERE, entry.script), ...args], { stdio: "inherit" });
  return result.status ?? 1;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}
