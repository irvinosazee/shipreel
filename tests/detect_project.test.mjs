import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { detectProject, PROJECT_TYPES } from "../skills/brag/scripts/detect_project.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fixture(files) {
  const root = mkdtempSync(path.join(tmpdir(), "brag-detect-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, typeof content === "string" ? content : JSON.stringify(content));
  }
  return root;
}

function withFixture(files, fn) {
  const root = fixture(files);
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("bundled examples are landing pages", () => {
  for (const slug of ["horse-tinder", "taxi-for-taxis"]) {
    const result = detectProject(path.join(repoRoot, "examples", slug));
    assert.equal(result.type, "landing-page", slug);
    assert.ok(result.inspect.includes("index.html"));
  }
});

test("Next.js app is a web app with route entry points", () => {
  withFixture(
    {
      "package.json": { dependencies: { next: "15.0.0", react: "19.0.0" } },
      "app/page.tsx": "export default function Page() {}",
      "app/dashboard/page.tsx": "",
    },
    (root) => {
      const result = detectProject(root);
      assert.equal(result.type, "web-app");
      assert.equal(result.framework, "next");
      assert.ok(result.inspect.some((p) => p.startsWith("app/")));
    },
  );
});

test("package with bin and commander is a CLI", () => {
  withFixture(
    {
      "package.json": { name: "zap", bin: { zap: "bin/zap.js" }, dependencies: { commander: "12" } },
      "bin/zap.js": "#!/usr/bin/env node",
    },
    (root) => {
      const result = detectProject(root);
      assert.equal(result.type, "cli");
      assert.ok(result.inspect.includes("bin/zap.js"));
    },
  );
});

test("Rust crate with clap is a CLI", () => {
  withFixture(
    { "Cargo.toml": '[package]\nname = "grep2"\n[dependencies]\nclap = "4"\n', "src/main.rs": "fn main() {}" },
    (root) => assert.equal(detectProject(root).type, "cli"),
  );
});

test("package with exports and no app framework is a library", () => {
  withFixture(
    {
      "package.json": { name: "tiny-date", exports: "./dist/index.js", main: "dist/index.js" },
      "src/index.ts": "export const x = 1;",
      "README.md": "# tiny-date",
    },
    (root) => assert.equal(detectProject(root).type, "library"),
  );
});

test("Hono and FastAPI services are APIs", () => {
  withFixture({ "package.json": { dependencies: { hono: "4" } }, "src/index.ts": "" }, (root) =>
    assert.equal(detectProject(root).type, "api"),
  );
  withFixture({ "requirements.txt": "fastapi==0.110\nuvicorn\n", "main.py": "" }, (root) =>
    assert.equal(detectProject(root).type, "api"),
  );
});

test("Expo and Flutter projects are mobile", () => {
  withFixture({ "package.json": { dependencies: { expo: "51", "react-native": "0.74" } } }, (root) =>
    assert.equal(detectProject(root).type, "mobile"),
  );
  withFixture({ "pubspec.yaml": "name: app\ndependencies:\n  flutter:\n    sdk: flutter\n" }, (root) =>
    assert.equal(detectProject(root).type, "mobile"),
  );
});

test("Phaser and Godot projects are games", () => {
  withFixture({ "package.json": { dependencies: { phaser: "3" } }, "index.html": "<canvas>" }, (root) =>
    assert.equal(detectProject(root).type, "game"),
  );
  withFixture({ "project.godot": "[application]" }, (root) => assert.equal(detectProject(root).type, "game"));
});

test("notebooks and ML deps are data/ML", () => {
  withFixture(
    { "train.ipynb": "{}", "requirements.txt": "torch\npandas\n" },
    (root) => assert.equal(detectProject(root).type, "data-ml"),
  );
});

test("node_modules and build output never influence detection", () => {
  withFixture(
    {
      "index.html": "<h1>Hi</h1>",
      "node_modules/phaser/package.json": { name: "phaser" },
      "dist/app/page.tsx": "",
    },
    (root) => assert.equal(detectProject(root).type, "landing-page"),
  );
});

test("empty directory is unknown with low confidence", () => {
  withFixture({ ".keep": "" }, (root) => {
    const result = detectProject(root);
    assert.equal(result.type, "unknown");
    assert.equal(result.confidence, "low");
  });
});

test("every result names a known type and explains itself", () => {
  withFixture({ "package.json": { dependencies: { express: "4", react: "18" } }, "src/App.jsx": "" }, (root) => {
    const result = detectProject(root);
    assert.ok(PROJECT_TYPES.includes(result.type));
    assert.ok(result.signals.length > 0);
    assert.ok(Array.isArray(result.alsoLooksLike));
  });
});

test("Express server with a main entry is an API, not a library", () => {
  withFixture(
    {
      "package.json": { name: "crud", main: "index.js", dependencies: { express: "4", mongoose: "8" } },
      "server.js": "",
      "routes/users.js": "",
      "controllers/users.js": "",
      "Readme.md": "# crud",
    },
    (root) => {
      const result = detectProject(root);
      assert.equal(result.type, "api");
      assert.ok(result.inspect.includes("Readme.md"));
      assert.ok(result.inspect.includes("routes/users.js"));
    },
  );
});

test("monorepo apps are detected and inspect paths are prefixed", () => {
  withFixture(
    {
      "package.json": { private: true, workspaces: ["apps/*", "packages/*"] },
      "apps/web/package.json": { dependencies: { next: "15", react: "19" } },
      "apps/web/app/page.tsx": "",
      "apps/api/package.json": { dependencies: { hono: "4" } },
      "packages/ui/package.json": { name: "@acme/ui", exports: "./index.ts" },
    },
    (root) => {
      const result = detectProject(root);
      assert.equal(result.type, "web-app");
      assert.equal(result.framework, "next");
      assert.ok(result.alsoLooksLike.includes("api"));
      assert.ok(result.inspect.includes("apps/web/app/page.tsx"));
      assert.deepEqual(
        result.subprojects.map((s) => [s.path, s.type]),
        [["apps/api", "api"], ["apps/web", "web-app"], ["packages/ui", "library"]],
      );
    },
  );
});

test("frontend/backend split repo without a root manifest", () => {
  withFixture(
    {
      "frontend/package.json": { dependencies: { react: "18", vite: "5" } },
      "frontend/index.html": "",
      "frontend/src/App.jsx": "",
      "backend/package.json": { dependencies: { express: "4" } },
      "backend/server.js": "",
    },
    (root) => {
      const result = detectProject(root);
      assert.equal(result.type, "web-app");
      assert.equal(result.subprojects.length, 2);
    },
  );
});

test("files inside subprojects are not double counted at the root", () => {
  withFixture(
    {
      "package.json": { private: true, workspaces: ["apps/*"] },
      "apps/ml/requirements.txt": "pandas\n",
      "apps/ml/explore.ipynb": "{}",
      "apps/site/index.html": "",
    },
    (root) => {
      const result = detectProject(root);
      assert.equal(result.signals.filter((s) => /notebook/.test(s)).length, 1);
    },
  );
});

test("web-app inspect list puts user-facing pages before API and admin routes", () => {
  withFixture(
    {
      "package.json": { dependencies: { next: "15" } },
      "app/api/users/route.ts": "",
      "app/admin/page.tsx": "",
      "app/dashboard/page.tsx": "",
      "app/page.tsx": "",
    },
    (root) => {
      const { inspect } = detectProject(root);
      assert.deepEqual(inspect.slice(0, 4), ["app/page.tsx", "app/dashboard/page.tsx", "app/admin/page.tsx", "app/api/users/route.ts"]);
    },
  );
});

test("Elysia services are APIs", () => {
  withFixture({ "package.json": { module: "src/index.ts", dependencies: { elysia: "1" } }, "src/index.ts": "" }, (root) =>
    assert.equal(detectProject(root).type, "api"),
  );
});
