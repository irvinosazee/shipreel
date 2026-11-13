/**
 * Talking points for a campaign update, checked against the repository before anything is written.
 *
 * The user says what changed ("0.4.2 fixed the slide headlines") and pastes what people said into
 * feedback.md ("- people keep asking if it works for Python"). Each point must be backed by a commit
 * made since the campaign was built, a claim that still verifies, or a line in the README or docs.
 * An unbacked point is reported and never written into a post. Feedback is backed by its answer:
 * "does it work for Python" needs the repo to say Python.
 *
 *   node <skill-root>/scripts/talking_points.mjs <project-dir> --note "<text>" [--feedback feedback.md] [--since <commit>]
 */

import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifyClaims } from "./claims.mjs";
import { readLog } from "./git_story.mjs";

const FEEDBACK = /^(people|users?|someone|folks|customers?|everyone|devs?|developers)\b/i;
const isVersion = (w) => /^\d+\.\d+(?:\.\d+)?$/.test(w);
// Words that say nothing about the topic, including the way feedback is reported.
const STOP = new Set(
  ("the and for not now get got has had have was were are you your can its our all any but use new now with from that this than then them they their there into onto also just more most very much many some such only even each every one two out off over under about after before again still yet will would could should may might must here what when where which while who why how does did doing done being been isn longer anymore today "
    + "people user users someone folks customer customers everyone dev devs developer developers keep keeps kept ask asks asked asking wonder wondering want wants wanted work works worked say says said saying think thinks great love loves like likes")
    .split(" "),
);

const stem = (w) => (w.endsWith("ies") && w.length > 4 ? `${w.slice(0, -3)}y` : w.endsWith("s") && !w.endsWith("ss") && w.length > 3 ? w.slice(0, -1) : w);

/** The words that carry a point's topic: lowercase, three letters or more, filler dropped, plurals folded, versions kept. */
export function topicWords(text) {
  const out = [];
  for (const token of String(text ?? "").split(/\s+/)) {
    const version = token.replace(/^[^\d]+|[^\d]+$/g, "");
    const words = isVersion(version) ? [version] : token.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !STOP.has(w)).map(stem);
    for (const w of words) if (!out.includes(w)) out.push(w);
  }
  return out;
}

/** The user's note (sentences, lines) and feedback.md (bullets) as points. */
export function parsePoints(note = "", feedbackMd = "") {
  const points = String(note ?? "")
    .split("\n")
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((t) => t.trim())
    .filter(Boolean)
    .map((text) => ({ text, kind: FEEDBACK.test(text) ? "feedback" : "change" }));
  for (const line of String(feedbackMd ?? "").split("\n")) {
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) points.push({ text: bullet[1].trim(), kind: "feedback" });
  }
  return points;
}

const overlap = (a, b) => a.filter((w) => b.includes(w));

/**
 * How strongly two texts' topic words agree: 0 when they are not about the same thing, else the number of
 * words they share. The same version string is enough; otherwise they must share two words, or 40% of a
 * long point's words, so "line" and "instead" alone never tie a headline fix to an unrelated commit.
 */
export function sameTopic(words, other) {
  const shared = overlap(words, other);
  if (shared.some(isVersion)) return shared.length + 1;
  return shared.length >= Math.min(words.length, Math.max(2, Math.ceil(words.length * 0.4))) ? shared.length : 0;
}

function docLines(projectDir) {
  const files = ["README.md"];
  const docs = path.join(projectDir, "docs");
  if (existsSync(docs)) for (const f of readdirSync(docs).sort()) if (f.endsWith(".md")) files.push(path.join("docs", f));
  return files
    .filter((f) => existsSync(path.join(projectDir, f)))
    .flatMap((f) => readFileSync(path.join(projectDir, f), "utf8").split("\n").map((line, i) => ({ ref: `${f}:${i + 1}`, line: line.trim() })))
    .filter((l) => l.line && !l.line.startsWith("```"));
}

function commitsSince(projectDir, since, sinceDate) {
  try {
    return readLog(projectDir, since ? `${since}..HEAD` : null).filter((c) => !c.merge && (!sinceDate || c.date >= sinceDate));
  } catch {
    return []; // not a git repository: commits are simply not evidence
  }
}

/**
 * Each point with whether the repo backs it and the evidence: commits first, then claims, then files.
 * `since` is the commit the campaign was built from; `sinceDate` limits history for campaigns built before commits were recorded.
 */
export function validatePoints(points, { projectDir, since = null, sinceDate = null, claims = [], product = null }) {
  // The product's own name is in nearly every line; it says nothing about which line a point is about.
  const own = new Set(topicWords(product ?? ""));
  const words = (t) => topicWords(t).filter((w) => !own.has(w));
  const commits = commitsSince(projectDir, since, sinceDate);
  const live = claims.filter((c) => c?.text && verifyClaims([c], { projectDir }).verified === 1);
  const lines = docLines(projectDir);
  return points.map((point) => {
    const mine = words(point.text);
    const found = [];
    if (mine.length) {
      for (const c of commits) found.push({ kind: "commit", ref: c.hash.slice(0, 7), line: c.subject, score: sameTopic(mine, words(c.subject)) });
      for (const c of live) found.push({ kind: "claim", ref: c.source ?? "claims.json", line: c.text, score: sameTopic(mine, words(c.text)) });
      for (const l of lines) found.push({ kind: "file", ref: l.ref, line: l.line, score: sameTopic(mine, words(l.line)) });
    }
    // Strongest first; at equal strength commits, then claims, then files (the order they were found in).
    const evidence = found.filter((e) => e.score > 0).sort((a, b) => b.score - a.score).map(({ score, ...e }) => e);
    return { ...point, backed: evidence.length > 0, evidence };
  });
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
  const projectDir = path.resolve(args.find((a, i) => !a.startsWith("--") && !["--note", "--feedback", "--since"].includes(args[i - 1])) ?? ".");
  const feedback = flag("--feedback");
  const result = validatePoints(parsePoints(flag("--note") ?? "", feedback && existsSync(feedback) ? readFileSync(feedback, "utf8") : ""), { projectDir, since: flag("--since") });
  console.log(JSON.stringify(result, null, 2));
}
