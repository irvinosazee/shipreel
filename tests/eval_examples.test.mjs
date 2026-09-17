import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { compareToBaseline, evalExample, renderSummary } from "../scripts/eval-examples.mjs";

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

test("compareToBaseline separates new issues from known and fixed ones", () => {
  const results = [
    { slug: "a", issues: ["render:loudness", "render:poster-not-baked"] },
    { slug: "b", issues: [] },
    { slug: "c", issues: ["structure:missing-PRODUCT.md"] },
  ];
  const baseline = { a: ["render:loudness", "render:flat-frame0"], b: ["render:loudness"] };
  assert.deepEqual(compareToBaseline(results, baseline), {
    newIssues: ["a: render:poster-not-baked", "c: structure:missing-PRODUCT.md"],
    fixed: ["a: render:flat-frame0", "b: render:loudness"],
    nextBaseline: { a: ["render:loudness", "render:poster-not-baked"], c: ["structure:missing-PRODUCT.md"] },
  });
});

test("renderSummary produces a markdown table with a verdict", () => {
  const markdown = renderSummary(
    [{ slug: "horse-tinder", type: "landing-page", render: { duration: 20.02, lufs: -27.1 }, issues: ["render:loudness"] }],
    { newIssues: [], fixed: [] },
  );
  assert.match(markdown, /\| horse-tinder \| landing-page \| 20\.0s \| -27\.1 LUFS \| render:loudness \|/);
  assert.match(markdown, /No new issues/);
});

test("evalExample reports structure, detection, and render issues with stable codes", { skip: !hasFfmpeg && "ffmpeg not installed" }, () => {
  const root = mkdtempSync(path.join(tmpdir(), "brag-eval-"));
  try {
    const dir = path.join(root, "examples", "tiny");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "index.html"), "<h1>Tiny</h1>");
    writeFileSync(path.join(dir, "styles.css"), "body{}");
    execFileSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30:duration=2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path.join(dir, "brag.mp4"),
    ]);

    const result = evalExample(root, "tiny");
    assert.equal(result.type, "landing-page");
    assert.deepEqual(result.issues, ["structure:missing-PRODUCT.md", "render:duration", "render:no-audio"]);

    // A poster next to the example (not in the docs gallery) is still checked against frame 0.
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", "1", "-i", path.join(dir, "brag.mp4"), "-frames:v", "1", path.join(dir, "brag.jpg")]);
    assert.ok(evalExample(root, "tiny").issues.includes("render:poster-not-baked"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
