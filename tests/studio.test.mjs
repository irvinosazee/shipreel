import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { findRenders, buildStudioPage, startStudio } from "../skills/brag/scripts/studio.mjs";

const scenes = [
  { name: "Hook", start: 0, end: 3.55, role: "hook", settled: 1.6 },
  { name: "Punchline", start: 18.55, end: 22.5, role: "payoff", settled: 21.5 },
];

function outputDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "brag-studio-"));
  writeFileSync(path.join(dir, "brag.mp4"), Buffer.alloc(4096, 7));
  writeFileSync(path.join(dir, "brag-vertical.mp4"), Buffer.alloc(10, 1));
  writeFileSync(path.join(dir, "brag.jpg"), "jpg");
  writeFileSync(path.join(dir, "scenes.json"), JSON.stringify(scenes));
  writeFileSync(path.join(dir, "share-copy.txt"), "We made <brag> & it's fun.\n");
  mkdirSync(path.join(dir, "versions", "v1"), { recursive: true });
  writeFileSync(path.join(dir, "versions", "v1", "meta.json"), JSON.stringify({ version: 1, label: "first", duration: 22.5, scenes: 2, warnings: [] }));
  writeFileSync(path.join(dir, "versions", "v1", "sheet.jpg"), "sheet");
  return dir;
}

test("findRenders lists the primary render first, then each extra format", () => {
  const dir = outputDir();
  try {
    assert.deepEqual(findRenders(dir), [
      { file: "brag.mp4", label: "primary" },
      { file: "brag-vertical.mp4", label: "vertical" },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildStudioPage shows every render, the storyboard, share copy, versions, and saved notes", () => {
  const html = buildStudioPage({
    title: "brag-output",
    renders: [{ file: "brag.mp4", label: "primary" }, { file: "brag-vertical.mp4", label: "vertical" }],
    scenes,
    shareCopy: "We made <brag> & it's fun.",
    versions: [{ version: 1, label: "first", duration: 22.5, scenes: 2, warnings: [] }],
    feedback: { notes: { Hook: "hold the flip longer" } },
  });
  assert.match(html, /<video[^>]+src="brag\.mp4"[^>]+poster="brag\.jpg"/);
  assert.match(html, /<video[^>]+src="brag-vertical\.mp4"/);
  assert.match(html, /data-start="0" data-end="3\.55"[^>]*>[\s\S]*?Hook/);
  assert.match(html, /We made &lt;brag&gt; &amp; it's fun\./);
  assert.match(html, /<textarea[^>]+data-scene="Hook"[^>]*>hold the flip longer<\/textarea>/);
  assert.match(html, /src="versions\/v1\/sheet\.jpg"/);
  assert.doesNotMatch(html, /<script[^>]+src=/, "self-contained");
});

test("the studio server serves the page and media with ranges, saves feedback, and blocks traversal", async () => {
  const dir = outputDir();
  const studio = await startStudio(dir, { port: 0 });
  try {
    const page = await fetch(studio.url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Brag Studio/);

    const range = await fetch(`${studio.url}brag.mp4`, { headers: { Range: "bytes=100-199" } });
    assert.equal(range.status, 206, "video seeking needs range requests");
    assert.equal(range.headers.get("content-type"), "video/mp4");
    assert.equal(range.headers.get("content-range"), "bytes 100-199/4096");
    assert.equal((await range.arrayBuffer()).byteLength, 100);

    const saved = await fetch(`${studio.url}feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: { Punchline: "land the box on the beat" } }),
    });
    assert.equal(saved.status, 200);
    const feedback = JSON.parse(readFileSync(path.join(dir, "feedback.json"), "utf8"));
    assert.equal(feedback.notes.Punchline, "land the box on the beat");

    assert.equal((await fetch(`${studio.url}feedback`, { method: "POST", body: "not json" })).status, 400);
    assert.equal((await fetch(`${studio.url}..%2F..%2Fetc%2Fpasswd`)).status, 403);
    assert.equal((await fetch(`${studio.url}missing.mp4`)).status, 404);
  } finally {
    await studio.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
