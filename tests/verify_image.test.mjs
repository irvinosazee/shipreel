import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { findChrome } from "../skills/shipreel/scripts/chrome.mjs";
import { IMAGE_BUDGETS, judgeClaims, judgeFile, judgeText, verifyCards } from "../skills/shipreel/scripts/verify_image.mjs";

const card = { size: [1200, 630] };
const ok = { text: "tidy", fontPx: 90, weight: 800, box: { left: 60, top: 100, right: 400, bottom: 200 }, overflow: false, overlaps: false, fg: "#111111", bg: "#ffffff" };
const codes = (errors) => errors.map((e) => e.code);

function pngHeader(file, w, h, padTo = 0) {
  const buf = Buffer.alloc(Math.max(33, padTo));
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf);
  buf.writeUInt32BE(13, 8); buf.write("IHDR", 12); buf.writeUInt32BE(w, 16); buf.writeUInt32BE(h, 20);
  writeFileSync(file, buf);
}

test("well-made text passes", () => {
  assert.deepEqual(judgeText([ok], card), []);
});

test("text too small for a phone fails, scaled to the image", () => {
  assert.deepEqual(codes(judgeText([{ ...ok, fontPx: 14 }], card)), ["text-too-small"]);
  // 28px per 1080px of the short side: 630px needs 17px.
  assert.deepEqual(judgeText([{ ...ok, fontPx: 17 }], card), []);
});

test("text crossing the safe margin, overflowing, or running into the image fails", () => {
  assert.deepEqual(codes(judgeText([{ ...ok, box: { ...ok.box, left: 5 } }], card)), ["text-outside-safe"]);
  assert.deepEqual(codes(judgeText([{ ...ok, overflow: true }], card)), ["text-overflow"]);
  assert.deepEqual(codes(judgeText([{ ...ok, overlaps: true }], card)), ["text-overlaps-image"]);
});

test("contrast uses WCAG: 3:1 for large text, 4.5:1 for body", () => {
  assert.deepEqual(codes(judgeText([{ ...ok, fg: "#bbbbbb" }], card)), ["contrast"], "#bbb on white is 1.9:1");
  const grey = { ...ok, fg: "#888888", fontPx: 40 };
  assert.deepEqual(judgeText([grey], card), [], "3.5:1 is enough for 40px");
  assert.deepEqual(codes(judgeText([{ ...grey, fontPx: 20, weight: 400 }], card)), ["contrast"], "but not for 20px body");
});

test("judgeFile checks the exact size and the platform's budget", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "shipreel-vi-"));
  try {
    pngHeader(path.join(dir, "og.png"), 1200, 630);
    assert.deepEqual(judgeFile(path.join(dir, "og.png"), { target: "og", size: [1200, 630] }).errors, []);
    pngHeader(path.join(dir, "wrong.png"), 1200, 628);
    assert.deepEqual(codes(judgeFile(path.join(dir, "wrong.png"), { target: "og", size: [1200, 630] }).errors), ["size"]);
    pngHeader(path.join(dir, "heavy.png"), 1200, 630, IMAGE_BUDGETS.og.warn + 1);
    assert.deepEqual(codes(judgeFile(path.join(dir, "heavy.png"), { target: "og", size: [1200, 630] }).warnings), ["file-heavy"]);
    pngHeader(path.join(dir, "huge.png"), 1280, 640, IMAGE_BUDGETS.github.max + 1);
    assert.deepEqual(codes(judgeFile(path.join(dir, "huge.png"), { target: "github", size: [1280, 640] }).errors), ["file-too-large"]);
    assert.deepEqual(codes(judgeFile(path.join(dir, "missing.png"), { target: "og", size: [1200, 630] }).errors), ["size"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("judgeClaims flags uncited numbers line by line, so lines never join into a phrase", () => {
  const claims = [{ text: "26 platforms" }];
  assert.deepEqual(judgeClaims(["One plan. 26 platforms."], claims), []);
  assert.deepEqual(codes(judgeClaims(["10x faster renders"], claims)), ["uncited-claim"]);
  assert.deepEqual(judgeClaims(["16:9", "free and open source"], []), [], "an aspect ratio next to a word is not a claim");
});

test("verifyCards measures real HTML: a crowded card fails, a good one passes", { skip: !findChrome() && "Chrome not found", timeout: 120_000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "shipreel-vi-"));
  try {
    mkdirSync(path.join(dir, "html"));
    const page = (body) => `<!doctype html><html><body style="margin:0;width:1200px;height:630px;background:#ffffff">${body}</body></html>`;
    writeFileSync(path.join(dir, "html", "good.html"), page(`<h1 data-text style="position:absolute;left:60px;top:60px;margin:0;font:800 80px sans-serif;color:#111">tidy</h1>`));
    writeFileSync(path.join(dir, "html", "bad.html"), page(`<p data-text style="position:absolute;left:4px;top:60px;margin:0;font:12px sans-serif;color:#ccc">tiny pale text 10x faster</p>`));
    pngHeader(path.join(dir, "good.png"), 1200, 630);
    pngHeader(path.join(dir, "bad.png"), 1200, 630);
    writeFileSync(path.join(dir, "cards.json"), JSON.stringify([
      { file: "good.png", target: "og", size: [1200, 630], texts: ["tidy"] },
      { file: "bad.png", target: "og", size: [1200, 630], texts: ["tiny pale text 10x faster"] },
    ]));
    const report = await verifyCards(dir, { claims: [] });
    assert.equal(report.ok, false);
    assert.deepEqual(report.cards[0].errors, []);
    assert.deepEqual(codes(report.cards[1].errors).sort(), ["contrast", "text-outside-safe", "text-too-small", "uncited-claim"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
