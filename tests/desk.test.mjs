import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { deskHtml, parseAlt, parseCalendar, readCampaign, splitThread, writeDesk } from "../skills/shipreel/scripts/desk.mjs";

test("a thread splits into its posts, each keeping its counter", () => {
  assert.deepEqual(splitThread("1/2\nHook.\n\nMore here.\n\n2/2\nTry it: tidy.app"), ["1/2\nHook.\n\nMore here.", "2/2\nTry it: tidy.app"]);
});

test("alt text and the calendar parse from the files max writes", () => {
  assert.deepEqual(parseAlt('slide-01.png: "Hook" over a screen.\nslide-02.png: the link.'), [{ file: "slide-01.png", text: '"Hook" over a screen.' }, { file: "slide-02.png", text: "the link." }]);
  const cal = parseCalendar("# tidy: two-week campaign\n\n## Day 1\n- **TikTok** · video · `tiktok/01-pain-hook` · 7pm\n  \"Hook\"\n\n## Day 2\n- **X** · thread · `x/01-hot-take` · 8am\n");
  assert.equal(cal.product, "tidy");
  assert.deepEqual(cal.days, [{ day: 1, posts: ["tiktok/01-pain-hook"] }, { day: 2, posts: ["x/01-hot-take"] }]);
});

test("writeDesk reads a campaign folder in calendar order, with every text to copy, and builds it into the page", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "shipreel-desk-"));
  try {
    const piece = (key, meta, files) => {
      mkdirSync(path.join(dir, key), { recursive: true });
      writeFileSync(path.join(dir, key, "post.json"), JSON.stringify({ kind: "video", hook: "Hook", postingWindow: "7pm", limits: { caption: 2200 }, ...meta }));
      for (const [f, t] of Object.entries(files)) writeFileSync(path.join(dir, key, f), t);
    };
    piece("tiktok/01-pain-hook", { hook: "Stuck at midnight?" }, { "caption.txt": "Stuck at midnight?\n\nTry it: tidy.app", "hashtags.txt": "#tidy\n#inbox", "alt.txt": "cover.png: the hook.", "video.mp4": "", "video-poster.jpg": "", "cover.png": "" });
    piece("x/01-hot-take", { kind: "thread", hook: "</script><b>x" }, { "thread.txt": "1/2\nHot take.\n\n2/2\nTry it: tidy.app", "slide-02.png": "", "slide-01.png": "" });
    piece("linkedin/01-proof", {}, { "caption.txt": "Proof." });
    writeFileSync(path.join(dir, "calendar.md"), "# tidy: two-week campaign\n\n## Day 1\n- `x/01-hot-take`\n\n## Day 2\n- `tiktok/01-pain-hook`\n");

    const data = readCampaign(dir);
    assert.equal(data.product, "tidy");
    assert.deepEqual(data.days.map((d) => d.posts), [["x/01-hot-take"], ["tiktok/01-pain-hook"], ["linkedin/01-proof"]], "calendar order, then pieces it does not list");
    const tt = data.pieces["tiktok/01-pain-hook"];
    assert.equal(tt.hashtags, "#tidy #inbox");
    assert.deepEqual(tt.media.map((m) => m.file), ["video.mp4", "cover.png"], "video first, its poster not listed as an image");
    assert.equal(tt.media[0].poster, "video-poster.jpg");
    assert.deepEqual(data.pieces["x/01-hot-take"].thread, ["1/2\nHot take.", "2/2\nTry it: tidy.app"]);
    assert.deepEqual(data.pieces["x/01-hot-take"].media.map((m) => m.file), ["slide-01.png", "slide-02.png"]);

    const page = writeDesk(dir, { accent: "#ff6134", onAccent: "#000000" });
    const html = readFileSync(page, "utf8");
    assert.match(html, /<title>tidy campaign<\/title>/);
    assert.ok(!html.includes("</script><b>"), "campaign text cannot close the data script");
    assert.equal(JSON.parse(readFileSync(path.join(dir, "campaign.json"), "utf8")).accent, "#ff6134");
    assert.equal(readCampaign(dir).accent, "#ff6134", "the accent survives a rebuild from the folder");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("without a campaign, the desk waits for a dropped folder", () => {
  const html = deskHtml(null);
  assert.match(html, /<script id="campaign" type="application\/json">null<\/script>/);
  assert.match(html, /Drop a campaign folder here/);
  assert.match(html, /webkitdirectory/);
});

test("the desk has three looks, night by default, and its panels hide their scrollbars", () => {
  assert.match(deskHtml(null), /<html lang="en" data-look="night">/);
  assert.match(deskHtml(null, { look: "feed" }), /data-look="feed"/);
  assert.match(deskHtml(null), /\.queue::-webkit-scrollbar[^{]*\{ display: none; \}/);
});

test("the night desk previews each piece as a post, with the files a switch away", () => {
  const html = deskHtml(null);
  assert.match(html, /function phonePost\(p\)/, "vertical video and stories in a phone, caption over the bottom");
  assert.match(html, /k === "post" \? "Post" : "Files"/);
});
