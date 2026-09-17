import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { COMMANDS, readmeHighlights, scenesFromPlan, shareCopyFor, installWorkflow } from "../skills/brag/scripts/brag_cli.mjs";
import { planCardVideo } from "../skills/brag/scripts/template_video.mjs";

const CLI = fileURLToPath(new URL("../skills/brag/scripts/brag_cli.mjs", import.meta.url));
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });

test("readmeHighlights prefers a features section, strips markdown, and skips install steps", () => {
  const readme = [
    "# tinyapp",
    "",
    "- [docs](https://x.dev)",
    "",
    "## Install",
    "- `npm i tinyapp`",
    "",
    "## Features",
    "",
    "- **Fast**: renders in under a second",
    "- Works [offline](https://x.dev/offline), no account needed",
    "* Exports to TikTok, Reels, Shorts, X, LinkedIn, YouTube, Discord, and more places",
    "",
    "## License",
    "- MIT",
  ].join("\n");
  assert.deepEqual(readmeHighlights(readme), ["Fast: renders in under a second", "Works offline, no account needed", "Exports to TikTok, Reels, Shorts, X, LinkedIn, YouTube, Discord…"]);
  assert.deepEqual(readmeHighlights("# x\n\nplain text only\n"), []);
  const deploy = "# app\n\n## Deploying to Vercel\n\n1. Set variables:\n   - `DATABASE_URL` — the Neon connection string\n   - `SITE_URL` = `https://x.dev`\n\n## Architecture\n\n- **Next.js 16 App Router**, Tailwind v4\n- **SQLite** for local data\n";
  assert.deepEqual(readmeHighlights(deploy), [], "deploy steps, env vars, and architecture notes are not features");
  assert.deepEqual(readmeHighlights("# x\n\n- one thing\n- two things\n"), ["one thing", "two things"], "the first real list is the fallback");
});

test("scenesFromPlan writes scenes.json roles and settled times the cut tools accept", () => {
  const plan = planCardVideo({ title: "x", stats: [{ value: "3", label: "days" }], highlights: { items: ["a b c"] }, outro: { line: "go" } }, { format: "landscape" });
  const scenes = scenesFromPlan(plan);
  assert.deepEqual(scenes.map((s) => s.role), ["hook", "reveal", "highlight", "payoff"]);
  for (const scene of scenes) assert.ok(scene.settled > scene.start && scene.settled < scene.end);
  assert.equal(scenes.at(-1).end, plan.duration);
});

test("shareCopyFor is one or two honest lines with the link", () => {
  assert.equal(shareCopyFor({ name: "tinyapp", description: "a tiny app that does one thing" }, "https://tiny.app"), "tinyapp: a tiny app that does one thing.\nhttps://tiny.app");
  assert.equal(shareCopyFor({ name: "tinyapp" }, null), "tinyapp.");
});

test("the CLI prints help and version, maps script commands, and rejects unknown ones", () => {
  const help = cli("--help");
  assert.equal(help.status, 0);
  for (const name of ["make", "release", "preview", "kit", "embed", "github", "doctor", "verify"]) assert.match(help.stdout, new RegExp(`\\n  ${name}\\b`));
  assert.match(cli("--version").stdout, /^\d+\.\d+\.\d+\n$/);
  for (const [name, entry] of Object.entries(COMMANDS)) if (entry.script) assert.ok(existsSync(path.join(path.dirname(CLI), entry.script)), name);
  const unknown = cli("dance");
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /Unknown command "dance"/);
  const passthrough = cli("verify");
  assert.equal(passthrough.status, 2, "script usage errors pass through");
  assert.match(passthrough.stderr, /Usage: verify_render\.mjs/);
});

test("installWorkflow copies a workflow template into .github/workflows and refuses to overwrite", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "brag-gh-"));
  try {
    const file = installWorkflow(dir, "release");
    assert.equal(path.relative(dir, file), path.join(".github", "workflows", "brag-release-video.yml"));
    assert.match(readFileSync(file, "utf8"), /uses: irvinosazee\/brag@main/);
    assert.throws(() => installWorkflow(dir, "release"), /already exists/);
    assert.ok(existsSync(installWorkflow(dir, "pr-preview")));
    assert.throws(() => installWorkflow(dir, "nope"), /release, pr-preview/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
