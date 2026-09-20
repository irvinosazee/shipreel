import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseVersion,
  compareVersions,
  resolveSkillRoot,
  checkAssets,
  detectTools,
  summarize,
} from "../skills/shipreel/scripts/doctor.mjs";

const repoSkillRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../skills/shipreel",
);

test("parseVersion extracts semver from noisy CLI output", () => {
  assert.deepEqual(parseVersion("v24.11.1"), [24, 11, 1]);
  assert.deepEqual(parseVersion("ffmpeg version 8.1.1 Copyright"), [8, 1, 1]);
  assert.deepEqual(parseVersion("uv 0.5"), [0, 5, 0]);
  assert.equal(parseVersion("command not found"), null);
});

test("compareVersions orders versions numerically", () => {
  assert.equal(compareVersions([0, 6, 99], [0, 7, 0]), -1);
  assert.equal(compareVersions([0, 8, 43], [0, 6, 99]), 1);
  assert.equal(compareVersions([22, 0, 0], [22, 0, 0]), 0);
});

test("resolveSkillRoot is the directory above scripts/", () => {
  const scriptUrl = new URL("../skills/shipreel/scripts/doctor.mjs", import.meta.url).href;
  assert.equal(resolveSkillRoot(scriptUrl), repoSkillRoot);
});

test("checkAssets finds the bundled library in the repo copy", () => {
  const assets = checkAssets(repoSkillRoot);
  assert.equal(assets.music.tracks.length, 5);
  assert.deepEqual(assets.music.missingCues, []);
  assert.ok(assets.sfx.families.impact > 0);
  assert.ok(assets.sfx.families.keyboard > 0);
  assert.equal(assets.sfx.analysis, true);
});

test("checkAssets reports a stripped install without throwing", () => {
  const root = mkdtempSync(path.join(tmpdir(), "shipreel-doctor-"));
  try {
    mkdirSync(path.join(root, "assets/music"), { recursive: true });
    writeFileSync(path.join(root, "assets/music/track.mp3"), "");
    const assets = checkAssets(root);
    assert.deepEqual(assets.music.tracks, ["track.mp3"]);
    assert.deepEqual(assets.music.missingCues, ["track"]);
    assert.deepEqual(assets.sfx.families, {});
    assert.equal(assets.sfx.analysis, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("detectTools parses versions from an injected runner", () => {
  const outputs = {
    ffmpeg: "ffmpeg version 8.1.1",
    ffprobe: "ffprobe version 8.1.1",
    npx: "0.8.43",
    uv: null,
  };
  const tools = detectTools({
    nodeVersion: "v24.11.1",
    run: (cmd) => outputs[cmd] ?? null,
  });
  assert.deepEqual(tools.node, [24, 11, 1]);
  assert.deepEqual(tools.ffmpeg, [8, 1, 1]);
  assert.deepEqual(tools.hyperframes, [0, 8, 43]);
  assert.equal(tools.uv, null);
});

const fullAssets = {
  music: { tracks: ["a.mp3"], missingCues: [] },
  sfx: { families: { impact: 3 }, analysis: true },
};

test("summarize: healthy environment has no blockers", () => {
  const report = summarize({
    tools: { node: [24, 0, 0], ffmpeg: [8, 0, 0], ffprobe: [8, 0, 0], hyperframes: [0, 8, 43], uv: null },
    assets: fullAssets,
  });
  assert.deepEqual(report.blockers, []);
  assert.equal(report.capabilities.music, true);
  assert.equal(report.capabilities.sfx, true);
  assert.equal(report.capabilities.beatSync.bundled, "preset");
  assert.equal(report.capabilities.beatSync.custom, "hyperframes-beats");
});

test("summarize: missing ffmpeg, old node and missing hyperframes are blockers", () => {
  const report = summarize({
    tools: { node: [20, 0, 0], ffmpeg: null, ffprobe: null, hyperframes: null, uv: null },
    assets: fullAssets,
  });
  assert.equal(report.blockers.length, 3);
  assert.match(report.blockers.join("\n"), /Node\.js 22/);
  assert.match(report.blockers.join("\n"), /FFmpeg/);
  assert.match(report.blockers.join("\n"), /Hyperframes/);
});

test("summarize: missing assets degrade audio instead of blocking", () => {
  const report = summarize({
    tools: { node: [24, 0, 0], ffmpeg: [8, 0, 0], ffprobe: [8, 0, 0], hyperframes: [0, 6, 0], uv: [0, 5, 0] },
    assets: { music: { tracks: [], missingCues: [] }, sfx: { families: {}, analysis: false } },
  });
  assert.deepEqual(report.blockers, []);
  assert.equal(report.capabilities.music, false);
  assert.equal(report.capabilities.sfx, false);
  assert.equal(report.capabilities.beatSync.custom, "analyze-script");
  assert.ok(report.warnings.some((w) => /music/i.test(w)));
});

test("summarize: respects --no-music and --no-sfx without warning", () => {
  const report = summarize({
    tools: { node: [24, 0, 0], ffmpeg: [8, 0, 0], ffprobe: [8, 0, 0], hyperframes: [0, 8, 0], uv: null },
    assets: { music: { tracks: [], missingCues: [] }, sfx: { families: {}, analysis: false } },
    flags: { noMusic: true, noSfx: true },
  });
  assert.equal(report.capabilities.music, false);
  assert.equal(report.capabilities.sfx, false);
  assert.deepEqual(report.warnings, []);
});
