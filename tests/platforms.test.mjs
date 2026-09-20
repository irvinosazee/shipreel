import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  loadPlatforms,
  resolvePlatforms,
  planRenders,
  safeZoneInsets,
  budgetBitrateKbps,
  exportForPlatforms,
  drawSafeZones,
} from "../skills/shipreel/scripts/platforms.mjs";

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

test("platform data is complete and internally consistent", () => {
  const { formats, platforms } = loadPlatforms();
  for (const [id, platform] of Object.entries(platforms)) {
    assert.ok(formats[platform.format], `${id} uses unknown format ${platform.format}`);
    assert.ok(platform.label, `${id} needs a label`);
    const zone = platform.safeZone;
    for (const edge of ["top", "right", "bottom", "left"]) {
      assert.ok(zone[edge] >= 0 && zone[edge] < 0.5, `${id} ${edge}`);
    }
  }
  for (const id of ["tiktok", "reels", "shorts", "x", "linkedin", "youtube", "producthunt", "readme", "discord"]) {
    assert.ok(platforms[id], `missing ${id}`);
  }
  assert.equal(platforms.tiktok.format, "vertical");
  assert.equal(platforms.linkedin.format, "feed");
});

test("resolvePlatforms accepts lists, groups, and rejects unknown names", () => {
  assert.deepEqual(resolvePlatforms("tiktok, reels,tiktok").map((p) => p.id), ["tiktok", "reels"]);
  assert.deepEqual(resolvePlatforms("vertical").map((p) => p.id), ["tiktok", "reels", "shorts"]);
  assert.ok(resolvePlatforms("all").length >= 9);
  assert.throws(() => resolvePlatforms("myspace"), /Unknown platform "myspace".*tiktok/);
});

test("planRenders makes one render per frame size and merges constraints", () => {
  const renders = planRenders(resolvePlatforms("tiktok,reels,shorts,x,discord"));
  assert.deepEqual(renders.map((r) => r.format), ["vertical", "landscape"]);

  const vertical = renders[0];
  assert.deepEqual(vertical.size, [1080, 1920]);
  assert.deepEqual(vertical.platforms, ["tiktok", "reels", "shorts"]);
  const { platforms } = loadPlatforms();
  for (const edge of ["top", "right", "bottom", "left"]) {
    const strictest = Math.max(...["tiktok", "reels", "shorts"].map((id) => platforms[id].safeZone[edge]));
    assert.equal(vertical.safeZone[edge], strictest, edge);
  }
  assert.equal(vertical.captions, "burned");

  const landscape = renders[1];
  assert.equal(landscape.maxMb, 10);
});

test("safeZoneInsets converts fractions to pixels and a safe rectangle", () => {
  const insets = safeZoneInsets([1080, 1920], { top: 0.1, right: 0.15, bottom: 0.25, left: 0.05 });
  assert.deepEqual(insets, { top: 192, right: 162, bottom: 480, left: 54, safe: { x: 54, y: 192, width: 864, height: 1248 } });
});

test("budgetBitrateKbps leaves headroom for audio and container overhead", () => {
  const kbps = budgetBitrateKbps({ maxMb: 10, durationSec: 20, audioKbps: 128 });
  assert.ok(kbps > 3500 && kbps < 3900, String(kbps));
  assert.throws(() => budgetBitrateKbps({ maxMb: 0.05, durationSec: 60, audioKbps: 128 }), /too small/);
});

test("exportForPlatforms copies renders that fit and re-encodes ones over budget", { skip: !hasFfmpeg && "ffmpeg not installed" }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "shipreel-export-"));
  try {
    const render = path.join(dir, "shipreel-landscape.mp4");
    execFileSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=4",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
      "-c:v", "libx264", "-crf", "8", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", render,
    ]);
    const sourceMb = statSync(render).size / 1024 / 1024;
    const budgetMb = Number((sourceMb / 3).toFixed(2));

    const results = exportForPlatforms({
      renders: { landscape: render },
      platformIds: ["x", "discord", "readme"],
      outDir: path.join(dir, "exports"),
      overrides: { discord: { maxMb: budgetMb } },
    });

    const x = results.find((r) => r.platform === "x");
    const discord = results.find((r) => r.platform === "discord");
    assert.equal(x.action, "copied");
    assert.equal(discord.action, "re-encoded");
    assert.ok(existsSync(discord.path));
    assert.ok(statSync(discord.path).size <= budgetMb * 1024 * 1024, `${statSync(discord.path).size} > ${budgetMb} MB`);
    assert.match(path.basename(discord.path), /^shipreel-discord\.mp4$/);

    const readme = results.find((r) => r.platform === "readme");
    assert.equal(readme.action, "copied", "640px source is narrower than the 1280px export width");
    assert.ok(existsSync(readme.gif));
    assert.match(readme.gif, /shipreel-readme\.gif$/);
    // Animated WebP needs an ffmpeg built with libwebp; without it the export says why it was skipped.
    if (readme.webp) assert.ok(existsSync(readme.webp));
    else assert.match(readme.webpSkipped, /libwebp/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("exportForPlatforms reports a missing render instead of failing silently", () => {
  const results = exportForPlatforms({ renders: {}, platformIds: ["tiktok"], outDir: tmpdir() });
  assert.equal(results[0].action, "missing-render");
  assert.match(results[0].message, /vertical/);
});

test("drawSafeZones overlays the unsafe margins on a frame", { skip: !hasFfmpeg && "ffmpeg not installed" }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "shipreel-zones-"));
  try {
    const frame = path.join(dir, "frame.png");
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=white:size=1080x1920", "-frames:v", "1", frame]);
    const out = path.join(dir, "zones.png");
    drawSafeZones(frame, out, { top: 0.1, right: 0.1, bottom: 0.2, left: 0.05 });
    assert.ok(existsSync(out));
    const pixel = (x, y) =>
      execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", out, "-vf", `crop=1:1:${x}:${y},format=rgb24`, "-f", "rawvideo", "-"])
        .toJSON().data;
    assert.deepEqual(pixel(540, 960), [255, 255, 255], "safe area stays untouched");
    assert.notDeepEqual(pixel(540, 1850), [255, 255, 255], "bottom margin is shaded");

    // The shading must stay translucent so text under an unsafe margin is still visible in review.
    const dark = path.join(dir, "dark.jpg"); // review frames are chroma-subsampled JPEGs
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=black:size=1080x1920", "-frames:v", "1", dark]);
    const darkOut = path.join(dir, "dark-zones.png");
    drawSafeZones(dark, darkOut, { top: 0.1, right: 0.1, bottom: 0.2, left: 0.05 });
    const [r] = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", darkOut, "-vf", "crop=2:2:540:1850,format=rgb24", "-f", "rawvideo", "-"]).toJSON().data;
    assert.ok(r > 60 && r < 120, `expected a ~35% red blend over black, got R=${r}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
