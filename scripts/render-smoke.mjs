#!/usr/bin/env node
/**
 * Rendered end-to-end smoke test: render a small committed composition with the current
 * Hyperframes, then hold the output to the same gates /brag uses on real videos.
 *
 *   node scripts/render-smoke.mjs [--out render-smoke-output] [--update-golden]
 *
 * Copies tests/fixtures/render-smoke to --out, generates its audio, renders with
 * `npx -y hyperframes render`, then runs verify_render.mjs, text_audit.mjs, and golden-frame
 * comparison against tests/golden/render-smoke. Goldens use a lower SSIM floor than the examples
 * because fonts and antialiasing differ between machines; they catch blank, black, or mistimed
 * renders, not subpixel changes. Writes a markdown summary to $GITHUB_STEP_SUMMARY when set.
 */

import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifyRender } from "../skills/brag/scripts/verify_render.mjs";
import { auditComposition } from "../skills/brag/scripts/text_audit.mjs";
import { captureGolden, compareGolden } from "../skills/brag/scripts/golden.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SMOKE_MIN_SSIM = 0.85;

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
  return { ok: result.status === 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

async function main(argv) {
  const out = path.resolve(argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : path.join(root, "render-smoke-output"));
  const composition = path.join(out, "composition");
  const video = path.join(out, "smoke.mp4");
  const goldenDir = path.join(root, "tests", "golden", "render-smoke");
  const checks = [];
  const record = (name, ok, detail) => checks.push({ name, ok, detail });

  rmSync(out, { recursive: true, force: true });
  mkdirSync(path.join(composition, "assets"), { recursive: true });
  cpSync(path.join(root, "tests", "fixtures", "render-smoke"), composition, { recursive: true });
  const tone = run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-ar", "48000", path.join(composition, "assets", "tone.wav")]);
  record("generate audio", tone.ok, tone.ok ? "tone.wav" : tone.output.slice(-400));

  const version = run("npx", ["-y", "hyperframes", "--version"], { cwd: composition });
  record("hyperframes available", version.ok, version.output.trim().split("\n").filter((line) => !/^npm (warn|notice)/i.test(line)).at(-1) ?? "");

  const render = run("npx", ["-y", "hyperframes", "render", "--quality", "draft", "--output", video], { cwd: composition, timeout: 15 * 60 * 1000 });
  const rendered = render.ok && existsSync(video);
  record("render", rendered, rendered ? "smoke.mp4" : render.output.slice(-800));

  if (rendered) {
    const report = verifyRender(video, { width: 1920, height: 1080, minDuration: 2.5, maxDuration: 3.5 });
    record("verify_render", report.ok, report.ok ? `${report.facts.duration.toFixed(2)}s, audio ${report.facts.hasAudio}` : report.errors.join("; "));

    const audit = await auditComposition(composition).catch((error) => ({ errors: [{ message: error.message }] }));
    record("text_audit", audit.errors.length === 0, audit.errors.length ? audit.errors.map((e) => e.message).join("; ") : `${audit.checked} text elements`);

    if (argv.includes("--update-golden")) {
      captureGolden(video, { outDir: goldenDir, frames: 4 });
      const manifest = JSON.parse(readFileSync(path.join(goldenDir, "golden.json"), "utf8"));
      manifest.minSsim = SMOKE_MIN_SSIM;
      writeFileSync(path.join(goldenDir, "golden.json"), `${JSON.stringify(manifest, null, 2)}\n`);
      record("golden frames", true, "captured");
    } else {
      const golden = compareGolden(video, { goldenDir, diffDir: path.join(out, "golden-diffs") });
      record("golden frames", golden.ok, golden.ok ? golden.frames.map((f) => f.ssim).join(", ") : golden.failures.map((f) => `${f.file ?? ""} ${f.reason}`).join("; "));
    }
  }

  const summary = ["## /brag render smoke test", "", "| Check | Result | Detail |", "|---|---|---|", ...checks.map((c) => `| ${c.name} | ${c.ok ? "✓" : "✗"} | ${String(c.detail).replace(/\|/g, "\\|").replace(/\n/g, " ")} |`), ""].join("\n");
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  process.exitCode = checks.every((c) => c.ok) ? 0 : 1;
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
