import { test } from "node:test";
import assert from "node:assert/strict";

import { fitFontPx, planCardVideo, buildCardComposition, contentBox, CARD_THEME } from "../skills/brag/scripts/template_video.mjs";
import { contrastRatio } from "../skills/brag/scripts/captions.mjs";

const content = {
  kicker: "v2.4.0",
  title: "brag",
  subtitle: "turn any project into a launch video",
  stats: [{ value: "142", label: "commits" }, { value: "3", label: "contributors" }],
  screenshots: [{ file: "shot.png", width: 1080, height: 3000, caption: "the landing page" }],
  highlights: { heading: "what's new", items: ["vertical exports for tiktok and reels", "burned-in karaoke captions", "golden-frame regression tests"] },
  outro: { line: "try it", detail: "npx brag-video make" },
};

test("fitFontPx picks the largest size whose wrapped lines fit, and truncates only when the minimum cannot", () => {
  assert.equal(fitFontPx("brag", { width: 1600, maxPx: 160, minPx: 60, maxLines: 2 }).px, 160);
  const long = fitFontPx("a much longer title that needs to wrap onto more than one line", { width: 810, maxPx: 120, minPx: 56, maxLines: 3 });
  assert.ok(long.px < 120 && long.px >= 56);
  assert.equal(long.text, "a much longer title that needs to wrap onto more than one line");
  const huge = fitFontPx("word ".repeat(80).trim(), { width: 810, maxPx: 120, minPx: 56, maxLines: 2 });
  assert.equal(huge.px, 56);
  assert.match(huge.text, /…$/);
  assert.ok(huge.text.split(" ").length < 80);
});

test("contentBox keeps vertical content inside the merged TikTok/Reels/Shorts safe rectangle", () => {
  const box = contentBox("vertical");
  assert.ok(box.x >= 65 && box.x + box.width <= 929, JSON.stringify(box));
  assert.ok(box.y >= 250 && box.y + box.height <= 1440, JSON.stringify(box));
  assert.deepEqual(contentBox("landscape").frame, [1920, 1080]);
});

test("planCardVideo times scenes back to back, holds text long enough to read, and stays within 25s", () => {
  const plan = planCardVideo(content, { format: "landscape" });
  assert.deepEqual(plan.scenes.map((s) => s.id), ["hook", "stats", "shot-0", "highlights", "outro"]);
  let t = 0;
  for (const scene of plan.scenes) {
    assert.equal(scene.start, t);
    t = Math.round((t + scene.duration) * 1000) / 1000;
  }
  assert.equal(plan.duration, t);
  assert.ok(plan.duration >= 10 && plan.duration <= 25, String(plan.duration));
  const highlights = plan.scenes.find((s) => s.id === "highlights");
  assert.ok(highlights.duration >= 0.3 * 12 + 0.8, "three items of ~4 words get their reading time");
  assert.ok(plan.posterAt > 0 && plan.posterAt < plan.scenes[0].duration, "the poster is the settled hook");
});

test("planCardVideo drops extra screenshots and highlight items rather than running long", () => {
  const busy = {
    ...content,
    screenshots: Array.from({ length: 5 }, (_, i) => ({ file: `s${i}.png`, width: 1920, height: 1080 })),
    highlights: { items: Array.from({ length: 12 }, (_, i) => `a fairly long highlight line number ${i} with extra words`) },
  };
  const plan = planCardVideo(busy, { format: "vertical" });
  assert.ok(plan.duration <= 25, String(plan.duration));
  assert.ok(plan.scenes.filter((s) => s.id.startsWith("shot-")).length <= 2);
  assert.ok(plan.highlightItems.length <= 4);
  assert.ok(plan.dropped.length > 0, "what was left out is reported");
});

test("planCardVideo works with only a title", () => {
  const plan = planCardVideo({ title: "tiny" }, { format: "square" });
  assert.deepEqual(plan.scenes.map((s) => s.id), ["hook", "outro"]);
  assert.ok(plan.duration >= 5);
});

test("buildCardComposition emits a lint-shaped Hyperframes root with one paused timeline", () => {
  const { html, plan } = buildCardComposition(content, { format: "vertical", music: "assets/music.wav" });
  assert.match(html, /data-composition-id="main"/);
  assert.match(html, /data-width="1080" data-height="1920"/);
  assert.match(html, new RegExp(`data-duration="${plan.duration}"`));
  assert.match(html, /html, body \{ width: 1080px; height: 1920px;/);
  assert.match(html, /gsap\.timeline\(\{ paused: true \}\)/);
  assert.match(html, /window\.__timelines\["main"\] = tl;/);
  assert.match(html, /<audio id="music" src="assets\/music\.wav"/);
  assert.doesNotMatch(html, /crossorigin/);
  assert.doesNotMatch(html, /oklch\(/, "hex colors keep the contrast audit working");
  assert.equal((html.match(/class="clip scene/g) || []).length, plan.scenes.length);
  assert.match(html, /<img id="shot-0-img" src="assets\/shot-0\.png"/);
  assert.match(html, /npx brag-video make/);
  assert.doesNotMatch(buildCardComposition({ title: "<script>" }, { format: "square" }).html, /<h1[^>]*><script>/, "text is escaped");
});

test("viewport-sized screenshots are fitted whole; only full-page screenshots pan", () => {
  const viewport = buildCardComposition({ title: "x", screenshots: [{ file: "v.png", width: 1080, height: 1920 }] }, { format: "vertical" });
  assert.doesNotMatch(viewport.html, /#shot-0-img", \{ y: 0 \}/);
  const page = buildCardComposition({ title: "x", screenshots: [{ file: "p.png", width: 1080, height: 4000 }] }, { format: "vertical" });
  assert.match(page.html, /#shot-0-img", \{ y: 0 \}/);
});

test("the default theme passes contrast for body, muted, and accent text", () => {
  for (const key of ["fg", "muted", "accent"]) assert.ok(contrastRatio(CARD_THEME[key], CARD_THEME.bg) >= 4.5, key);
});
