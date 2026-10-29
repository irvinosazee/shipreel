import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { splitPost, xThread, linkedinPost, productHuntCopy, embedSnippets, creditsFor, buildLaunchKit } from "../skills/shipreel/scripts/launch_kit.mjs";

test("splitPost keeps posts under the limit, breaking at sentences and then words", () => {
  assert.deepEqual(splitPost("short one.", 280), ["short one."]);
  const long = `${"This sentence is here to fill space. ".repeat(12).trim()}`;
  const posts = splitPost(long, 100);
  assert.ok(posts.length > 1);
  for (const post of posts) assert.ok(post.length <= 100, post);
  assert.equal(posts.join(" ").replace(/\s+/g, " "), long);
  const unbroken = splitPost("word ".repeat(100).trim(), 50);
  for (const post of unbroken) assert.ok(post.length <= 50);
});

test("xThread opens with the caption, lists highlights, and ends with the link", () => {
  const thread = xThread({ caption: "We made a launch video tool. Then used it on itself.", highlights: ["vertical exports", "karaoke captions"], url: "https://shipreel.dev" });
  assert.equal(thread[0], "We made a launch video tool. Then used it on itself.");
  assert.match(thread[1], /• vertical exports\n• karaoke captions/);
  assert.match(thread.at(-1), /https:\/\/shipreel\.dev/);
  for (const post of thread) assert.ok(post.length <= 280);
  assert.equal(xThread({ caption: "Just this." }).length, 1);
});

test("linkedinPost and productHuntCopy respect each platform's shape", () => {
  const post = linkedinPost({ caption: "We made a thing.", highlights: ["one", "two"], url: "https://x.dev" });
  assert.equal(post, "We made a thing.\n\n→ one\n→ two\n\nhttps://x.dev");
  const ph = productHuntCopy({ title: "/shipreel", caption: "A skill that turns your project into a twenty-second launch video with music and captions. Then we used it on itself.", highlights: ["vertical exports"] });
  assert.equal(ph.name, "/shipreel");
  assert.ok(ph.tagline.length <= 60, ph.tagline);
  assert.doesNotMatch(ph.tagline, /\s$/);
  assert.ok(ph.description.length <= 260);
});

test("embedSnippets writes a README image link and an autoplaying muted HTML video", () => {
  const { markdown, html } = embedSnippets({ video: "docs/shipreel.mp4", poster: "docs/shipreel.jpg", title: "shipreel <demo>" });
  assert.equal(markdown, "[![shipreel <demo>](docs/shipreel.jpg)](docs/shipreel.mp4)");
  assert.match(html, /<video src="docs\/shipreel\.mp4" poster="docs\/shipreel\.jpg" autoplay muted loop playsinline controls preload="metadata"/);
  assert.match(html, /aria-label="shipreel &lt;demo&gt;"/);
});

test("creditsFor names bundled music and Kenney SFX once each", () => {
  const html = [
    '<audio id="m" src="assets/music/happy-beats-business-moves-vol-10-by-ende-dot-app.mp3">',
    '<audio id="a" src="assets/sfx/impact/impactSoft_medium_001.ogg">',
    '<audio id="b" src="assets/sfx/impact/impactSoft_medium_001.ogg">',
    '<audio id="c" src="assets/sfx/ui/click2.ogg">',
  ].join("\n");
  const credits = creditsFor(html);
  assert.match(credits, /Happy Beats & Business Moves Vol\. 10" by Sascha Ende — ende\.app, CC BY 4\.0/);
  assert.match(credits, /2 sound effects.*Kenney/);
  assert.match(credits, /Hyperframes/);
  assert.equal(creditsFor("").includes("Music"), false);
});

function makeVideo(file, { size = "1920x1080", seconds = 4 } = {}) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `testsrc2=size=${size}:rate=30:duration=${seconds}`, "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`, "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", file]);
}

test("buildLaunchKit assembles videos, images, copy, embeds, and credits into one folder", () => {
  const out = mkdtempSync(path.join(tmpdir(), "shipreel-kit-"));
  try {
    makeVideo(path.join(out, "shipreel.mp4"));
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", "1", "-i", path.join(out, "shipreel.mp4"), "-frames:v", "1", path.join(out, "shipreel.jpg")]);
    mkdirSync(path.join(out, "exports"));
    makeVideo(path.join(out, "exports", "shipreel-tiktok.mp4"), { size: "1080x1920", seconds: 2 });
    writeFileSync(path.join(out, "share-copy.txt"), "We built a thing. It makes videos.\n");
    writeFileSync(path.join(out, "share-copy-variants.md"), "# Variants\n\n## X\nthe x version of the caption\n");
    writeFileSync(path.join(out, "scenes.json"), JSON.stringify([{ name: "Hook", start: 0, end: 2, role: "hook", settled: 1 }, { name: "Payoff", start: 2, end: 4, role: "payoff", settled: 3 }]));
    mkdirSync(path.join(out, "composition"));
    writeFileSync(path.join(out, "composition", "index.html"), '<audio id="m" src="assets/music/happy-beats-business-moves-vol-1-by-ende-dot-app.mp3"></audio>');

    mkdirSync(path.join(out, "cards"));
    writeFileSync(path.join(out, "cards", "og.png"), "png");
    writeFileSync(path.join(out, "cards", "linkedin-carousel.pdf"), "%PDF");
    writeFileSync(path.join(out, "cards", "cards.json"), JSON.stringify([{ file: "og.png", target: "og", size: [1200, 630] }]));

    const manifest = buildLaunchKit(out, { title: "thing", url: "https://thing.dev", highlights: ["makes videos"], zip: true });
    const kit = path.join(out, "launch-kit");
    for (const file of [
      "videos/shipreel.mp4", "videos/shipreel-tiktok.mp4", "images/poster.jpg", "images/og.jpg", "images/youtube.jpg",
      "images/producthunt-1.jpg", "images/producthunt-2.jpg", "copy/share-copy.txt", "copy/x-thread.txt",
      "copy/linkedin.txt", "copy/producthunt.txt", "embed/readme-snippet.md", "embed/video.html", "credits.txt", "README.md",
    ]) assert.ok(existsSync(path.join(kit, file)), file);
    assert.match(readFileSync(path.join(kit, "copy", "x-thread.txt"), "utf8"), /^1\/3\nthe x version of the caption/);
    assert.match(readFileSync(path.join(kit, "credits.txt"), "utf8"), /Vol\. 1\b/);
    const size = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", path.join(kit, "images", "producthunt-1.jpg")], { encoding: "utf8" }).trim();
    assert.equal(size, "1270,760");
    assert.ok(existsSync(path.join(out, "launch-kit.zip")));
    assert.ok(manifest.files.length >= 15);
    assert.ok(existsSync(path.join(kit, "images", "cards", "og.png")), "launch cards ride along");
    assert.ok(existsSync(path.join(kit, "images", "cards", "linkedin-carousel.pdf")));
    assert.equal(manifest.copy.ok, true, JSON.stringify(manifest.copy.files));
    assert.deepEqual(manifest.copy.files.map((f) => f.file).sort(), ["linkedin.txt", "producthunt.txt", "share-copy.txt", "x-thread.txt"]);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
