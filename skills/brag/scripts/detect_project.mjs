#!/usr/bin/env node
/**
 * Classify the project /brag is about to inspect, so Step 1 can pick a
 * matching inspection and storytelling strategy (see references/project-types.md).
 *
 *   node <skill-root>/scripts/detect_project.mjs [project-dir]
 *
 * Prints JSON: { type, confidence, framework, signals, alsoLooksLike, subprojects, inspect }.
 * Detection is heuristic and file-based only; it never executes project code.
 */

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_TYPES = [
  "landing-page",
  "web-app",
  "cli",
  "library",
  "api",
  "mobile",
  "game",
  "data-ml",
  "unknown",
];

const IGNORED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", ".svelte-kit",
  ".turbo", ".vercel", "coverage", "target", "vendor", ".venv", "venv", "__pycache__",
  "Pods", ".gradle", "brag-output",
]);
const MAX_DEPTH = 4;
const MAX_FILES = 5000;

// Dependency name → [type, weight, framework label]
const JS_DEPS = {
  next: ["web-app", 4, "next"],
  nuxt: ["web-app", 4, "nuxt"],
  "@remix-run/react": ["web-app", 4, "remix"],
  "@sveltejs/kit": ["web-app", 4, "sveltekit"],
  "@angular/core": ["web-app", 4, "angular"],
  "@tanstack/react-start": ["web-app", 4, "tanstack-start"],
  react: ["web-app", 3, "react"],
  vue: ["web-app", 3, "vue"],
  svelte: ["web-app", 3, "svelte"],
  "solid-js": ["web-app", 3, "solid"],
  astro: ["landing-page", 3, "astro"],
  electron: ["web-app", 3, "electron"],
  commander: ["cli", 2, "commander"],
  yargs: ["cli", 2, "yargs"],
  "@oclif/core": ["cli", 3, "oclif"],
  ink: ["cli", 3, "ink"],
  cac: ["cli", 2, "cac"],
  clipanion: ["cli", 2, "clipanion"],
  express: ["api", 3, "express"],
  fastify: ["api", 3, "fastify"],
  hono: ["api", 3, "hono"],
  koa: ["api", 3, "koa"],
  elysia: ["api", 3, "elysia"],
  "@hapi/hapi": ["api", 3, "hapi"],
  h3: ["api", 2, "h3"],
  "@nestjs/core": ["api", 4, "nestjs"],
  "@trpc/server": ["api", 2, "trpc"],
  expo: ["mobile", 5, "expo"],
  "react-native": ["mobile", 5, "react-native"],
  "@capacitor/core": ["mobile", 4, "capacitor"],
  phaser: ["game", 5, "phaser"],
  "pixi.js": ["game", 4, "pixi"],
  kaboom: ["game", 5, "kaboom"],
  kaplay: ["game", 5, "kaplay"],
  "@babylonjs/core": ["game", 3, "babylon"],
};

const PY_DEPS = {
  fastapi: ["api", 4, "fastapi"],
  flask: ["api", 3, "flask"],
  django: ["web-app", 4, "django"],
  streamlit: ["data-ml", 3, "streamlit"],
  gradio: ["data-ml", 3, "gradio"],
  typer: ["cli", 3, "typer"],
  click: ["cli", 2, "click"],
  torch: ["data-ml", 2, "pytorch"],
  tensorflow: ["data-ml", 2, "tensorflow"],
  "scikit-learn": ["data-ml", 2, "scikit-learn"],
  transformers: ["data-ml", 2, "transformers"],
  pandas: ["data-ml", 1, "pandas"],
  pygame: ["game", 5, "pygame"],
};

const OTHER_MANIFEST_DEPS = [
  ["Cargo.toml", /^\s*clap\s*=/m, "cli", 3, "clap"],
  ["Cargo.toml", /^\s*(axum|actix-web|rocket)\s*=/m, "api", 4, "rust-web"],
  ["Cargo.toml", /^\s*bevy\s*=/m, "game", 5, "bevy"],
  ["go.mod", /github\.com\/spf13\/cobra/, "cli", 3, "cobra"],
  ["go.mod", /github\.com\/(gin-gonic\/gin|labstack\/echo|gofiber\/fiber)/, "api", 4, "go-web"],
  ["pubspec.yaml", /sdk:\s*flutter/, "mobile", 5, "flutter"],
];

function walk(root) {
  const files = [];
  const visit = (dir, depth) => {
    if (depth > MAX_DEPTH || files.length >= MAX_FILES) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) visit(full, depth + 1);
      } else if (entry.isFile()) {
        files.push(path.relative(root, full).split(path.sep).join("/"));
      }
    }
  };
  visit(root, 0);
  return files.sort();
}

function readText(root, rel) {
  try {
    return readFileSync(path.join(root, rel), "utf8");
  } catch {
    return null;
  }
}

function readJson(root, rel) {
  const text = readText(root, rel);
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function pythonDeps(root) {
  const text = [readText(root, "requirements.txt"), readText(root, "pyproject.toml")]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  if (!text) return [];
  return Object.keys(PY_DEPS).filter((name) =>
    new RegExp(`(^|[\\s"'\\[,])${name.replace(/[.-]/g, "[._-]")}([\\s"'<>=~!\\],;\\[]|$)`, "m").test(text),
  );
}

const MANIFESTS = ["package.json", "pyproject.toml", "requirements.txt", "Cargo.toml", "go.mod", "pubspec.yaml", "project.godot"];
// When a repo holds several subprojects, the most showable one leads the story.
const STORY_PRIORITY = ["mobile", "game", "web-app", "landing-page", "cli", "api", "library", "data-ml"];
const APP_TYPES = new Set(["web-app", "api", "cli", "mobile", "game"]);

function analyzeDir(root, files = walk(root)) {
  const has = (rel) => files.includes(rel);
  const scores = Object.fromEntries(PROJECT_TYPES.map((t) => [t, 0]));
  const signals = [];
  const frameworks = [];

  const add = (type, weight, why, framework) => {
    scores[type] += weight;
    signals.push(`${type} +${weight}: ${why}`);
    if (framework) frameworks.push({ type, weight, framework });
  };

  const pkg = readJson(root, "package.json");
  if (pkg) {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
    for (const [name, [type, weight, framework]] of Object.entries(JS_DEPS)) {
      if (deps[name]) add(type, weight, `package.json depends on ${name}`, framework);
    }
    if (pkg.bin) add("cli", 3, "package.json declares bin");
  }

  for (const name of pythonDeps(root)) {
    const [type, weight, framework] = PY_DEPS[name];
    add(type, weight, `Python dependency ${name}`, framework);
  }
  const pyproject = readText(root, "pyproject.toml");
  if (pyproject && /\[project\.scripts\]/.test(pyproject)) add("cli", 3, "pyproject declares scripts");

  for (const [manifest, pattern, type, weight, framework] of OTHER_MANIFEST_DEPS) {
    const text = readText(root, manifest);
    if (text && pattern.test(text)) add(type, weight, `${manifest} matches ${framework}`, framework);
  }

  if (has("project.godot")) add("game", 6, "Godot project file", "godot");
  if (has("ProjectSettings/ProjectVersion.txt")) add("game", 6, "Unity project", "unity");
  if (files.some((f) => /\.xcodeproj\//.test(f)) || (has("ios/Podfile") && files.some((f) => f.startsWith("android/")))) {
    add("mobile", 4, "native iOS/Android project");
  }

  const notebooks = files.filter((f) => f.endsWith(".ipynb"));
  if (notebooks.length > 0) add("data-ml", 3, `${notebooks.length} notebook(s)`);

  if (files.some((f) => /(^|\/)(openapi|swagger)\.(ya?ml|json)$/.test(f))) add("api", 2, "OpenAPI spec");

  const hasFramework = (types) => frameworks.some((f) => types.includes(f.type));
  if (hasFramework(["api"])) {
    if (files.some((f) => /^(src\/)?(routes?|controllers|handlers)\//.test(f))) add("api", 1, "route/controller directories");
    if (files.some((f) => /^(src\/)?(server|app)\.(js|mjs|ts)$/.test(f))) add("api", 1, "server entry file");
  }

  const routeFiles = files.filter((f) => /^(src\/)?(app|pages|routes)\/.+\.(tsx?|jsx?|vue|svelte|astro|mdx?)$/.test(f));
  if (hasFramework(["web-app", "landing-page"]) && routeFiles.length > 0) {
    add("web-app", 1, `${routeFiles.length} route file(s)`);
  }

  const libraryEntry = pkg && (pkg.exports || pkg.main || pkg.module) && !pkg.bin && !pkg.private;
  const rustLibrary = has("Cargo.toml") && has("src/lib.rs") && !has("src/main.rs");
  if ((libraryEntry || rustLibrary) && !frameworks.some((f) => APP_TYPES.has(f.type))) {
    add("library", 3, libraryEntry ? "package.json exports a module" : "Rust library crate");
  }

  if (has("index.html") && !hasFramework(["web-app", "game", "mobile"])) {
    add("landing-page", 3, "static index.html at project root");
  }

  return { files, pkg, scores, signals, frameworks };
}

function rank(scores) {
  return PROJECT_TYPES.filter((t) => t !== "unknown")
    .map((type) => [type, scores[type]])
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1]);
}

function pickFramework(frameworks, type) {
  return frameworks.filter((f) => f.type === type).sort((a, b) => b.weight - a.weight)[0]?.framework ?? null;
}

function findSubprojects(files) {
  const dirs = new Set();
  for (const file of files) {
    const parts = file.split("/");
    if (parts.length < 2 || parts.length > 3) continue;
    if (MANIFESTS.includes(parts[parts.length - 1])) dirs.add(parts.slice(0, -1).join("/"));
  }
  return [...dirs].sort();
}

export function detectProject(root) {
  const allFiles = walk(root);
  const subprojectDirs = findSubprojects(allFiles);
  // Files inside a subproject are scored by that subproject only, never twice.
  const rootFiles = allFiles.filter((f) => !subprojectDirs.some((dir) => f.startsWith(`${dir}/`)));
  const rootAnalysis = analyzeDir(root, rootFiles);
  const scores = { ...rootAnalysis.scores };
  const signals = [...rootAnalysis.signals];
  const frameworks = [...rootAnalysis.frameworks];

  const subprojects = [];
  const subInspect = [];
  for (const rel of subprojectDirs) {
    const sub = analyzeDir(path.join(root, rel));
    const [subType, subScore] = rank(sub.scores)[0] ?? ["unknown", 0];
    const type = subScore >= 2 ? subType : "unknown";
    subprojects.push({ path: rel, type, framework: pickFramework(sub.frameworks, type) });
    for (const t of PROJECT_TYPES) scores[t] += sub.scores[t];
    signals.push(...sub.signals.map((signal) => `${rel}: ${signal}`));
    frameworks.push(...sub.frameworks);
    subInspect.push({ type, paths: inspectList(type, sub.files, sub.pkg).map((p) => `${rel}/${p}`) });
  }

  const ranked = rank(scores);
  const [topType, topScore] = ranked[0] ?? ["unknown", 0];
  let type = topScore >= 2 ? topType : "unknown";
  if (subprojects.length > 1) {
    type = STORY_PRIORITY.find((t) => subprojects.some((s) => s.type === t)) ?? type;
  }

  const typeScore = scores[type] ?? 0;
  const strongestOther = ranked.find(([t]) => t !== type)?.[1] ?? 0;
  let confidence = "low";
  if (type !== "unknown") confidence = typeScore >= 4 && typeScore >= strongestOther * 2 ? "high" : "medium";

  const ownInspect = inspectList(type, rootAnalysis.files, rootAnalysis.pkg);
  const orderedSubInspect = [
    ...subInspect.filter((s) => s.type === type),
    ...subInspect.filter((s) => s.type !== type),
  ].flatMap((s) => s.paths);

  return {
    type,
    confidence,
    framework: pickFramework(frameworks, type),
    signals,
    alsoLooksLike: ranked.filter(([t, s]) => t !== type && s >= 2).map(([t]) => t),
    subprojects,
    inspect: [...new Set([...ownInspect, ...orderedSubInspect])].slice(0, 40),
  };
}

// Screens a user actually sees come first; API handlers, admin, and plumbing last.
function routesByStoryValue(files) {
  const routes = files.filter((f) => /^(src\/)?(app|pages|routes)\/.+\.(tsx?|jsx?|vue|svelte|astro)$/.test(f));
  const score = (f) => {
    if (/\/api\/|\/_|importMap|middleware|\.d\.ts$/.test(f)) return 3;
    if (/admin|\(payload\)/i.test(f)) return 2;
    if (/(^|\/)(page|index|\+page)\.[a-z]+$/.test(f)) return 0;
    return 1;
  };
  return routes
    .map((f) => [score(f), f.split("/").length, f])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2]))
    .slice(0, 12)
    .map(([, , f]) => f);
}

const COMMON = /^(readme(\.md)?|package\.json|pyproject\.toml|Cargo\.toml|go\.mod|PRODUCT\.md)$/i;

function inspectList(type, files, pkg) {
  const has = (rel) => files.includes(rel);
  const pick = (pattern, limit = 12) => files.filter((f) => pattern.test(f)).slice(0, limit);
  const list = [];

  switch (type) {
    case "landing-page":
      list.push(...["index.html", "styles.css", "style.css"].filter(has), ...pick(/^[^/]+\.html$/, 6), ...pick(/^src\/pages\//));
      break;
    case "web-app":
      list.push(...routesByStoryValue(files), ...pick(/^(src\/)?components\//, 8));
      list.push(...pick(/(^|\/)(globals?|tailwind\.config|theme)\.(css|js|ts|mjs|cjs)$/, 4));
      break;
    case "cli": {
      const bins = pkg?.bin ? (typeof pkg.bin === "string" ? [pkg.bin] : Object.values(pkg.bin)) : [];
      list.push(...bins.map((b) => b.replace(/^\.\//, "")).filter(has), ...pick(/^(src\/main\.rs|main\.go|cmd\/.+\.go|src\/cli\.[jt]s|cli\.py|__main__\.py)$/));
      list.push(...pick(/^(examples?|docs)\/.+\.(md|txt|sh)$/, 6));
      break;
    }
    case "library":
      list.push(...pick(/^(src\/)?(index|lib|mod)\.(ts|js|mjs|rs|py)$/), ...pick(/^(examples?)\//, 8));
      break;
    case "api":
      list.push(...pick(/(^|\/)(openapi|swagger)\.(ya?ml|json)$/), ...pick(/^(src\/)?(main|app|server|index)\.(py|ts|js|mjs|go)$/), ...pick(/^(src\/)?(routes?|api|controllers|handlers)\//));
      break;
    case "mobile":
      list.push(...pick(/^(app|src\/screens|screens|lib)\/.+\.(tsx?|jsx?|dart)$/), ...["app.json", "pubspec.yaml"].filter(has));
      break;
    case "game":
      list.push(...["index.html", "project.godot"].filter(has), ...pick(/^(src\/)?(scenes?|levels?)\//), ...pick(/^(assets|public)\/.+\.(png|jpg|gif|webp)$/, 8));
      break;
    case "data-ml":
      list.push(...pick(/\.ipynb$/, 6), ...pick(/^(results?|reports?|figures?)\//, 8), ...pick(/\.(csv|json)$/, 4));
      break;
    default:
      break;
  }
  list.push(...files.filter((f) => COMMON.test(f)));
  return [...new Set(list)];
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const target = path.resolve(process.argv[2] ?? process.cwd());
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    console.error(`Not a directory: ${target}`);
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(detectProject(target), null, 2));
  }
}
