import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { findEmbedTarget, insertVideo, makeEmbedPatch } from "../skills/shipreel/scripts/embed.mjs";

function project(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "shipreel-embed-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

test("insertVideo puts a JSX video right after the first h1, matching its indentation", () => {
  const source = [
    "export default function Home() {",
    "  return (",
    "    <main>",
    '      <h1 className="big">',
    "        Hello",
    "      </h1>",
    "      <p>more</p>",
    "    </main>",
    "  );",
    "}",
  ].join("\n");
  const out = insertVideo(source, "jsx", { src: "/shipreel.mp4", poster: "/shipreel.jpg", title: "demo" });
  const lines = out.split("\n");
  assert.equal(lines[5], "      </h1>");
  assert.match(lines[6], /^      <video src="\/shipreel\.mp4" poster="\/shipreel\.jpg" autoPlay muted loop playsInline controls preload="metadata" aria-label="demo" style=\{\{ width: "100%", height: "auto", borderRadius: 12 \}\} \/>$/);
  assert.equal(lines[7], "      <p>more</p>");
});

test("insertVideo falls back to the start of <main> in HTML, and to after the title in Markdown", () => {
  const html = "<body>\n  <main>\n    <section>hi</section>\n  </main>\n</body>";
  const out = insertVideo(html, "html", { src: "assets/shipreel.mp4", poster: "assets/shipreel.jpg", title: "demo" });
  assert.match(out, /<main>\n    <video src="assets\/shipreel\.mp4" poster="assets\/shipreel\.jpg" autoplay muted loop playsinline controls preload="metadata" aria-label="demo" style="width: 100%; height: auto; border-radius: 12px;"><\/video>\n    <section>/);

  const md = "# thing\n\nSome intro.\n";
  assert.equal(insertVideo(md, "markdown", { src: "shipreel.mp4", poster: "shipreel.jpg", title: "demo" }), "# thing\n\n[![demo](shipreel.jpg)](shipreel.mp4)\n\nSome intro.\n");
  assert.throws(() => insertVideo("<div>nothing</div>", "html", { src: "a", poster: "b", title: "c" }), /no <h1> or <main>/);
});

test("findEmbedTarget follows a Next.js page into the component that holds the h1 and serves media from public/", () => {
  const dir = project({
    "package.json": JSON.stringify({ dependencies: { next: "15.0.0" } }),
    "next.config.ts": "export default {};",
    "app/page.tsx": 'import HomeLive from "@/components/HomeLive";\nexport default function Page() { return <HomeLive />; }\n',
    "components/HomeLive.tsx": 'import Panel from "./Panel";\nexport default function HomeLive() {\n  return (\n    <div>\n      <h1>Who wins?</h1>\n      <Panel />\n    </div>\n  );\n}\n',
    "components/Panel.tsx": "export default function Panel() { return <p />; }\n",
    "public/.gitkeep": "",
  });
  try {
    const target = findEmbedTarget(dir);
    assert.equal(path.relative(dir, target.file), path.join("components", "HomeLive.tsx"));
    assert.equal(target.kind, "jsx");
    assert.equal(path.relative(dir, target.mediaDir), "public");
    assert.equal(target.src, "/shipreel.mp4");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("findEmbedTarget uses a plain index.html with media beside it, and README.md as the last resort", () => {
  const site = project({ "index.html": "<html><body><main><p>x</p></main></body></html>", "assets/.keep": "" });
  const docs = project({ "README.md": "# lib\n\ntext\n", "package.json": "{}" });
  try {
    const html = findEmbedTarget(site);
    assert.equal(path.basename(html.file), "index.html");
    assert.equal(html.kind, "html");
    assert.equal(html.src, "assets/shipreel.mp4");
    const readme = findEmbedTarget(docs);
    assert.equal(readme.kind, "markdown");
    assert.equal(readme.src, "shipreel.mp4");
  } finally {
    rmSync(site, { recursive: true, force: true });
    rmSync(docs, { recursive: true, force: true });
  }
});

test("makeEmbedPatch writes a patch git can apply, and --apply edits the file and copies the media", () => {
  const dir = project({
    "package.json": JSON.stringify({ devDependencies: { vite: "6.0.0" } }),
    "vite.config.js": "export default {};",
    "src/App.jsx": "export default function App() {\n  return (\n    <main>\n      <h1>tiny</h1>\n    </main>\n  );\n}\n",
  });
  const media = mkdtempSync(path.join(tmpdir(), "shipreel-media-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    writeFileSync(path.join(media, "shipreel.mp4"), "video");
    writeFileSync(path.join(media, "shipreel.jpg"), "poster");
    const result = makeEmbedPatch(dir, { video: path.join(media, "shipreel.mp4"), poster: path.join(media, "shipreel.jpg"), patchPath: path.join(media, "embed.patch"), title: "tiny" });
    assert.equal(result.applied, false);
    const patch = readFileSync(result.patch, "utf8");
    assert.match(patch, /^--- a\/src\/App\.jsx\n\+\+\+ b\/src\/App\.jsx/m);
    execFileSync("git", ["apply", "--check", result.patch], { cwd: dir });
    assert.doesNotMatch(readFileSync(path.join(dir, "src", "App.jsx"), "utf8"), /video/, "a patch alone changes nothing");

    const applied = makeEmbedPatch(dir, { video: path.join(media, "shipreel.mp4"), poster: path.join(media, "shipreel.jpg"), patchPath: path.join(media, "embed.patch"), apply: true, title: "tiny" });
    assert.equal(applied.applied, true);
    assert.match(readFileSync(path.join(dir, "src", "App.jsx"), "utf8"), /<video src="\/shipreel\.mp4"/);
    assert.ok(existsSync(path.join(dir, "public", "shipreel.mp4")) && existsSync(path.join(dir, "public", "shipreel.jpg")));
    assert.throws(() => makeEmbedPatch(dir, { video: path.join(media, "shipreel.mp4"), poster: path.join(media, "shipreel.jpg"), patchPath: path.join(media, "again.patch") }), /already embeds shipreel\.mp4/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(media, { recursive: true, force: true });
  }
});
