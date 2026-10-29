import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";

import { CARD_TARGETS, cardGeometry, cardHtml, cardTexts, cardTheme, imageSize, planCards, renderCards, SAFE_MARGIN } from "../skills/shipreel/scripts/cards.mjs";
import { contrastRatio } from "../skills/shipreel/scripts/captions.mjs";
import { findChrome } from "../skills/shipreel/scripts/chrome.mjs";

// A solid-colour PNG of any size, so planning can read real image headers.
function png(file, w, h) {
  const crc = (buf) => {
    let c = ~0;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x55)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  writeFileSync(file, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "shipreel-cards-"));
  mkdirSync(path.join(dir, "out", "review"), { recursive: true });
  png(path.join(dir, "out", "shipreel.png"), 160, 90);
  png(path.join(dir, "out", "shipreel-vertical.png"), 90, 160);
  png(path.join(dir, "out", "review", "frame-01.png"), 160, 90);
  const dossier = {
    project: { name: "tidy", description: "Inbox zero, finally. It sorts your mail by sender.", url: "https://tidy.app", install: "npx tidy", type: "web-app" },
    highlights: ["Snooze: newsletters wait until Friday", "Sorts mail by sender for you"],
    brand: { palette: { bg: "#ffffff", fg: "#111111", muted: "#666666", accent: "#ffe14d" }, fonts: { display: "Fraunces", body: "Inter" } },
    media: { posters: ["out/shipreel.png", "out/shipreel-vertical.png"], frames: ["out/review/frame-01.png"], captures: [] },
  };
  return { dir, dossier };
}

test("every target has the platform's exact size", () => {
  assert.deepEqual(CARD_TARGETS.og.size, [1200, 630]);
  assert.deepEqual(CARD_TARGETS.x.size, [1600, 900]);
  assert.deepEqual(CARD_TARGETS.github.size, [1280, 640]);
  assert.deepEqual(CARD_TARGETS.producthunt.size, [1270, 760]);
  assert.deepEqual(CARD_TARGETS.linkedin.size, [1080, 1350]);
});

test("imageSize reads PNG headers", () => {
  const { dir } = fixture();
  try {
    assert.deepEqual(imageSize(path.join(dir, "out", "shipreel-vertical.png")), [90, 160]);
    assert.equal(imageSize(path.join(dir, "missing.png")), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cardTheme only uses colours that pass WCAG on the background", () => {
  const t = cardTheme({ palette: { bg: "#ffffff", fg: "#eeeeee", muted: "#dddddd", accent: "#ffe14d" } });
  assert.ok(contrastRatio(t.fg, t.bg) >= 4.5, "an unreadable fg is replaced");
  assert.ok(contrastRatio(t.muted, t.bg) >= 4.5);
  assert.equal(t.accentText, t.fg, "a pale accent is not used for text on white");
  assert.ok(contrastRatio(t.onAccent, t.accent) >= 4.5, "text on an accent fill is black or white, whichever reads");
});

test("planCards: one hero per single-image target, features for galleries, a closing card for the carousel", () => {
  const { dir, dossier } = fixture();
  try {
    const cards = planCards(dossier, { projectDir: dir });
    const by = (t) => cards.filter((c) => c.target === t);
    assert.equal(by("og").length, 1);
    assert.equal(by("producthunt").length, 3, "hero + two features");
    assert.deepEqual(by("linkedin").map((c) => c.kind), ["hero", "feature", "feature", "cta"]);
    assert.deepEqual(by("linkedin").map((c) => c.file), ["linkedin-01.png", "linkedin-02.png", "linkedin-03.png", "linkedin-04.png"]);
    const snooze = by("producthunt")[1];
    assert.equal(snooze.title, "Snooze", "a 'Label: meaning' highlight splits into title and line");
    assert.equal(snooze.subtitle, "Newsletters wait until Friday", "capitalised as a line of its own");
    assert.equal(by("og")[0].kicker, "tidy.app");
    assert.equal(by("linkedin").at(-1).detail, "npx tidy");
    assert.equal(by("linkedin").at(-1).image, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("images are matched to the card's shape: landscape frames for landscape cards, the vertical poster for tall ones", () => {
  const { dir, dossier } = fixture();
  try {
    const cards = planCards(dossier, { projectDir: dir });
    assert.equal(path.basename(cards.find((c) => c.target === "og").image), "shipreel.png");
    const tall = cards.find((c) => c.target === "linkedin" && c.kind === "hero");
    assert.ok(cardGeometry(tall).media.h > cardGeometry(tall).media.w * 0.5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cardHtml is deterministic, escapes text, and keeps a safe margin", () => {
  const { dir, dossier } = fixture();
  try {
    const card = { ...planCards(dossier, { projectDir: dir, targets: ["og"] })[0], title: "<b>tidy</b> & co" };
    const theme = cardTheme(dossier.brand);
    const html = cardHtml(card, theme, { projectDir: dir });
    assert.equal(html, cardHtml(card, theme, { projectDir: dir }));
    assert.ok(html.includes("&lt;b&gt;tidy&lt;/b&gt; &amp; co"));
    assert.ok(!html.includes("<b>tidy</b>"));
    const m = Math.round(630 * SAFE_MARGIN);
    assert.ok(html.includes(`left: ${m}px; top: ${m}px`));
    assert.ok(html.includes("family=Fraunces"), "brand fonts load");
    assert.deepEqual(cardTexts(card), ["tidy.app", "<b>tidy</b> & co", card.subtitle]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("planCards rejects an unknown target", () => {
  assert.throws(() => planCards({ project: { name: "x" } }, { targets: ["myspace"] }), /Unknown card target "myspace"/);
});

test("renderCards writes PNGs at their exact sizes, a carousel PDF, and a manifest", { skip: !findChrome() && "Chrome not found", timeout: 120_000 }, async () => {
  const { dir, dossier } = fixture();
  try {
    const { cards, pdf } = await renderCards(dossier, { projectDir: dir, outDir: path.join(dir, "out"), targets: ["og", "linkedin"] });
    for (const c of cards) assert.deepEqual(imageSize(path.join(dir, "out", "cards", c.file)), c.size, c.file);
    assert.ok(existsSync(pdf) && readFileSync(pdf, "latin1").startsWith("%PDF"));
    const manifest = JSON.parse(readFileSync(path.join(dir, "out", "cards", "cards.json"), "utf8"));
    assert.equal(manifest.length, 5);
    assert.ok(manifest[0].texts.includes("tidy"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("feature cards spread across the run's frames instead of repeating the poster", () => {
  const { dir, dossier } = fixture();
  try {
    png(path.join(dir, "out", "review", "frame-02.png"), 160, 90);
    png(path.join(dir, "out", "review", "frame-03.png"), 160, 90);
    const d = { ...dossier, highlights: ["a b", "c d", "e f"], media: { ...dossier.media, frames: ["out/review/frame-01.png", "out/review/frame-02.png", "out/review/frame-03.png"] } };
    const gallery = planCards(d, { projectDir: dir, targets: ["producthunt"] });
    assert.equal(path.basename(gallery[0].image), "shipreel.png", "the hero shows the poster");
    assert.deepEqual(gallery.slice(1).map((c) => path.basename(c.image)), ["frame-01.png", "frame-02.png", "frame-03.png"], "features show three different moments");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a GitHub project's kicker is owner/repo, not the long URL", () => {
  const [card] = planCards({ project: { name: "x", url: "https://github.com/someone/a-long-project-name" } }, { targets: ["og"] });
  assert.equal(card.kicker, "someone/a-long-project-name");
});

