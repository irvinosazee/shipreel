import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildDossier, displayName, fontsFromSources, paletteFromCss, toHex } from "../skills/shipreel/scripts/dossier.mjs";

function project(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "shipreel-dossier-"));
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), body);
  }
  return dir;
}

test("toHex reads every colour syntax projects use", () => {
  assert.equal(toHex("#F43"), "#ff4433");
  assert.equal(toHex("#ff6134cc"), "#ff6134");
  assert.equal(toHex("rgb(255, 97, 52)"), "#ff6134");
  assert.equal(toHex("rgba(0 0 0 / 50%)"), "#000000");
  assert.equal(toHex("hsl(0, 100%, 50%)"), "#ff0000");
  assert.equal(toHex("0 0% 100%"), "#ffffff", "shadcn's bare HSL triple");
  assert.equal(toHex("oklch(1 0 0)"), "#ffffff");
  assert.equal(toHex("oklch(64% 0.22 35)"), "#f4430c");
  assert.equal(toHex("transparent"), null);
  assert.equal(toHex("var(--x)"), null);
});

test("the page's own background and text colour win, through var()", () => {
  const css = `:root { --bg-void: #0a0a0c; --white: #f5f5f0; --amber: #ffb020; }
    body { background: var(--bg-void); color: var(--white); }
    .score { color: var(--amber); } .bar { background: var(--amber); }`;
  const p = paletteFromCss([css]);
  assert.equal(p.bg, "#0a0a0c");
  assert.equal(p.fg, "#f5f5f0");
  assert.equal(p.accent, "#ffb020", "the most-used saturated colour");
});

test("shadcn tokens: a grey --primary is not an accent, .dark only applies to dark apps", () => {
  const css = `:root { --background: oklch(1 0 0); --foreground: oklch(0.145 0 0); --primary: oklch(0.205 0 0);
      --accent: oklch(0.97 0 0); --muted-foreground: oklch(0.556 0 0); }
    .dark { --background: oklch(0.145 0 0); --foreground: oklch(0.985 0 0); }
    .cta { background: #009869; } .badge { color: #009869; }`;
  const light = paletteFromCss([css]);
  assert.equal(light.bg, "#ffffff");
  assert.equal(light.accent, "#009869");
  assert.ok(light.muted, "muted-foreground");
  const dark = paletteFromCss([css], { dark: true });
  assert.equal(dark.bg, "#0a0a0a");
  assert.equal(dark.fg, "#fafafa");
});

test("fonts come from next/font, Google Fonts links, then font-family, mono kept apart", () => {
  const fonts = fontsFromSources({
    code: [`import { Raleway, Poppins, Geist_Mono } from "next/font/google";`],
    css: [`body { font-family: "Hanken Grotesk", system-ui, sans-serif; } h1 { font-family: var(--font-display); }`],
  });
  assert.equal(fonts.display, "Raleway");
  assert.equal(fonts.body, "Poppins");
  assert.equal(fonts.mono, "Geist Mono");
  assert.ok(fonts.all.includes("Hanken Grotesk"));
});

test("displayName drops emoji and the README heading's tagline", () => {
  assert.equal(displayName("🌾 Farm Ease"), "Farm Ease");
  assert.equal(displayName("Brand Bible — AI-Powered Personal Identity Engine 🚀"), "Brand Bible");
  assert.equal(displayName("HeartRank"), "HeartRank");
});

test("buildDossier reads a project once: metadata, brand kit, story, verified claims, media", () => {
  const dir = project({
    "package.json": JSON.stringify({ name: "tidy", description: "Inbox zero, finally.", homepage: "https://tidy.app", bin: { tidy: "cli.js" } }),
    "README.md": "# tidy\n\nInbox zero, finally.\n\n## Features\n\n- Sorts mail by sender for you\n- Snoozes newsletters until Friday\n",
    "app/globals.css": ":root { --background: #ffffff; --foreground: #111111; } body { background: var(--background); }",
    ".shipreel/config.json": JSON.stringify({ name: "tidy", palette: { accent: "#3366ff" }, handle: "@tidy" }),
    "shipreel-output/claims.json": JSON.stringify([
      { text: "Inbox zero", source: "README.md", quote: "Inbox zero, finally." },
      { text: "12 metros", source: "README.md", quote: "Available in 12 metros" },
    ]),
    "shipreel-output/shipreel.jpg": "x",
    "shipreel-output/shipreel.mp4": "x",
    "shipreel-output/shipreel.draft.mp4": "x",
    "shipreel-output/review/frame-01.jpg": "x",
  });
  try {
    const git = (args) => execFileSync("git", args, { cwd: dir, env: { ...process.env, GIT_AUTHOR_NAME: "A", GIT_AUTHOR_EMAIL: "a@x", GIT_COMMITTER_NAME: "A", GIT_COMMITTER_EMAIL: "a@x" } });
    git(["init", "-q", "-b", "main"]);
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "first"]);

    const d = buildDossier(dir, { outDir: "shipreel-output" });
    assert.equal(d.dossierVersion, 1);
    assert.equal(d.project.name, "tidy");
    assert.equal(d.project.url, "https://tidy.app");
    assert.equal(d.project.install, "npx tidy");
    assert.deepEqual(d.highlights, ["Sorts mail by sender for you", "Snoozes newsletters until Friday"]);
    assert.equal(d.brand.source, "brand-kit");
    assert.equal(d.brand.palette.bg, "#ffffff", "CSS fills what the kit leaves out");
    assert.equal(d.brand.palette.accent, "#3366ff", "the kit wins");
    assert.equal(d.brand.handle, "@tidy");
    assert.equal(d.story.commits, 1);
    assert.deepEqual(d.claims.map((c) => c.verified), [true, false]);
    assert.deepEqual(d.media.posters, ["shipreel-output/shipreel.jpg"]);
    assert.deepEqual(d.media.videos, ["shipreel-output/shipreel.mp4"], "drafts are not media");
    assert.deepEqual(d.media.frames, ["shipreel-output/review/frame-01.jpg"]);
    assert.deepEqual(buildDossier(dir, { outDir: "shipreel-output" }), d, "deterministic");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildDossier works without git, an output directory, or any CSS", () => {
  const dir = project({ "README.md": "# Plain\n\nA plain thing.\n" });
  try {
    const d = buildDossier(dir);
    assert.equal(d.project.name, "Plain");
    assert.equal(d.story, null);
    assert.equal(d.brand.source, "default");
    assert.deepEqual(d.claims, []);
    assert.deepEqual(d.media, { posters: [], stills: [], frames: [], captures: [], videos: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("dogfood fixes: kit name, README install line, no palette from examples/, claims stand in for missing highlights", () => {
  const dir = project({
    "package.json": JSON.stringify({ name: "repo", private: true }),
    "README.md": "# /thing\n\nDoes things.\n\n## Install\n\n```bash\n$ npx @me/thing skill install   # one line\n```\n\n## What's in this repo\n\n- `src/` the code\n- `docs/` the site\n",
    "examples/fake-site/styles.css": ":root { --background: #94ddfd; --foreground: #0d2034; }",
    "app.css": "body { background: #130503; color: #ffede9; } .cta { background: #ff6134; } a { color: #ff6134; }",
    ".shipreel/config.json": JSON.stringify({ name: "thing", palette: { bg: "#130503", fg: "#ffede9", accent: "#ff6134" }, fonts: { display: "Geist" } }),
    "out/claims.json": JSON.stringify([{ text: "Does things", source: "README.md", quote: "Does things." }]),
  });
  try {
    const d = buildDossier(dir, { outDir: "out" });
    assert.equal(d.project.name, "thing", "the brand kit names the product");
    assert.equal(d.project.install, "npx @me/thing skill install");
    assert.deepEqual(d.highlights, ["Does things"], "a repo layout list is not a feature list; verified claims stand in");
    const css = buildDossier(dir).brand;
    assert.notEqual(css.palette.bg, "#94ddfd", "examples/ is someone else's site");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("installFromReadme finds the first install command in a code block", async () => {
  const { installFromReadme } = await import("../skills/shipreel/scripts/dossier.mjs");
  assert.equal(installFromReadme("```sh\ngit clone x\npip install tidy\n```"), "pip install tidy");
  assert.equal(installFromReadme("no code here"), null);
});
