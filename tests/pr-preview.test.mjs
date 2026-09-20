import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { changedRoutes, commentBody, compareHtml, buildPreview } from "../skills/shipreel/scripts/pr_preview.mjs";
import { startProject } from "../skills/shipreel/scripts/capture.mjs";

test("changedRoutes maps changed files to the pages a reviewer should see", () => {
  assert.deepEqual(changedRoutes(["app/page.tsx", "app/pricing/page.tsx", "app/(marketing)/about/page.tsx"]), ["/", "/pricing", "/about"]);
  assert.deepEqual(changedRoutes(["app/blog/[slug]/page.tsx", "app/api/route.ts"]), ["/"], "dynamic and API routes fall back to the home page");
  assert.deepEqual(changedRoutes(["pages/index.tsx", "pages/docs/intro.mdx", "pages/api/x.ts", "pages/_app.tsx"]), ["/", "/docs/intro"]);
  assert.deepEqual(changedRoutes(["src/pages/changelog.astro", "src/routes/settings/+page.svelte"]), ["/changelog", "/settings"]);
  assert.deepEqual(changedRoutes(["docs/index.html", "about.html", "styles.css"]), ["/docs/", "/about.html", "/"]);
  assert.deepEqual(changedRoutes(["README.md", "package.json"]), [], "no UI change, no preview");
  assert.deepEqual(changedRoutes(["components/Button.tsx"]), ["/"]);
  assert.equal(changedRoutes(["a.html", "b.html", "c.html", "d.html"]).length, 3, "at most three routes");
});

test("commentBody summarizes each route's change and links the clip", () => {
  const body = commentBody({
    routes: [{ route: "/", ssim: 0.91, changed: true }, { route: "/about", ssim: 0.999, changed: false }],
    videoUrl: "https://example.com/run/artifacts",
    gifUrl: "https://raw.example.com/preview.gif",
  });
  assert.match(body, /<!-- shipreel:pr-preview -->/);
  assert.match(body, /!\[before and after\]\(https:\/\/raw\.example\.com\/preview\.gif\)/);
  assert.match(body, /\| `\/` \| changed \| 0\.910 \|/);
  assert.match(body, /\| `\/about` \| no visible change \| 0\.999 \|/);
  assert.match(body, /\[before\/after clip\]\(https:\/\/example\.com\/run\/artifacts\)/);
});

test("compareHtml labels both sides and escapes the route", () => {
  const html = compareHtml({ route: "/<x>", before: "before.png", after: "after.png", size: [1280, 720] });
  assert.match(html, /before<\/span>/);
  assert.match(html, /after<\/span>/);
  assert.match(html, /\/&lt;x&gt;/);
  assert.match(html, /<img src="before\.png"/);
});

test("buildPreview captures base and head, scores the change, and writes a clip under 10s and a GIF", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "shipreel-pr-"));
  const site = (dir, color, title) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "index.html"), `<!doctype html><html><body style="margin:0;background:${color};font:64px sans-serif"><h1 style="margin:80px">${title}</h1></body></html>`);
    writeFileSync(path.join(dir, "about.html"), '<!doctype html><html><body style="margin:0;background:#fff;font:40px sans-serif"><p style="margin:80px">same about page</p></body></html>');
  };
  site(path.join(root, "base"), "#ffffff", "old headline");
  site(path.join(root, "head"), "#ffd9c7", "new headline, new color");
  const base = await startProject(path.join(root, "base"));
  const head = await startProject(path.join(root, "head"));
  try {
    const result = await buildPreview({ baseUrl: base.url, headUrl: head.url, routes: ["/", "/about.html"], outDir: path.join(root, "out"), viewport: [1280, 800] });
    assert.equal(result.routes.length, 2);
    assert.equal(result.routes[0].changed, true);
    assert.equal(result.routes[1].changed, false);
    assert.ok(existsSync(result.video) && existsSync(result.gif));
    const duration = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", result.video], { encoding: "utf8" }));
    assert.ok(duration > 1 && duration <= 10, String(duration));
    assert.match(result.body, /changed/);
  } finally {
    await base.stop();
    await head.stop();
    rmSync(root, { recursive: true, force: true });
  }
});
