#!/usr/bin/env node
/**
 * The product dossier: everything /shipreel knows about a project, read once, in one JSON file.
 * Videos, cards, and launch copy are all rendered from it, so they agree with each other.
 *
 *   node <skill-root>/scripts/dossier.mjs <project-dir> [--out <output-dir>] [--write]
 *
 * It gathers the project's name, description, install line and URLs (release_video.mjs), its type
 * (detect_project.mjs), README highlights, the brand kit or the palette and fonts its own CSS and
 * font imports declare, the git build story, the claims ledger (each claim re-verified against its
 * source), and the media a run produced: posters, review frames, captures, and renders.
 *
 * With --out, media and claims come from that output directory; --write saves <out>/dossier.json.
 * Paths are relative to the project. Nothing in it depends on the clock, so the same project gives
 * the same dossier.
 */

import { existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadBrand } from "./brand.mjs";
import { verifyClaims } from "./claims.mjs";
import { readmeHighlights } from "./cli.mjs";
import { detectProject } from "./detect_project.mjs";
import { gitStory, storyLine } from "./git_story.mjs";
import { projectInfo } from "./release_video.mjs";

export const DOSSIER_VERSION = 1;
// Build output, dependencies, and other people's sites (examples, fixtures, tests) say nothing about this project's brand.
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", ".svelte-kit", ".turbo", "coverage", "vendor", "target", "examples", "fixtures", "__fixtures__", "test", "tests", "__tests__", "e2e", "storybook-static"]);
const MAX_CSS_FILES = 40;
const DEFAULT_PALETTE = { bg: "#0f0d15", fg: "#f5f1ea", muted: "#b9b2a8", accent: "#ff6b3d" };

// ---------------------------------------------------------------- colours

const hex2 = (n) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");
const rgbHex = (r, g, b) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

function oklchHex(L, C, H) {
  const h = (H * Math.PI) / 180, a = C * Math.cos(h), b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  const gamma = (x) => 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.max(0, x) ** (1 / 2.4) - 0.055);
  return rgbHex(...lin.map(gamma));
}

function hslHex(H, S, L) {
  const s = S / 100, l = L / 100, k = (n) => (n + H / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)));
  return rgbHex(f(0), f(8), f(4));
}

const num = (token, scale = 1) => (token.endsWith("%") ? (parseFloat(token) / 100) * scale : parseFloat(token));

/** A CSS colour value as #rrggbb, or null. Accepts hex, rgb(), hsl(), oklch(), and shadcn's bare "H S% L%" triples. */
export function toHex(value) {
  const v = String(value ?? "").trim().toLowerCase();
  let m = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})(?:[0-9a-f]{2})?$/);
  if (m) return `#${m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1]}`;
  m = v.match(/^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)/);
  if (m) return rgbHex(num(m[1], 255), num(m[2], 255), num(m[3], 255));
  m = v.match(/^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/) ?? v.match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  if (m) return hslHex(+m[1], +m[2], +m[3]);
  m = v.match(/^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)/);
  if (m) return oklchHex(num(m[1]), +m[2], +m[3]);
  return null;
}

// ---------------------------------------------------------------- reading the project

function walk(root, keep, max = 400) {
  const out = [];
  const visit = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= max) return;
      if (entry.name.startsWith(".") && entry.name !== ".shipreel") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith("shipreel-output") && !entry.name.startsWith("brag-output")) visit(full);
      } else if (keep(entry.name)) out.push(full);
    }
  };
  visit(root);
  return out;
}

// Global stylesheets first: they hold the design tokens.
const CSS_RANK = (file) => (/(^|\/)(globals?|styles?|app|index|main|tailwind|theme|tokens?)\.css$/i.test(file) ? 0 : 1);

// Token names per role, most specific first. shadcn's --accent is a subtle surface, not a brand colour,
// so accent candidates must also be saturated.
const ROLES = {
  bg: ["background", "color-background", "bg", "surface", "page", "base-100"],
  fg: ["foreground", "color-foreground", "fg", "text", "ink", "base-content"],
  accent: ["brand", "color-brand", "primary", "color-primary", "accent", "color-accent"],
  muted: ["muted-foreground", "color-muted-foreground", "text-muted", "fg-muted"],
};

/**
 * Every custom property's first declaration, so `var(--x)` can be resolved. With `dark`, tokens
 * inside `.dark { }` blocks override them, for apps that ship dark by default.
 */
function customProperties(sources, { dark = false } = {}) {
  const vars = new Map();
  for (const css of sources) for (const [, name, value] of css.matchAll(/--([a-z0-9-]+)\s*:\s*([^;}]+)[;}]/gi)) if (!vars.has(name)) vars.set(name, value.trim());
  if (dark) {
    for (const css of sources) {
      for (const [, block] of css.matchAll(/\.dark\s*\{([^{}]*)\}/g)) for (const [, name, value] of block.matchAll(/--([a-z0-9-]+)\s*:\s*([^;}]+)/gi)) vars.set(name, value.trim());
    }
  }
  return vars;
}

function resolveVars(value, vars, depth = 0) {
  if (depth > 6) return value;
  return value.replace(/var\(\s*--([a-z0-9-]+)\s*(?:,\s*([^()]*))?\)/gi, (_, name, fallback) => resolveVars(vars.get(name) ?? fallback ?? "", vars, depth + 1));
}

/**
 * The palette a project's own CSS declares. The page's own background and text colour (body, html,
 * :root rules) win, then design-token names (shadcn, daisyUI, plain --bg/--fg), then the most-used
 * colours; the accent is the most-used saturated colour that is neither.
 */
export function paletteFromCss(sources, { dark = false } = {}) {
  const vars = customProperties(sources, { dark });
  const found = {};
  for (const [role, names] of Object.entries(ROLES)) {
    for (const name of names) {
      const hex = vars.has(name) ? toHex(resolveVars(vars.get(name), vars)) : null;
      if (hex && (role !== "accent" || saturation(hex) > 0.3)) {
        found[role] = hex;
        break;
      }
    }
  }
  const page = {};
  const counts = new Map();
  for (const css of sources) {
    for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const isPage = /(^|[\s,])(html|body|:root)\s*$/i.test(selector.trim()) || /^(html|body)(\s*,\s*(html|body))*$/i.test(selector.trim());
      for (const [, prop, raw] of body.matchAll(/(background(?:-color)?|color)\s*:\s*([^;]+)/gi)) {
        const hex = toHex(resolveVars(raw, vars).trim().split(/\s+(?![^(]*\))/)[0]);
        if (!hex) continue;
        const kind = prop.toLowerCase().startsWith("background") ? "bg" : "fg";
        if (isPage) page[kind] ??= hex;
        counts.set(`${kind}:${hex}`, (counts.get(`${kind}:${hex}`) ?? 0) + 1);
      }
    }
  }
  const top = (kind) => [...counts].filter(([k]) => k.startsWith(`${kind}:`)).sort((a, b) => b[1] - a[1]).map(([k]) => k.slice(kind.length + 1));
  found.bg = page.bg ?? found.bg ?? top("bg")[0];
  found.fg = (dark ? found.fg ?? page.fg : page.fg ?? found.fg) ?? top("fg").find((c) => c !== found.bg);
  if (dark) found.bg = vars.has("background") ? toHex(resolveVars(vars.get("background"), vars)) ?? found.bg : found.bg;
  if (found.bg && found.fg && !found.muted) found.muted = mix(found.fg, found.bg, 0.38);
  if (!found.accent) {
    const used = [...counts].sort((a, b) => b[1] - a[1]).map(([k]) => k.split(":")[1]);
    const declared = [...vars.values()].map((v) => toHex(resolveVars(v, vars))).filter(Boolean);
    found.accent = [...used, ...declared].find((c) => c !== found.bg && c !== found.fg && saturation(c) > 0.3);
  }
  return Object.fromEntries(Object.entries(found).filter(([, v]) => v));
}

function mix(a, b, t) {
  const ch = (hex, i) => parseInt(hex.slice(i, i + 2), 16);
  return rgbHex(...[1, 3, 5].map((i) => ch(a, i) + (ch(b, i) - ch(a, i)) * t));
}

// Chroma, not HSV saturation: a near-black navy is "saturated" but reads as no colour at all.
function saturation(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return Math.max(r, g, b) - Math.min(r, g, b);
}

const GENERIC_FONTS = /^(inherit|initial|unset|sans-serif|serif|monospace|system-ui|ui-sans-serif|ui-serif|ui-monospace|-apple-system|blinkmacsystemfont|cursive|var\(.*)$/i;

/** Font families in the order the project declares them: next/font imports, Google Fonts links, then CSS font-family. */
export function fontsFromSources({ css = [], code = [] }) {
  const names = [];
  const add = (name) => {
    const clean = name.replace(/["']/g, "").replace(/_/g, " ").trim();
    if (clean && !GENERIC_FONTS.test(clean) && !names.includes(clean)) names.push(clean);
  };
  for (const src of code) {
    for (const [, list] of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']next\/font\/google["']/g)) list.split(",").map((s) => s.split(/\s+as\s+/)[0]).forEach(add);
    for (const [, query] of src.matchAll(/fonts\.googleapis\.com\/css2?\?([^"'\s>]+)/g)) for (const [, fam] of query.matchAll(/family=([^:&]+)/g)) add(decodeURIComponent(fam).replace(/\+/g, " "));
  }
  for (const src of css) {
    for (const [, query] of src.matchAll(/fonts\.googleapis\.com\/css2?\?([^"')\s]+)/g)) for (const [, fam] of query.matchAll(/family=([^:&]+)/g)) add(decodeURIComponent(fam).replace(/\+/g, " "));
    for (const [, list] of src.matchAll(/font-family\s*:\s*([^;}]+)/gi)) add(list.split(",")[0]);
  }
  const mono = names.find((n) => /mono|code|courier/i.test(n)) ?? null;
  const text = names.filter((n) => n !== mono);
  return { display: text[0] ?? null, body: text[1] ?? text[0] ?? null, mono, all: names };
}

function brandFor(dir) {
  const kit = loadBrand(dir);
  const problems = kit?.problems ?? [];
  const read = (files) => files.map((f) => readFileSync(f, "utf8"));
  const cssFiles = walk(dir, (n) => n.endsWith(".css")).sort((a, b) => CSS_RANK(a) - CSS_RANK(b) || a.localeCompare(b)).slice(0, MAX_CSS_FILES);
  // Font and layout files declare the fonts a whole app uses; read them before components.
  const FONT_RANK = (f) => (/(^|\/)(fonts?|layout|_app|_document|root|index)\.[a-z]+$/i.test(f) ? 0 : 1);
  const codeFiles = walk(dir, (n) => /\.(html|tsx|jsx|ts|js|mjs|astro|vue|svelte)$/.test(n) && !/\.(test|spec|config|d)\.[jt]sx?$/.test(n), 400).sort((a, b) => FONT_RANK(a) - FONT_RANK(b) || a.localeCompare(b));
  const css = read(cssFiles), code = read(codeFiles);
  // Apps that render dark by default (next-themes defaultTheme/forcedTheme, or a hard-coded "dark" class on <html>).
  const dark = code.some((src) => /(defaultTheme|forcedTheme)\s*=\s*["']dark["']|<html[^>]*className=["'][^"']*\bdark\b/.test(src));
  const cssPalette = paletteFromCss(css, { dark });
  const fonts = fontsFromSources({ css, code });

  let source = Object.keys(cssPalette).length ? "css" : "default";
  let palette = { ...DEFAULT_PALETTE, ...cssPalette };
  if (cssPalette.bg && cssPalette.fg && !cssPalette.muted) palette.muted = mix(cssPalette.fg, cssPalette.bg, 0.38);
  if (kit?.brand?.palette) {
    palette = { ...palette, ...Object.fromEntries(Object.entries(kit.brand.palette).map(([k, v]) => [k, toHex(v) ?? v])) };
    source = "brand-kit";
  }
  return {
    source,
    theme: dark ? "dark" : "light",
    palette,
    fonts: { display: kit?.brand?.fonts?.display ?? fonts.display, body: kit?.brand?.fonts?.body ?? fonts.body, mono: fonts.mono, files: kit?.brand?.fonts?.files ?? {} },
    name: kit?.brand?.name ?? null,
    logo: kit?.brand?.logo ?? null,
    handle: kit?.brand?.handle ?? null,
    url: kit?.brand?.url ?? null,
    bannedWords: kit?.brand?.bannedWords ?? [],
    problems,
  };
}

function mediaIn(dir, outDir) {
  const rel = (f) => path.relative(dir, f);
  const media = { posters: [], stills: [], frames: [], captures: [], videos: [] };
  if (!outDir || !existsSync(outDir)) return media;
  for (const name of readdirSync(outDir).sort()) {
    const full = path.join(outDir, name);
    if (/^shipreel(-[a-z-]+)?\.jpg$/.test(name)) media.posters.push(rel(full));
    if (/^shipreel(-[a-z-]+)?\.mp4$/.test(name) && !name.includes(".draft")) media.videos.push(rel(full));
  }
  const images = (sub) => (existsSync(path.join(outDir, sub)) && statSync(path.join(outDir, sub)).isDirectory() ? walk(path.join(outDir, sub), (n) => /\.(png|jpe?g|webp)$/i.test(n)) : []);
  media.frames = images("review").filter((f) => /frame-\d+\.jpg$/.test(f)).map(rel);
  media.captures = images("capture").map(rel);
  media.stills = images("stills").filter((f) => /scene-\d+\.jpg$/.test(f)).map(rel);
  return media;
}

function claimsIn(dir, outDir) {
  const file = outDir && path.join(outDir, "claims.json");
  if (!file || !existsSync(file)) return [];
  const claims = JSON.parse(readFileSync(file, "utf8"));
  return claims.map((c) => {
    const { problems } = verifyClaims([c], { projectDir: dir });
    return { ...c, verified: problems.length === 0, ...(problems.length ? { problem: problems[0] } : {}) };
  });
}

const INSTALL = /^(npx|npm (?:i|install)|pnpm (?:add|dlx)|yarn (?:add|dlx)|bunx|bun add|pip install|pipx install|uv tool install|brew install|cargo (?:install|add)|go install|gem install|composer require)\s+\S/;

/** The first install command in a README's code blocks, for projects whose package is private or absent. */
export function installFromReadme(markdown) {
  for (const [, block] of String(markdown ?? "").matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
    for (const raw of block.split("\n")) {
      const line = raw.replace(/^\$\s*/, "").replace(/\s+#.*$/, "").trim();
      if (INSTALL.test(line)) return line;
    }
  }
  return null;
}

/** A product name fit for a card: no emoji, and no " — tagline" a README heading tacks on. */
export function displayName(name) {
  const clean = String(name ?? "").replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "").replace(/\s+/g, " ").trim();
  return clean.split(/\s+[—–|:]\s+|\s+-\s+/)[0].trim() || clean;
}

/** Build the dossier for a project; `outDir` is the shipreel output directory to read media and claims from. */
export function buildDossier(projectDir, { outDir } = {}) {
  const dir = path.resolve(projectDir);
  const out = outDir ? path.resolve(dir, outDir) : null;
  const info = projectInfo(dir);
  const detected = detectProject(dir);
  const readme = ["README.md", "readme.md", "Readme.md"].map((f) => path.join(dir, f)).find(existsSync);

  let story = null;
  try {
    const s = gitStory(dir);
    story = { commits: s.commits, contributors: s.contributors, days: s.days, firstDate: s.firstDate, lastDate: s.lastDate, line: storyLine(s) };
  } catch {
    // Not a git repository.
  }

  const brand = brandFor(dir);
  const { problems: brandProblems, name: kitName, ...brandFields } = brand;
  const readmeText = readme ? readFileSync(readme, "utf8") : "";
  const claims = claimsIn(dir, out);
  // README highlights first; without a feature list, the run's own verified claims are the proof points.
  // Whole bullets: each output (a 20s video, a card, a post) decides how much of one fits.
  const highlights = readme ? readmeHighlights(readmeText, 4, { maxWords: 40 }) : [];
  return {
    dossierVersion: DOSSIER_VERSION,
    project: {
      name: kitName ?? displayName(info.name),
      fullName: info.name,
      description: info.description,
      tagline: info.tagline,
      version: info.version,
      url: brand.url ?? info.homepage ?? info.repository ?? null,
      repository: info.repository,
      install: info.install ?? installFromReadme(readmeText),
      type: detected.type,
      framework: detected.framework,
    },
    highlights: highlights.length ? highlights : claims.filter((c) => c.verified).map((c) => c.text).slice(0, 4),
    brand: brandFields,
    story,
    claims,
    media: mediaIn(dir, out),
    problems: brandProblems,
  };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const dir = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1] === "--out")) ?? ".";
  try {
    const out = flag("--out") ?? (args.includes("--write") ? path.join(dir, "shipreel-output") : undefined);
    const dossier = buildDossier(dir, { outDir: out });
    const json = `${JSON.stringify(dossier, null, 2)}\n`;
    if (args.includes("--write")) {
      const file = path.join(path.resolve(dir, out), "dossier.json");
      writeFileSync(file, json);
      console.error(`wrote ${file}`);
    } else process.stdout.write(json);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
