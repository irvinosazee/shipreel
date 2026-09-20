import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { gitStory, storyLine } from "../skills/shipreel/scripts/git_story.mjs";

function repo() {
  const dir = mkdtempSync(path.join(tmpdir(), "shipreel-git-"));
  const git = (args, env = {}) => execFileSync("git", args, { cwd: dir, env: { ...process.env, ...env }, encoding: "utf8" });
  git(["init", "-q", "-b", "main"]);
  const commit = (message, file, date, author = "Ada <ada@example.com>") => {
    writeFileSync(path.join(dir, file), `${message}\n`);
    git(["add", file]);
    const [name, email] = author.match(/^(.*) <(.*)>$/).slice(1);
    git(["commit", "-q", "-m", message], {
      GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date,
      GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email,
    });
  };
  commit("Initial scaffold", "a.txt", "2026-09-01T10:00:00Z");
  git(["tag", "v1.0"]);
  commit("Add swipe matching", "b.txt", "2026-09-02T10:00:00Z");
  commit("Fix hay filter", "c.txt", "2026-09-03T12:00:00Z", "Grace <grace@example.com>");
  commit("Merge pull request #4 from ada/match", "d.txt", "2026-09-04T09:00:00Z");
  return { dir, git };
}

test("gitStory summarizes the whole history", () => {
  const { dir } = repo();
  try {
    const story = gitStory(dir);
    assert.equal(story.commits, 4);
    assert.equal(story.contributors, 2);
    assert.equal(story.days, 4, "calendar days from first to last commit, inclusive");
    assert.equal(story.firstDate, "2026-09-01");
    assert.equal(story.lastDate, "2026-09-04");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("gitStory --since a tag gives release-note material without merge noise", () => {
  const { dir } = repo();
  try {
    const story = gitStory(dir, { since: "v1.0" });
    assert.equal(story.commits, 3);
    assert.equal(story.range, "v1.0..HEAD");
    assert.deepEqual(story.highlights, ["Add swipe matching", "Fix hay filter"], "merge commits are left out of highlights");
    assert.ok(story.filesChanged >= 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("gitStory --days counts back from the latest commit, not the wall clock", () => {
  const { dir } = repo();
  try {
    const story = gitStory(dir, { days: 2 });
    assert.equal(story.commits, 2, "commits on 2026-09-03 and 2026-09-04");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("storyLine is the build-story card copy", () => {
  assert.equal(storyLine({ days: 3, commits: 142, contributors: 1 }), "3 days · 142 commits · 1 contributor");
  assert.equal(storyLine({ days: 1, commits: 1, contributors: 2 }), "1 day · 1 commit · 2 contributors");
});

test("gitStory explains a directory that is not a git repository", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "shipreel-nogit-"));
  try {
    assert.throws(() => gitStory(dir), /not a git repository/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
