#!/usr/bin/env node
/**
 * Repository integrity checks for CI: plugin manifests, agent discovery
 * symlinks, SKILL.md frontmatter, relative markdown links, scripts the skill
 * references, and music cue presets.
 *
 *   node scripts/validate-repo.mjs
 */

import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_DIR = "skills/brag";
const DISCOVERY_LINKS = [".claude/skills/brag", ".agents/skills/brag", ".opencode/skills/brag"];
const SEMVER = /^\d+\.\d+\.\d+(-[\w.]+)?$/;

function readJson(root, rel, problems) {
  try {
    return JSON.parse(readFileSync(path.join(root, rel), "utf8"));
  } catch (error) {
    problems.push(`${rel} is not valid JSON (${error.message})`);
    return null;
  }
}

export function checkManifests(root) {
  const problems = [];
  const plugin = readJson(root, ".claude-plugin/plugin.json", problems);
  const marketplace = readJson(root, ".claude-plugin/marketplace.json", problems);
  if (plugin) {
    for (const field of ["name", "version", "description"]) {
      if (!plugin[field]) problems.push(`.claude-plugin/plugin.json is missing ${field}`);
    }
    if (plugin.version && !SEMVER.test(plugin.version)) {
      problems.push(`.claude-plugin/plugin.json version "${plugin.version}" is not semver`);
    }
  }
  if (marketplace) {
    if (!marketplace.owner?.name) problems.push(".claude-plugin/marketplace.json is missing owner.name");
    const names = (marketplace.plugins ?? []).map((p) => p.name);
    if (plugin?.name && !names.includes(plugin.name)) {
      problems.push(`.claude-plugin/marketplace.json lists ${names.map((n) => `"${n}"`).join(", ")} but plugin.json is "${plugin.name}"`);
    }
  }
  return problems;
}

export function checkSymlinks(root) {
  const problems = [];
  const target = path.join(root, SKILL_DIR);
  for (const rel of DISCOVERY_LINKS) {
    const full = path.join(root, rel);
    let stat;
    try {
      stat = lstatSync(full);
    } catch {
      problems.push(`${rel} is missing`);
      continue;
    }
    if (!stat.isSymbolicLink()) {
      problems.push(`${rel} is not a symlink to ${SKILL_DIR} (a copy drifts out of date)`);
    } else if (!existsSync(full) || realpathSync(full) !== realpathSync(target)) {
      problems.push(`${rel} does not resolve to ${SKILL_DIR}`);
    }
  }
  return problems;
}

export function checkSkillFrontmatter(root) {
  const rel = `${SKILL_DIR}/SKILL.md`;
  const text = readFileSync(path.join(root, rel), "utf8");
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return [`${rel} has no frontmatter`];
  return ["name", "description"]
    .filter((field) => !new RegExp(`^${field}:\\s*\\S`, "m").test(match[1]))
    .map((field) => `${rel} frontmatter is missing ${field}`);
}

function markdownFiles(root) {
  const files = ["README.md", "ROADMAP.md", "PRODUCT.md"].filter((f) => existsSync(path.join(root, f)));
  const walk = (dir) => {
    for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory() && entry.name !== "node_modules") walk(rel);
      else if (entry.isFile() && entry.name.endsWith(".md")) files.push(rel);
    }
  };
  for (const dir of [SKILL_DIR, "docs"]) if (existsSync(path.join(root, dir))) walk(dir);
  return files;
}

export function checkMarkdownLinks(root, files = markdownFiles(root)) {
  const problems = [];
  for (const rel of files) {
    const text = readFileSync(path.join(root, rel), "utf8").replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
    for (const [, target] of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      if (/^([a-z][a-z0-9+.-]*:|#|<)/i.test(target)) continue;
      const clean = decodeURIComponent(target.split("#")[0]);
      if (!clean) continue;
      const resolved = path.normalize(path.join(path.dirname(rel), clean));
      if (!existsSync(path.join(root, resolved))) problems.push(`${rel} links to missing ${resolved.split(path.sep).join("/")}`);
    }
  }
  return problems;
}

export function checkReferencedScripts(root) {
  const problems = [];
  for (const rel of markdownFiles(root).filter((f) => f.startsWith(SKILL_DIR))) {
    const text = readFileSync(path.join(root, rel), "utf8");
    const scripts = new Set([...text.matchAll(/<skill-root>\/(scripts\/[\w.-]+\.(?:mjs|py|js))/g)].map((m) => m[1]));
    for (const script of scripts) {
      if (!existsSync(path.join(root, SKILL_DIR, script))) problems.push(`${rel} references missing ${script}`);
    }
  }
  return problems;
}

export function checkMusicCues(root) {
  const musicDir = path.join(root, SKILL_DIR, "assets/music");
  if (!existsSync(musicDir)) return [];
  const problems = [];
  for (const track of readdirSync(musicDir).filter((f) => /\.(mp3|wav|ogg|m4a)$/i.test(f))) {
    const stem = track.replace(/\.[^.]+$/, "");
    for (const ext of ["json", "md"]) {
      const cue = `cues/${stem}.music-cues.${ext}`;
      if (!existsSync(path.join(musicDir, cue)) || !statSync(path.join(musicDir, cue)).isFile()) {
        problems.push(`music track ${track} is missing ${cue}`);
      }
    }
  }
  return problems;
}

export function validateRepo(root) {
  const checks = {
    manifests: checkManifests(root),
    symlinks: checkSymlinks(root),
    frontmatter: checkSkillFrontmatter(root),
    links: checkMarkdownLinks(root),
    scripts: checkReferencedScripts(root),
    musicCues: checkMusicCues(root),
  };
  return { checks, problems: Object.values(checks).flat() };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const { checks, problems } = validateRepo(root);
  for (const [name, list] of Object.entries(checks)) {
    console.log(`${list.length === 0 ? "✓" : "✗"} ${name}`);
    for (const problem of list) console.log(`    ${problem}`);
  }
  process.exitCode = problems.length > 0 ? 1 : 0;
}
