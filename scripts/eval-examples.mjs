#!/usr/bin/env node
/**
 * Static eval over examples/: each demo project must have its source files,
 * be detected as a landing page, and ship a brag.mp4 that passes
 * verify_render.mjs (poster checked against examples/<slug>/brag.jpg, or
 * docs/examples/<slug>/brag.jpg for gallery examples).
 *
 *   node scripts/eval-examples.mjs [--update-baseline]
 *
 * Known issues live in tests/eval-baseline.json. CI fails only on issues that
 * are not in the baseline, and reports baseline entries that have been fixed so
 * the baseline only ever shrinks. Writes a markdown summary to stdout and to
 * $GITHUB_STEP_SUMMARY when set.
 */

import { appendFileSync, existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { detectProject } from "../skills/brag/scripts/detect_project.mjs";
import { verifyRender } from "../skills/brag/scripts/verify_render.mjs";

const REQUIRED_FILES = ["index.html", "styles.css", "PRODUCT.md"];

export function evalExample(root, slug) {
  const dir = path.join(root, "examples", slug);
  const issues = [];

  for (const file of REQUIRED_FILES) {
    if (!existsSync(path.join(dir, file))) issues.push(`structure:missing-${file}`);
  }

  const detection = detectProject(dir);
  if (detection.type !== "landing-page") issues.push(`detect:${detection.type}`);

  let render = null;
  const video = path.join(dir, "brag.mp4");
  if (!existsSync(video)) {
    issues.push("render:missing-brag.mp4");
  } else {
    const poster = [path.join(dir, "brag.jpg"), path.join(root, "docs", "examples", slug, "brag.jpg")].find((p) => existsSync(p));
    const report = verifyRender(video, { format: "landscape", posterPath: poster });
    issues.push(...report.errorCodes.map((code) => `render:${code}`), ...report.warningCodes.map((code) => `render:${code}`));
    render = { duration: report.facts.duration, lufs: report.facts.integratedLufs, errors: report.errors, warnings: report.warnings };
  }

  return { slug, type: detection.type, render, issues };
}

export function compareToBaseline(results, baseline) {
  const newIssues = [];
  const fixed = [];
  const nextBaseline = {};
  const slugs = new Set(results.map((r) => r.slug));

  for (const { slug, issues } of results) {
    const known = new Set(baseline[slug] ?? []);
    for (const issue of issues) if (!known.has(issue)) newIssues.push(`${slug}: ${issue}`);
    for (const issue of known) if (!issues.includes(issue)) fixed.push(`${slug}: ${issue}`);
    if (issues.length > 0) nextBaseline[slug] = [...issues];
  }
  for (const [slug, issues] of Object.entries(baseline)) {
    if (!slugs.has(slug)) fixed.push(...issues.map((issue) => `${slug}: ${issue}`));
  }
  return { newIssues, fixed, nextBaseline };
}

export function renderSummary(results, { newIssues, fixed }) {
  const rows = results.map(({ slug, type, render, issues }) => {
    const duration = render ? `${render.duration.toFixed(1)}s` : "—";
    const lufs = render?.lufs != null ? `${render.lufs} LUFS` : "—";
    return `| ${slug} | ${type} | ${duration} | ${lufs} | ${issues.join(", ") || "✓"} |`;
  });
  const lines = [
    "## /brag examples eval",
    "",
    "| Example | Detected | Duration | Loudness | Issues |",
    "|---|---|---|---|---|",
    ...rows,
    "",
    newIssues.length === 0 ? "✓ No new issues." : `✗ ${newIssues.length} new issue(s):\n${newIssues.map((i) => `- ${i}`).join("\n")}`,
  ];
  if (fixed.length > 0) {
    lines.push("", `Fixed since the baseline — run \`node scripts/eval-examples.mjs --update-baseline\`:`, ...fixed.map((i) => `- ${i}`));
  }
  return `${lines.join("\n")}\n`;
}

function main(argv) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const baselinePath = path.join(root, "tests", "eval-baseline.json");
  const slugs = readdirSync(path.join(root, "examples"))
    .filter((name) => statSync(path.join(root, "examples", name)).isDirectory())
    .sort();

  const results = slugs.map((slug) => evalExample(root, slug));
  const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : {};
  const comparison = compareToBaseline(results, baseline);

  if (argv.includes("--update-baseline")) {
    writeFileSync(baselinePath, `${JSON.stringify(comparison.nextBaseline, null, 2)}\n`);
    console.log(`Wrote ${path.relative(root, baselinePath)}.`);
    return;
  }

  const summary = renderSummary(results, comparison);
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  process.exitCode = comparison.newIssues.length > 0 ? 1 : 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2));
}
