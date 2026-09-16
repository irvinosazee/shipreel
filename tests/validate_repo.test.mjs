import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  checkManifests,
  checkSymlinks,
  checkSkillFrontmatter,
  checkMarkdownLinks,
  checkReferencedScripts,
  checkMusicCues,
  validateRepo,
} from "../scripts/validate-repo.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the repository itself validates cleanly", () => {
  const { problems } = validateRepo(repoRoot);
  assert.deepEqual(problems, []);
});

function withRepo(build, fn) {
  const root = mkdtempSync(path.join(tmpdir(), "brag-validate-"));
  try {
    build(root);
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const write = (root, rel, content) => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), typeof content === "string" ? content : JSON.stringify(content));
};

test("checkManifests catches a bad version and a marketplace name mismatch", () => {
  withRepo(
    (root) => {
      write(root, ".claude-plugin/plugin.json", { name: "brag", version: "0.3", description: "x" });
      write(root, ".claude-plugin/marketplace.json", { name: "brag", owner: { name: "a" }, plugins: [{ name: "bragg", source: "./" }] });
    },
    (root) => {
      const problems = checkManifests(root);
      assert.equal(problems.length, 2);
      assert.match(problems.join("\n"), /version "0\.3"/);
      assert.match(problems.join("\n"), /"bragg"/);
    },
  );
});

test("checkSymlinks catches a missing or copied discovery path", () => {
  withRepo(
    (root) => {
      mkdirSync(path.join(root, "skills/brag"), { recursive: true });
      mkdirSync(path.join(root, ".claude/skills"), { recursive: true });
      symlinkSync("../../skills/brag", path.join(root, ".claude/skills/brag"));
      mkdirSync(path.join(root, ".agents/skills/brag"), { recursive: true });
    },
    (root) => {
      const problems = checkSymlinks(root);
      assert.equal(problems.length, 2);
      assert.match(problems.join("\n"), /\.agents\/skills\/brag is not a symlink/);
      assert.match(problems.join("\n"), /\.opencode\/skills\/brag is missing/);
    },
  );
});

test("checkSkillFrontmatter requires name and description", () => {
  withRepo(
    (root) => write(root, "skills/brag/SKILL.md", "---\nname: brag\n---\n# brag"),
    (root) => assert.deepEqual(checkSkillFrontmatter(root), ["skills/brag/SKILL.md frontmatter is missing description"]),
  );
});

test("checkMarkdownLinks reports broken relative links and ignores URLs and anchors", () => {
  withRepo(
    (root) => {
      write(root, "README.md", "[ok](docs/a.md) [web](https://x.dev) [anchor](#top) [bad](docs/missing.md) `[code](nope.md)`");
      write(root, "docs/a.md", "[up](../README.md#install) [img](assets/gone.png)");
    },
    (root) => {
      assert.deepEqual(checkMarkdownLinks(root, ["README.md", "docs/a.md"]), [
        "README.md links to missing docs/missing.md",
        "docs/a.md links to missing docs/assets/gone.png",
      ]);
    },
  );
});

test("checkReferencedScripts finds <skill-root>/scripts references that do not exist", () => {
  withRepo(
    (root) => {
      write(root, "skills/brag/SKILL.md", "run `node <skill-root>/scripts/real.mjs` then `<skill-root>/scripts/ghost.mjs`");
      write(root, "skills/brag/scripts/real.mjs", "");
    },
    (root) => assert.deepEqual(checkReferencedScripts(root), ["skills/brag/SKILL.md references missing scripts/ghost.mjs"]),
  );
});

test("checkMusicCues requires both cue files per track", () => {
  withRepo(
    (root) => {
      write(root, "skills/brag/assets/music/a.mp3", "");
      write(root, "skills/brag/assets/music/cues/a.music-cues.json", "{}");
    },
    (root) => assert.deepEqual(checkMusicCues(root), ["music track a.mp3 is missing cues/a.music-cues.md"]),
  );
});
