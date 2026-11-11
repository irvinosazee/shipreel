import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { xLength } from "../skills/shipreel/scripts/copy_check.mjs";
import { PIECE_SIZES } from "../skills/shipreel/scripts/cards.mjs";
import { altFor, captionFor, cardsFor, hashtagsFor, PLATFORM_RULES, postMeta, videoContent, writePiece, xPosts } from "../skills/shipreel/scripts/content.mjs";
import { distinctBeats } from "../skills/shipreel/scripts/angles.mjs";

const dossier = { project: { name: "tidy", type: "cli", framework: null }, media: {} };
const brief = { hashtags: { value: ["devtools", "buildinpublic", "productivity", "email"] } };
const piece = (platform, kind, extra = {}) => ({
  n: 1, id: "01-pain-hook", platform, angle: "pain-hook", why: "open on the problem", kind, format: "vertical",
  hook: "Stuck with inbox triage at midnight?", beats: ["Stuck with inbox triage at midnight?", "Inbox zero, finally.", "Sorts 10,000 emails a minute"], cta: "Try it: npx tidy", ...extra,
});

test("hashtags: the product's own tag, then the brief's, within each platform's range", () => {
  assert.deepEqual(hashtagsFor("tiktok", dossier, brief), ["#tidy", "#devtools", "#buildinpublic", "#productivity", "#email"]);
  assert.deepEqual(hashtagsFor("youtube-shorts", dossier, brief), ["#tidy", "#shorts", "#devtools"]);
  assert.deepEqual(hashtagsFor("x", dossier, brief), ["#tidy", "#devtools"]);
  assert.deepEqual(hashtagsFor("linkedin", dossier, null), ["#tidy"], "no brief tags: only the product's own");
  for (const p of Object.keys(PLATFORM_RULES)) assert.ok(hashtagsFor(p, dossier, brief).length <= PLATFORM_RULES[p].hashtags[1], p);
});

test("captions take each platform's shape", () => {
  const tags = ["#tidy"];
  const tt = captionFor(piece("tiktok", "video"), { hashtags: tags });
  assert.ok(tt.startsWith("Stuck with inbox triage at midnight?\n\nInbox zero, finally."));
  assert.ok(tt.endsWith("Try it: npx tidy\n\n#tidy"));
  const li = captionFor(piece("linkedin", "post"), { hashtags: tags });
  assert.match(li, /→ Inbox zero, finally\.\n→ Sorts 10,000 emails a minute/);
  const ig = captionFor(piece("instagram", "video", { cta: "Try it: https://tidy.app" }), { hashtags: tags });
  assert.match(ig, /Try it: https:\/\/tidy\.app \(link in bio\)/, "Instagram captions do not link");
});

test("X posts and threads each fit 280 as X counts them, counter included", () => {
  const long = piece("x", "thread", { beats: ["Stuck with inbox triage at midnight?", "x ".repeat(200).trim(), "Inbox zero, finally."] });
  const posts = xPosts(long, { hashtags: ["#tidy"] });
  assert.match(posts[0], /^1\/\d\n/);
  for (const p of posts) assert.ok(xLength(p) <= 280, `${xLength(p)}`);
  assert.equal(xPosts(piece("x", "post"), { hashtags: [] }).length, 1);
});

test("each kind gets its images in the right size: story frames clear of the app's UI", () => {
  const story = cardsFor(piece("instagram", "story"), { dossier });
  assert.deepEqual(story.map((c) => c.file), ["frame-01.png", "frame-02.png", "frame-03.png"]);
  assert.deepEqual(story[0].size, PIECE_SIZES.story.size);
  assert.deepEqual(story[0].insets, PIECE_SIZES.story.insets);
  const carousel = cardsFor(piece("linkedin", "carousel"), { dossier });
  assert.deepEqual(carousel.map((c) => c.kind), ["hero", "feature", "feature", "cta"]);
  assert.equal(carousel.at(-1).detail, "npx tidy");
  assert.deepEqual(cardsFor(piece("x", "post"), { dossier })[0].size, PIECE_SIZES.landscape.size);
  assert.equal(cardsFor(piece("tiktok", "video"), { dossier })[0].file, "cover.png");
});

test("a long line on a slide becomes body text under the slide number", () => {
  const long = piece("instagram", "carousel", { beats: ["Hook here?", "This is a much longer line that would never fit as a big title on a slide"] });
  const [, s2] = cardsFor(long, { dossier });
  assert.equal(s2.title, "01");
  assert.match(s2.subtitle, /^This is a much longer line/);
});

test("alt text names what each image says", () => {
  const alt = altFor(cardsFor(piece("instagram", "story"), { dossier }), { dossier });
  assert.match(alt, /^frame-01\.png: "Stuck with inbox triage at midnight\?" on a plain background\.$/m);
  assert.match(alt, /frame-03\.png: "tidy npx tidy" with the link to try it\./);
});

test("distinctBeats drops repeats and the hook's echo", () => {
  assert.deepEqual(distinctBeats("Who loves X?", ["Who loves X?", "Who loves X? A live table of love", "A live table of love"]), ["Who loves X?", "A live table of love"]);
});

test("video content feeds the card-video engine; post.json carries the platform's rules", () => {
  const vc = videoContent(piece("tiktok", "video"), { dossier, theme: { bg: "#000000", fg: "#ffffff", muted: "#aaaaaa", accent: "#ff6600" } });
  assert.equal(vc.title, "Stuck with inbox triage at midnight?");
  assert.equal(vc.outro.detail, "npx tidy");
  const meta = postMeta(piece("youtube-shorts", "video", { hook: "x".repeat(140) }), { files: ["video.mp4"], hashtags: ["#tidy"] });
  assert.equal(meta.title.length, 100);
  assert.equal(meta.format, "vertical");
  assert.equal(meta.limits.caption, 5000);
  assert.match(meta.postingWindow, /local time/);
});

test("writePiece writes the text files and returns what still needs rendering", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "shipreel-piece-"));
  try {
    const out = writePiece(piece("tiktok", "video"), { dossier, brief, dir });
    for (const f of ["caption.txt", "hashtags.txt", "alt.txt", "post.json", "content.json"]) assert.ok(existsSync(path.join(dir, f)), f);
    assert.ok(out.video && out.cards.length === 1);
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, "post.json"), "utf8")).files, ["caption.txt", "hashtags.txt", "alt.txt", "content.json", "video.mp4", "cover.png"]);
    const xdir = path.join(dir, "x");
    writePiece(piece("x", "thread"), { dossier, brief, dir: xdir });
    assert.ok(existsSync(path.join(xdir, "thread.txt")) && !existsSync(path.join(xdir, "caption.txt")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
