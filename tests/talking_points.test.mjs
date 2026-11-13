import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parsePoints, topicWords, validatePoints } from "../skills/shipreel/scripts/talking_points.mjs";

// A repo whose README says it works with Python, built into a campaign at `since`, with one change after.
const projectDir = mkdtempSync(path.join(tmpdir(), "points-"));
const git = (...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...a], { cwd: projectDir }).toString().trim();
writeFileSync(path.join(projectDir, "README.md"), "# tidy\n\nWorks with Python and Node.\n");
git("init", "-q"); git("add", "-A"); git("commit", "-qm", "init");
const since = git("rev-parse", "HEAD");
writeFileSync(path.join(projectDir, "cards.js"), "// wrap\n");
git("add", "-A"); git("commit", "-qm", "Cards: a long slide headline takes a third line (0.4.2)");
test.after(() => rmSync(projectDir, { recursive: true, force: true }));

test("a note splits into points; feedback.md bullets and 'people ...' lines are feedback", () => {
  const points = parsePoints("Slide headlines no longer get cut.\nPeople say the desk is great", "- people keep asking if it works for Python\n");
  assert.deepEqual(points.map((p) => p.kind), ["change", "feedback", "feedback"]);
  assert.equal(points[0].text, "Slide headlines no longer get cut.");
  assert.equal(points[2].text, "people keep asking if it works for Python");
});

test("topic words drop filler, fold plurals, keep version strings", () => {
  assert.deepEqual(topicWords("The slide headlines in 0.4.2 are no longer cut"), ["slide", "headline", "0.4.2", "cut"]);
});

test("a change backed by a commit since the campaign is backed, with the commit as evidence", () => {
  const [p] = validatePoints(parsePoints("Slide headlines no longer get cut."), { projectDir, since, claims: [] });
  assert.equal(p.backed, true);
  assert.equal(p.evidence[0].kind, "commit");
  assert.match(p.evidence[0].line, /slide headline/);
});

test("a version string alone is enough to find its commit", () => {
  const [p] = validatePoints(parsePoints("0.4.2 is out."), { projectDir, since, claims: [] });
  assert.equal(p.backed, true);
});

test("a point nothing in the repo supports is unbacked and carries no evidence", () => {
  const [p] = validatePoints(parsePoints("Now 10x faster than every competitor."), { projectDir, since, claims: [] });
  assert.equal(p.backed, false);
  assert.deepEqual(p.evidence, []);
});

test("feedback is backed by the answer: Python support found in the README", () => {
  const [p] = validatePoints(parsePoints("", "- people keep asking if it works for Python"), { projectDir, since, claims: [] });
  assert.equal(p.kind, "feedback");
  assert.equal(p.backed, true);
  assert.equal(p.evidence[0].kind, "file");
  assert.equal(p.evidence[0].ref, "README.md:3");
});

test("history before the campaign's commit does not back a point", () => {
  const [p] = validatePoints(parsePoints("Slide headlines no longer get cut."), { projectDir, since: git("rev-parse", "HEAD"), claims: [] });
  assert.equal(p.evidence.some((e) => e.kind === "commit"), false);
});

test("a verified claim backs a point; outside git, commits are simply not evidence", () => {
  const claims = [{ text: "every caption one click to copy", source: "README.md", quote: "Works with Python" }];
  const [p] = validatePoints(parsePoints("Every caption is one click to copy."), { projectDir, since, claims });
  assert.equal(p.evidence[0].kind, "claim");
  const outside = mkdtempSync(path.join(tmpdir(), "points-nogit-"));
  try {
    const [q] = validatePoints(parsePoints("Slide headlines no longer get cut."), { projectDir: outside, since: null, claims: [] });
    assert.equal(q.backed, false);
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});
