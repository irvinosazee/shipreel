import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { cleanSubject, pickHighlights, notesHighlights, previousTag, projectInfo, releaseContent, tagline } from "../skills/brag/scripts/release_video.mjs";

test("cleanSubject reads conventional commits and strips scopes, PR refs, and trailing periods", () => {
  assert.deepEqual(cleanSubject("feat(cli): add vertical exports (#42)"), { kind: "feat", breaking: false, text: "add vertical exports" });
  assert.deepEqual(cleanSubject("fix!: stop dropping audio."), { kind: "fix", breaking: true, text: "stop dropping audio" });
  assert.equal(cleanSubject("Add footage capture (B10)").text, "Add footage capture");
  assert.deepEqual(cleanSubject("Add karaoke captions"), { kind: null, breaking: false, text: "Add karaoke captions" });
});

test("pickHighlights prefers features, then fixes, skips chores, and caps length", () => {
  const subjects = [
    "chore: bump deps",
    "fix: poster not baked on 60fps renders",
    "docs: typo",
    "feat: burned-in karaoke captions",
    "Merge pull request #9 from x/y",
    "feat(export): per-platform files for tiktok, reels, shorts, x, linkedin, youtube, and discord all at once",
    "ci: cache ffmpeg",
    "perf: render 2x faster",
    "v1.2.0",
  ];
  const picked = pickHighlights(subjects, 3);
  assert.equal(picked.length, 3);
  assert.equal(picked[0], "burned-in karaoke captions");
  assert.match(picked[1], /^per-platform files for tiktok, reels, shorts, x, linkedin, youtube…$/);
  assert.equal(picked[2], "poster not baked on 60fps renders");
  assert.deepEqual(pickHighlights(["chore: bump deps", "docs: readme"], 3), ["bump deps", "readme"], "chores are the fallback when nothing else changed");
});

test("notesHighlights reads bullets from release notes, including GitHub's generated format", () => {
  const notes = [
    "## What's Changed",
    "* feat: vertical exports by @ada in https://github.com/o/r/pull/12",
    "* **Karaoke captions** with [word timing](https://x.dev) (#13)",
    "- fix: silence detection",
    "",
    "**Full Changelog**: https://github.com/o/r/compare/v1...v2",
  ].join("\n");
  assert.deepEqual(notesHighlights(notes), ["vertical exports", "Karaoke captions with word timing", "silence detection"]);
});

test("projectInfo names a private root package after its README heading", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "brag-info-"));
  try {
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "thing-repo", private: true }));
    writeFileSync(path.join(dir, "README.md"), "# /thing\n\n**You built it.** Now ship it.\n");
    const info = projectInfo(dir);
    assert.equal(info.name, "/thing");
    assert.equal(info.description, "You built it. Now ship it.");
    assert.equal(info.install, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("projectInfo joins a wrapped README paragraph, and tagline keeps a short hook with its follow-up", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "brag-info-"));
  try {
    writeFileSync(path.join(dir, "README.md"), "# HeartRank\n\n**Who does X actually love?** A live league table where anyone can pay to\nsend Hearts to a handle. Nothing is\nwithdrawable.\n\n## Run it\n");
    const info = projectInfo(dir);
    assert.equal(info.description, "Who does X actually love? A live league table where anyone can pay to send Hearts to a handle. Nothing is withdrawable.");
    assert.equal(info.tagline, "Who does X actually love? A live league table where anyone can pay to send Hearts to a handle.");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(tagline("A tool that turns every project you have ever built into a launch video. It is fast."), "A tool that turns every project you have ever built into a launch video.");
  assert.equal(tagline(null), null);
});

function repo() {
  const dir = mkdtempSync(path.join(tmpdir(), "brag-release-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, env: { ...process.env, GIT_AUTHOR_DATE: "2026-01-01T10:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T10:00:00Z" } });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "a@example.com");
  git("config", "user.name", "A");
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "tinyapp", version: "1.1.0", description: "a tiny app that does one thing" }));
  const commit = (message, file) => {
    writeFileSync(path.join(dir, file), message);
    git("add", "-A");
    git("commit", "-q", "-m", message);
  };
  commit("feat: first", "a.txt");
  git("tag", "v1.0.0");
  commit("feat: dark mode", "b.txt");
  commit("fix: crash on empty input", "c.txt");
  commit("chore: bump", "d.txt");
  git("tag", "v1.1.0");
  return dir;
}

test("previousTag, projectInfo, and releaseContent build a release card from a real git history", () => {
  const dir = repo();
  try {
    assert.equal(previousTag(dir, "v1.1.0"), "v1.0.0");
    assert.equal(previousTag(dir, "v1.0.0"), null);
    const info = projectInfo(dir);
    assert.equal(info.name, "tinyapp");
    assert.equal(info.install, "npm i tinyapp");

    const content = releaseContent(dir, { tag: "v1.1.0" });
    assert.equal(content.kicker, "new release");
    assert.equal(content.title, "tinyapp v1.1.0");
    assert.equal(content.subtitle, "a tiny app that does one thing");
    assert.deepEqual(content.highlights.items, ["dark mode", "crash on empty input"]);
    assert.deepEqual(content.stats.map((s) => [s.value, s.label]), [["3", "commits"], ["3", "files changed"]]);
    assert.equal(content.outro.detail, "npm i tinyapp@1.1.0");
    assert.equal(content.range, "v1.0.0..v1.1.0");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
