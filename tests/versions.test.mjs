import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { saveVersion, listVersions, compareVersions } from "../skills/brag/scripts/versions.mjs";

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const scenes = [
  { name: "Hook", start: 0, end: 2, role: "hook", settled: 1 },
  { name: "Payoff", start: 2, end: 4, role: "payoff", settled: 3 },
];

function makeRun(dir, color, seconds = 4) {
  execFileSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `color=${color}:size=360x640:rate=30:duration=${seconds}`,
    "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path.join(dir, "brag.mp4"),
  ]);
  writeFileSync(path.join(dir, "scenes.json"), JSON.stringify(scenes));
  writeFileSync(path.join(dir, "brag-plan.md"), `# plan (${color})`);
}

test("saveVersion copies the deliverables into numbered versions with a contact sheet", { skip: !hasFfmpeg && "ffmpeg not installed" }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "brag-versions-"));
  try {
    makeRun(dir, "red");
    const v1 = saveVersion(dir, { label: "first cut" });
    assert.equal(v1.version, 1);
    assert.ok(existsSync(path.join(dir, "versions", "v1", "brag.mp4")));
    assert.ok(existsSync(path.join(dir, "versions", "v1", "brag-plan.md")));
    assert.ok(!existsSync(path.join(dir, "versions", "v1", "review.md")), "missing optional files are skipped");
    assert.ok(existsSync(v1.sheet));
    const meta = JSON.parse(readFileSync(path.join(dir, "versions", "v1", "meta.json"), "utf8"));
    assert.equal(meta.label, "first cut");
    assert.equal(meta.scenes, 2);
    assert.ok(Math.abs(meta.duration - 4) < 0.2);

    makeRun(dir, "blue", 3);
    const v2 = saveVersion(dir, { label: "retone" });
    assert.equal(v2.version, 2);
    // scenes.json still says the payoff ends at 4s, but this render is 3s long.
    assert.deepEqual(v2.warnings, ["scenes.json runs to 4s but brag.mp4 is 3.0s; update scenes.json after re-rolls"]);
    assert.deepEqual(listVersions(dir).map((v) => [v.version, v.label]), [[1, "first cut"], [2, "retone"]]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("compareVersions stacks both versions scene by scene and reports what changed", { skip: !hasFfmpeg && "ffmpeg not installed" }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "brag-compare-"));
  try {
    makeRun(dir, "red");
    saveVersion(dir, { label: "a" });
    makeRun(dir, "blue", 3);
    saveVersion(dir, { label: "b" });

    const result = compareVersions(dir, 1, 2);
    assert.ok(existsSync(result.image));
    const [w, h] = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", result.image], { encoding: "utf8" })
      .trim().split(",").map(Number);
    assert.equal(w, 2 * 270, "two columns");
    assert.equal(h, 2 * 480, "one row per scene");
    assert.ok(Math.abs(result.durationDelta - -1) < 0.2, String(result.durationDelta));
    assert.throws(() => compareVersions(dir, 1, 9), /No version v9/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
