#!/usr/bin/env node
/**
 * Release videos: turn a git tag into a short card video, with no agent needed.
 *
 *   node <skill-root>/scripts/release_video.mjs <project-dir> --tag v1.2.0 --out <dir> [--since v1.1.0] [--notes notes.md]
 *        [--format landscape|vertical|square] [--no-music] [--content-only] [--quality looks]
 *
 * The range is <previous tag>..<tag> (or --since). Highlights come from the release notes when
 * --notes is given (GitHub's generated "* feat: x by @y in url" bullets work), otherwise from
 * commit subjects: features first, then fixes and performance, with chores, docs, CI, and version
 * bumps only as a fallback. Stats are commits, contributors (when more than one), and files
 * changed. The outro is the install command for this version, or the homepage/repository.
 *
 * Writes <out>/content.json and <out>/composition/, then renders <out>/release.mp4, masters it,
 * bakes the poster, and verifies it. --content-only stops after content.json and the composition.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_MUSIC, writeCardProject } from "./template_video.mjs";
import { finishVideo, renderComposition } from "./deliver.mjs";

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const MAX_WORDS = 10;
const DANGLING = /^(and|or|with|the|a|an|to|of|for|in|on|by)$/i;
const PRIORITY = { feat: 0, fix: 1, perf: 2 };
const LOW = new Set(["chore", "docs", "ci", "test", "tests", "build", "style", "refactor", "release"]);

function git(dir, args) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function cleanSubject(subject) {
  let text = String(subject).trim();
  const match = text.match(/^([a-z]+)(\([^)]*\))?(!)?:\s*(.+)$/i);
  let kind = null;
  let breaking = false;
  if (match) {
    kind = match[1].toLowerCase();
    breaking = Boolean(match[3]);
    text = match[4];
  }
  // Trailing references like (#42), (#1, #2), or (B10) are bookkeeping, not part of the change.
  text = text.replace(/\s*\((?:#\d+(?:,\s*)?)+\)\s*$/, "").replace(/\s*\([A-Z]{1,4}-?\d+\)\s*$/, "").replace(/\.$/, "").trim();
  return { kind, breaking, text };
}

function shorten(text) {
  const tokens = text.split(/\s+/);
  if (tokens.length <= MAX_WORDS) return text;
  const kept = tokens.slice(0, MAX_WORDS);
  while (kept.length > 1 && DANGLING.test(kept.at(-1))) kept.pop();
  return `${kept.join(" ").replace(/[,;:]$/, "")}…`;
}

export function pickHighlights(subjects, max = 4, { keepOrder = false } = {}) {
  const parsed = subjects
    .filter((s) => !/^Merge (pull request|branch|remote-tracking)/.test(s) && !/^v?\d+\.\d+(\.\d+)?\S*$/.test(s.trim()))
    .map((s, index) => ({ ...cleanSubject(s), index }))
    .filter((c) => c.text);
  const strong = parsed.filter((c) => !LOW.has(c.kind));
  const pool = strong.length ? strong : parsed;
  return pool
    .sort((a, b) => (keepOrder ? 0 : (PRIORITY[a.kind] ?? 1.5) - (PRIORITY[b.kind] ?? 1.5)) || a.index - b.index)
    .slice(0, max)
    .map((c) => shorten(c.text));
}

export function notesHighlights(markdown, max = 4) {
  const bullets = String(markdown ?? "")
    .split("\n")
    .map((line) => line.match(/^\s*[-*]\s+(.+)$/)?.[1])
    .filter(Boolean)
    .map((line) =>
      line
        .replace(/\s+by @[\w-]+ in https?:\/\/\S+$/, "")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/\*\*|__|`/g, "")
        .trim(),
    );
  // Release notes are ordered by a person; keep that order and only drop the chores.
  return pickHighlights(bullets, max, { keepOrder: true });
}

export function previousTag(dir, tag) {
  try {
    return git(dir, ["describe", "--tags", "--abbrev=0", `${tag}^`]);
  } catch {
    return null;
  }
}

function tomlValue(text, section, key) {
  const block = text.split(/^\[/m).find((part) => part.startsWith(`${section}]`));
  return block?.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, "m"))?.[1] ?? null;
}

function repositoryUrl(dir) {
  try {
    const remote = git(dir, ["remote", "get-url", "origin"]);
    const match = remote.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
    return match ? `https://github.com/${match[1]}/${match[2]}` : null;
  } catch {
    return null;
  }
}

/** A subtitle-sized description: the first sentence, plus the second when the first is a short hook. */
export function tagline(description) {
  if (!description) return null;
  const sentences = description.match(/[^.!?]+[.!?]+|[^.!?]+$/g).map((s) => s.trim());
  const text = sentences[0].length < 45 && sentences[1] ? `${sentences[0]} ${sentences[1]}` : sentences[0];
  return text.length <= 120 ? text : `${text.slice(0, 119).replace(/\s+\S*$/, "")}…`;
}

export function projectInfo(dir) {
  const info = { name: null, description: null, version: null, homepage: null, install: null, ecosystem: null, repository: repositoryUrl(dir) };
  const pkgPath = path.join(dir, "package.json");
  const pyPath = path.join(dir, "pyproject.toml");
  const cargoPath = path.join(dir, "Cargo.toml");
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    // A private root package ("brag-repo", "monorepo") is not the product's name; the README heading is.
    Object.assign(info, { name: pkg.private ? null : pkg.name ?? null, description: pkg.description ?? null, version: pkg.version ?? null, homepage: pkg.homepage ?? null, ecosystem: "npm" });
    if (pkg.name && !pkg.private) info.install = pkg.bin ? `npx ${pkg.name}` : `npm i ${pkg.name}`;
  } else if (existsSync(pyPath)) {
    const toml = readFileSync(pyPath, "utf8");
    Object.assign(info, { name: tomlValue(toml, "project", "name"), description: tomlValue(toml, "project", "description"), version: tomlValue(toml, "project", "version"), ecosystem: "pypi" });
    if (info.name) info.install = `pip install ${info.name}`;
  } else if (existsSync(cargoPath)) {
    const toml = readFileSync(cargoPath, "utf8");
    Object.assign(info, { name: tomlValue(toml, "package", "name"), description: tomlValue(toml, "package", "description"), version: tomlValue(toml, "package", "version"), ecosystem: "crates" });
    if (info.name) info.install = `cargo add ${info.name}`;
  }
  const readme = ["README.md", "readme.md", "Readme.md"].map((f) => path.join(dir, f)).find(existsSync);
  if (readme) {
    const lines = readFileSync(readme, "utf8").split("\n");
    info.name ??= lines.find((l) => /^#\s+\S/.test(l))?.replace(/^#\s+/, "").replace(/<[^>]+>/g, "").replace(/[*_`]/g, "").trim() || null;
    // The first prose paragraph, joined across its wrapped lines.
    const start = lines.findIndex((l) => l.trim() && !/^(#|!\[|\[!\[|<|>|```|---|\||[-*]\s)/.test(l.trim()));
    if (start !== -1 && !info.description) {
      const paragraph = [];
      for (let i = start; i < lines.length && lines[i].trim() && !/^(#|```|[-*]\s|\|)/.test(lines[i].trim()); i += 1) paragraph.push(lines[i].trim());
      info.description = paragraph.join(" ").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_`]/g, "").trim() || null;
    }
  }
  info.name ??= path.basename(path.resolve(dir));
  info.tagline = tagline(info.description);
  return info;
}

function rangeStats(dir, from, to) {
  const range = from ? `${from}..${to}` : to;
  const subjects = git(dir, ["log", "--reverse", "--no-merges", "--format=%s", range]).split("\n").filter(Boolean);
  const commits = Number(git(dir, ["rev-list", "--count", range]));
  const contributors = new Set(git(dir, ["log", "--format=%ae", range]).split("\n").filter(Boolean).map((e) => e.toLowerCase())).size;
  const stat = git(dir, ["diff", "--shortstat", from ?? EMPTY_TREE, to]);
  const filesChanged = Number(stat.match(/(\d+) files? changed/)?.[1] ?? 0);
  return { range, subjects, commits, contributors, filesChanged };
}

export function releaseContent(dir, { tag, since, notes } = {}) {
  const to = tag ?? "HEAD";
  const from = since ?? (tag ? previousTag(dir, tag) : null);
  const info = projectInfo(dir);
  const stats = rangeStats(dir, from, to);
  const semver = tag?.match(/^v?(\d+\.\d+\.\d+\S*)$/)?.[1] ?? null;
  const version = semver ?? info.version;
  const items = notes ? notesHighlights(notes) : pickHighlights(stats.subjects);
  if (!items.length) throw new Error(`No changes found in ${stats.range}; nothing to put in a release video.`);

  let detail = info.homepage ?? info.repository;
  if (info.install && version) {
    detail = info.ecosystem === "npm" && !info.install.startsWith("npx ") ? `${info.install}@${version}` : info.ecosystem === "pypi" ? `${info.install}==${version}` : info.install;
  }
  return {
    kicker: "new release",
    title: [info.name, tag ?? (version ? `v${version}` : null)].filter(Boolean).join(" "),
    subtitle: info.tagline ?? undefined,
    stats: [
      { value: String(stats.commits), label: stats.commits === 1 ? "commit" : "commits" },
      ...(stats.contributors > 1 ? [{ value: String(stats.contributors), label: "contributors" }] : []),
      ...(stats.filesChanged ? [{ value: String(stats.filesChanged), label: stats.filesChanged === 1 ? "file changed" : "files changed" }] : []),
    ],
    highlights: { heading: "what's new", items },
    outro: { line: "out now", detail: detail ?? undefined },
    range: stats.range,
  };
}

export async function makeReleaseVideo(dir, { tag, since, notes, outDir, format = "landscape", music = DEFAULT_MUSIC, contentOnly = false, quality = "looks" }) {
  mkdirSync(outDir, { recursive: true });
  const content = releaseContent(dir, { tag, since, notes });
  writeFileSync(path.join(outDir, "content.json"), `${JSON.stringify(content, null, 2)}\n`);
  const composition = path.join(outDir, "composition");
  const { plan } = writeCardProject(content, { outDir: composition, format, music });
  if (contentOnly) return { content, plan, composition };
  const video = renderComposition(composition, { output: path.join(outDir, "release.mp4"), quality });
  const report = finishVideo(video, { posterAt: plan.posterAt, expect: { format, minDuration: 5, maxDuration: 25, audio: Boolean(music) } });
  return { content, plan, composition, video, report };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const [dir, ...rest] = process.argv.slice(2);
  const flag = (name, fallback) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : fallback);
  if (!dir || !flag("--out")) {
    console.error("Usage: release_video.mjs <project-dir> --out <dir> [--tag v1.2.0] [--since v1.1.0] [--notes notes.md] [--format landscape] [--no-music] [--content-only]");
    process.exitCode = 2;
  } else {
    try {
      const result = await makeReleaseVideo(dir, {
        tag: flag("--tag"),
        since: flag("--since"),
        notes: flag("--notes") ? readFileSync(flag("--notes"), "utf8") : undefined,
        outDir: flag("--out"),
        format: flag("--format", "landscape"),
        music: rest.includes("--no-music") ? null : DEFAULT_MUSIC,
        contentOnly: rest.includes("--content-only"),
        quality: flag("--quality", "looks"),
      });
      console.log(JSON.stringify({ video: result.video ?? null, composition: result.composition, duration: result.plan.duration, dropped: result.plan.dropped, ok: result.report?.ok ?? null, errors: result.report?.errors ?? [], warnings: result.report?.warnings ?? [] }, null, 2));
      if (result.report && !result.report.ok) process.exitCode = 1;
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
