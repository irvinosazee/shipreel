import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import jsQR from "jsqr";

import { qrMatrix, qrSvg, buildWatermark, buildEndCard, injectBlock, endCardStart, urlFontPx } from "../skills/brag/scripts/overlays.mjs";
import { findChrome, withPage } from "../skills/brag/scripts/chrome.mjs";

const URL_TEXT = "https://github.com/irvinosazee/brag";

function rasterize(matrix, scale = 6, quiet = 4) {
  const size = (matrix.length + quiet * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  matrix.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (!dark) return;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const i = ((y + quiet) * scale + dy) * size + (x + quiet) * scale + dx;
          data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 0;
        }
      }
    }),
  );
  return { data, size };
}

test("qrMatrix encodes the URL so an independent decoder reads it back", () => {
  const matrix = qrMatrix(URL_TEXT);
  assert.equal(matrix.length, matrix[0].length);
  const { data, size } = rasterize(matrix);
  assert.equal(jsQR(data, size, size)?.data, URL_TEXT);
});

test("qrSvg draws the modules with a quiet zone in the given colors", () => {
  const svg = qrSvg(URL_TEXT, { size: 320, fg: "#1a0f0b", bg: "#fff4ec" });
  const modules = qrMatrix(URL_TEXT).length + 8;
  assert.match(svg, new RegExp(`viewBox="0 0 ${modules} ${modules}"`));
  assert.match(svg, /width="320" height="320"/);
  assert.match(svg, /shape-rendering="crispEdges"/);
  assert.match(svg, /fill="#fff4ec"/);
  assert.match(svg, /<path d="M/);
});

const theme = { font: "Geist", fg: "#fff4ec", bg: "#1a0f0b", accent: "#ff6a3d" };

test("buildEndCard places a timed card with QR, URL, handle, and avatar or initials", () => {
  const withAvatar = buildEndCard({ url: URL_TEXT, handle: "@irvinosazee", avatar: "assets/avatar.png", start: 19, duration: 3.5, rect: { x: 96, y: 900, width: 816, height: 520 }, theme });
  assert.match(withAvatar, /<!-- brag:endcard:start -->/);
  assert.match(withAvatar, /class="clip brag-endcard" data-start="19" data-duration="3.5"/);
  assert.match(withAvatar, /left: 96px; top: 900px; width: 816px; height: 520px/);
  assert.match(withAvatar, /<svg[^>]+viewBox/);
  assert.match(withAvatar, /github\.com\/irvinosazee\/brag/);
  assert.match(withAvatar, /@irvinosazee/);
  assert.match(withAvatar, /<img[^>]+src="assets\/avatar\.png"/);

  const initials = buildEndCard({ url: URL_TEXT, handle: "irvinosazee", start: 0, duration: 2, rect: { x: 0, y: 0, width: 600, height: 400 }, theme });
  assert.doesNotMatch(initials, /<img/);
  assert.match(initials, /class="brag-initials">I</);
  assert.match(initials, /@irvinosazee/, "a handle is shown with its @");
});

test("urlFontPx never goes below the 28px phone minimum", () => {
  assert.equal(urlFontPx("brag.dev", 400), 36, "short URLs keep the default size");
  assert.equal(urlFontPx("github.com/irvinosazee/brag", 380), 28);
});

test("a long URL shrinks the QR code before it shrinks the text", () => {
  const html = buildEndCard({ url: URL_TEXT, handle: "@irvinosazee", start: 19.2, duration: 3.3, rect: { x: 96, y: 1060, width: 816, height: 360 }, theme });
  const qr = Number(html.match(/<svg[^>]+width="(\d+)"/)[1]);
  const px = Number(html.match(/\.brag-url \{ font-size: (\d+)px/)[1]);
  assert.ok(px >= 28, `url ${px}px`);
  assert.ok(qr >= 200 && qr < 280, `qr ${qr}px`);
  assert.ok("github.com/irvinosazee/brag".length * 0.6 * px <= 816 - 64 - 36 - qr, "the URL fits beside the QR code");
});

test("a URL too long for one line wraps only after a slash", () => {
  const html = buildEndCard({ url: "https://example.com/a-very-long-organization-name/an-even-longer-repository-name", handle: "@x", start: 0, duration: 2, rect: { x: 0, y: 0, width: 816, height: 360 }, theme });
  assert.match(html, /example\.com\/<wbr>a-very-long-organization-name\/<wbr>an-even-longer-repository-name/);
  assert.match(html, /\.brag-url \{ font-size: 28px;[^}]*white-space: normal;/);
});

test("a URL that fits stays on one line", () => {
  const html = buildEndCard({ url: URL_TEXT, handle: "@irvinosazee", start: 19.2, duration: 3.3, rect: { x: 96, y: 1060, width: 816, height: 360 }, theme });
  assert.match(html, /\.brag-url \{[^}]*white-space: nowrap;/);
  assert.doesNotMatch(html, /overflow-wrap: anywhere/);
});

test("the watermark ends when an injected end card begins, so the two never overlap", () => {
  const card = buildEndCard({ url: URL_TEXT, handle: "@x", start: 19.2, duration: 3.3, rect: { x: 96, y: 1060, width: 816, height: 360 }, theme });
  const html = injectBlock('<div data-composition-id="main">\n</div>', "endcard", card);
  assert.equal(endCardStart(html), 19.2);
  assert.equal(endCardStart('<div data-composition-id="main"></div>'), null);
  const mark = buildWatermark({ duration: 22.5, until: endCardStart(html), safe: { x: 65, y: 250, width: 864, height: 1190 }, theme });
  assert.match(mark, /data-start="0" data-duration="19.2"/);
});

test("buildWatermark is a small full-length clip inside the safe rectangle", () => {
  const html = buildWatermark({ duration: 22.5, safe: { x: 65, y: 250, width: 864, height: 1190 }, theme });
  assert.match(html, /<!-- brag:watermark:start -->/);
  assert.match(html, /class="clip brag-watermark" data-start="0" data-duration="22.5"/);
  assert.match(html, /made with \/brag/);
  assert.match(html, /left: 65px; top: 1392px;/, "bottom-left corner of the safe rectangle");
});

test("injectBlock inserts after the root and replaces an earlier block of the same name", () => {
  const html = `<div id="root" data-composition-id="main">\n</div>`;
  const once = injectBlock(html, "watermark", "<!-- brag:watermark:start -->\nA\n<!-- brag:watermark:end -->");
  const twice = injectBlock(once, "watermark", "<!-- brag:watermark:start -->\nB\n<!-- brag:watermark:end -->");
  assert.equal((twice.match(/brag:watermark:start/g) ?? []).length, 1);
  assert.match(twice, /\nB\n/);
  const both = injectBlock(twice, "endcard", "<!-- brag:endcard:start -->\nC\n<!-- brag:endcard:end -->");
  assert.match(both, /brag:watermark:start[\s\S]*B[\s\S]*brag:endcard:start|brag:endcard:start[\s\S]*C[\s\S]*brag:watermark:start/);
});

test("the rendered end card QR decodes from a real browser screenshot", { skip: !findChrome() && "Chrome not found" }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "brag-qr-"));
  try {
    const card = buildEndCard({ url: URL_TEXT, handle: "@irvinosazee", start: 0, duration: 5, rect: { x: 40, y: 40, width: 700, height: 460 }, theme });
    const page = `<!doctype html><html><body style="margin:0;width:800px;height:560px;background:#e8501f"><div data-composition-id="main" style="position:relative;width:800px;height:560px">${card}</div></body></html>`;
    const file = path.join(dir, "card.html");
    writeFileSync(file, page);
    const png = await withPage(`file://${file}`, async (session) => {
      await session.send("Emulation.setDeviceMetricsOverride", { width: 800, height: 560, deviceScaleFactor: 1, mobile: false });
      const { data } = await session.send("Page.captureScreenshot", { format: "png" });
      return Buffer.from(data, "base64");
    });
    const pngPath = path.join(dir, "card.png");
    writeFileSync(pngPath, png);
    const rgba = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", pngPath, "-f", "rawvideo", "-pix_fmt", "rgba", "-"], { maxBuffer: 64 * 1024 * 1024 });
    assert.equal(jsQR(new Uint8ClampedArray(rgba), 800, 560)?.data, URL_TEXT);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
