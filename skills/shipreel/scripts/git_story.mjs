#!/usr/bin/env node
/**
 * Git-powered stories: build-story stats and release-note material.
 *
 *   node <skill-root>/scripts/git_story.mjs <project-dir>                 # whole history: "3 days · 142 commits · 1 contributor"
 *   node <skill-root>/scripts/git_story.mjs <project-dir> --since v1.2    # a release video: what changed since a tag
 *   node <skill-root>/scripts/git_story.mjs <project-dir> --days 7        # a weekly build-in-public recap
 *
 * --days counts back from the latest commit, so the result does not depend on when it runs.
 * Highlights are commit subjects without merge commits, oldest first.
 */

import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
// ASCII unit separator: never appears in names, emails, or commit subjects.
const SEP = String.fromCharCode(31);

function git(dir, args) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

const day = (iso) => iso.slice(0, 10);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function readLog(dir, range) {
  const format = ["%H", "%ae", "%aI", "%P", "%s"].join("%x1f");
  return git(dir, ["log", "--reverse", `--format=${format}`, ...(range ? [range] : [])])
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, email, date, parents, subject] = line.split(SEP);
      return { hash, email, date: new Date(date).toISOString(), merge: parents.trim().split(" ").length > 1, subject };
    });
}

export function gitStory(dir, { since, days } = {}) {
  try {
    git(dir, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    throw new Error(`${dir} is not a git repository.`);
  }

  let commits = readLog(dir, since ? `${since}..HEAD` : null);
  let range = since ? `${since}..HEAD` : null;
  if (days && commits.length) {
    const last = new Date(commits.at(-1).date);
    const cutoff = Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate() - (days - 1));
    commits = commits.filter((c) => Date.parse(c.date) >= cutoff);
    range = commits.length ? `${commits[0].hash}^..HEAD` : null;
  }
  if (commits.length === 0) {
    return { range, commits: 0, contributors: 0, days: 0, firstDate: null, lastDate: null, filesChanged: 0, insertions: 0, deletions: 0, highlights: [] };
  }

  let from = EMPTY_TREE;
  if (since) from = since;
  else if (days) from = `${commits[0].hash}^`;
  let stat;
  try {
    stat = git(dir, ["diff", "--shortstat", from, "HEAD"]);
  } catch {
    // The first commit in range has no parent: measure from the empty tree.
    stat = git(dir, ["diff", "--shortstat", EMPTY_TREE, "HEAD"]);
  }
  const number = (pattern) => Number(stat.match(pattern)?.[1] ?? 0);

  const first = day(commits[0].date);
  const last = day(commits.at(-1).date);
  return {
    range,
    commits: commits.length,
    contributors: new Set(commits.map((c) => c.email.toLowerCase())).size,
    days: Math.round((Date.parse(last) - Date.parse(first)) / 86_400_000) + 1,
    firstDate: first,
    lastDate: last,
    filesChanged: number(/(\d+) files? changed/),
    insertions: number(/(\d+) insertions?/),
    deletions: number(/(\d+) deletions?/),
    highlights: commits.filter((c) => !c.merge && !/^Merge (pull request|branch)/.test(c.subject)).map((c) => c.subject),
  };
}

export function storyLine({ days, commits, contributors }) {
  return [plural(days, "day"), plural(commits, "commit"), plural(contributors, "contributor")].join(" · ");
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const [dir = ".", ...rest] = process.argv.slice(2);
  const flag = (name) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined);
  try {
    const story = gitStory(dir, { since: flag("--since"), days: flag("--days") ? Number(flag("--days")) : undefined });
    console.log(JSON.stringify({ ...story, line: storyLine(story) }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
