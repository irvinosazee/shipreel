import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { FORMATS, stampHtml, stampFormats, detectFormat } from "../skills/brag/scripts/formats.mjs";

const source = `<!doctype html>
<html lang="en" data-resolution="portrait">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <style>
      html, body { width: 1080px; height: 1920px; }
      [data-format="landscape"] .content { flex-direction: row; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-width="1080" data-height="1920" data-duration="22.5">
      <section class="clip" data-start="0" data-duration="3" data-width="400"></section>
    </div>
  </body>
</html>`;

test("FORMATS covers the four frame shapes with Hyperframes resolution names", () => {
  assert.deepEqual(FORMATS.landscape, { size: [1920, 1080], resolution: "landscape" });
  assert.deepEqual(FORMATS.vertical, { size: [1080, 1920], resolution: "portrait" });
  assert.deepEqual(FORMATS.square.size, [1080, 1080]);
  assert.deepEqual(FORMATS.feed.size, [1080, 1350]);
});

test("detectFormat reads the root's frame size", () => {
  assert.equal(detectFormat(source), "vertical");
});

test("stampHtml sets the root size, viewport, resolution, and data-format for the target", () => {
  const out = stampHtml(source, "landscape");
  assert.match(out, /<html lang="en" data-resolution="landscape">/);
  assert.match(out, /<meta name="viewport" content="width=1920, height=1080" \/>/);
  assert.match(out, /data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="22.5" data-format="landscape"/);
  assert.match(out, /<style id="brag-format">html, body \{ width: 1920px; height: 1080px; \}<\/style>\n  <\/head>/);
  assert.match(out, /<section class="clip" data-start="0" data-duration="3" data-width="400">/, "only the root's size changes");
  assert.match(out, /\[data-format="landscape"\] \.content/, "the source's per-format rules are kept");
  assert.match(out, /html, body \{ width: 1920px; height: 1080px; \}\n      \[data-format/, "the source's own html/body size rule is rewritten, so lint sees the real frame");
});

test("stampHtml is idempotent and replaces an earlier stamp", () => {
  const once = stampHtml(stampHtml(source, "feed"), "square");
  assert.equal((once.match(/id="brag-format"/g) ?? []).length, 1);
  assert.equal((once.match(/data-format="square"/g) ?? []).length, 1, "one stamped attribute");
  assert.match(once, /data-width="1080" data-height="1080"/);
  assert.equal(stampHtml(once, "square"), once);
});

test("stampHtml rejects unknown formats and HTML without a composition root", () => {
  assert.throws(() => stampHtml(source, "cinema"), /Unknown format "cinema"/);
  assert.throws(() => stampHtml("<html></html>", "vertical"), /data-composition-id/);
});

test("stampFormats writes composition-<format> directories that share the source assets", () => {
  const root = mkdtempSync(path.join(tmpdir(), "brag-formats-"));
  try {
    const src = path.join(root, "composition");
    mkdirSync(path.join(src, "assets", "music"), { recursive: true });
    writeFileSync(path.join(src, "index.html"), source);
    writeFileSync(path.join(src, "assets", "music", "bed.mp3"), "audio");
    writeFileSync(path.join(src, "hyperframes.json"), "{}");

    const results = stampFormats(src, ["vertical", "landscape", "feed"]);
    assert.deepEqual(results.map((r) => r.format), ["vertical", "landscape", "feed"]);
    assert.equal(results[0].dir, src, "the source's own format renders from the source");
    assert.match(readFileSync(path.join(src, "index.html"), "utf8"), /data-format="vertical"/, "the source also carries its own data-format");

    const landscape = path.join(root, "composition-landscape");
    assert.equal(results[1].dir, landscape);
    assert.match(readFileSync(path.join(landscape, "index.html"), "utf8"), /data-width="1920"/);
    assert.ok(existsSync(path.join(landscape, "assets", "music", "bed.mp3")));
    assert.ok(existsSync(path.join(landscape, "hyperframes.json")));
    assert.ok(!lstatSync(path.join(landscape, "assets")).isSymbolicLink(), "assets are copied so the renderer serves them");
    assert.match(readFileSync(path.join(landscape, "GENERATED.md"), "utf8"), /do not edit/i);

    writeFileSync(path.join(src, "index.html"), source.replace("22.5", "20"));
    stampFormats(src, ["landscape"]);
    assert.match(readFileSync(path.join(landscape, "index.html"), "utf8"), /data-duration="20"/, "re-stamping picks up source edits");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
