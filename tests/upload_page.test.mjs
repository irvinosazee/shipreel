import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseShareVariants, buildUploadPage, writeUploadPage } from "../skills/shipreel/scripts/upload_page.mjs";

const variants = `# Share copy variants

## TikTok
we built a tool <that> makes launch videos. #buildinpublic
Cover: the poster frame.

## Instagram Reels
You built it. Now shipreel.
`;

test("parseShareVariants separates the postable caption from the cover note", () => {
  const parsed = parseShareVariants(variants);
  assert.deepEqual(Object.keys(parsed), ["TikTok", "Instagram Reels"]);
  assert.equal(parsed.TikTok.caption, "we built a tool <that> makes launch videos. #buildinpublic");
  assert.equal(parsed.TikTok.cover, "the poster frame.");
  assert.equal(parsed["Instagram Reels"].cover, null);
});

test("buildUploadPage lists each platform with its file, caption, notes, and escapes HTML", () => {
  const html = buildUploadPage({
    title: "/shipreel",
    exports: [
      { platform: "readme", path: "shipreel-readme.mp4", sizeMb: 1.2, gif: "shipreel-readme.gif" },
      { platform: "tiktok", path: "shipreel-tiktok.mp4", sizeMb: 1.39 },
    ],
    shareCopy: "Default caption & more",
    variants: parseShareVariants(variants),
    covers: [{ id: "youtube", path: "../covers/youtube.jpg" }],
  });
  assert.match(html, /<title>Upload checklist · \/shipreel<\/title>/);
  assert.match(html, /href="shipreel-tiktok\.mp4"/);
  assert.match(html, /we built a tool &lt;that&gt; makes launch videos/);
  assert.doesNotMatch(html, /<pre[^>]*>[^<]*Cover:/, "cover notes never land in the copyable caption");
  assert.match(html, /the poster frame\./, "the run's own cover note is still shown");
  assert.ok(html.indexOf("TikTok") < html.indexOf("GitHub README"), "cards follow platforms.json order");
  assert.match(html, /Default caption &amp; more/, "platforms without a variant fall back to share-copy.txt");
  assert.match(html, /Right rail holds like\/comment\/share/, "platform notes come from platforms.json");
  assert.match(html, /href="shipreel-readme\.gif"/);
  assert.match(html, /src="\.\.\/covers\/youtube\.jpg"/);
  assert.equal((html.match(/<button type="button" data-copy-target=/g) ?? []).length, 2, "one copy button per platform");
  assert.doesNotMatch(html, /<script[^>]+src=/, "the page is self-contained");
});

test("writeUploadPage reads an output directory and writes exports/index.html", () => {
  const out = mkdtempSync(path.join(tmpdir(), "shipreel-upload-"));
  try {
    mkdirSync(path.join(out, "exports"));
    writeFileSync(path.join(out, "exports", "shipreel-tiktok.mp4"), "x");
    writeFileSync(path.join(out, "share-copy.txt"), "Made /shipreel.\n");
    writeFileSync(path.join(out, "share-copy-variants.md"), variants);
    const page = writeUploadPage(out);
    assert.equal(page, path.join(out, "exports", "index.html"));
    assert.ok(existsSync(page));
    assert.match(readFileSync(page, "utf8"), /TikTok/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
