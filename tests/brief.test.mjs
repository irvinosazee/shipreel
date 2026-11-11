import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ANGLES, applyBriefMarkdown, briefFacts, briefMarkdown, initBrief, prefillBrief, readmeSignals, validateBrief } from "../skills/shipreel/scripts/brief.mjs";

const dossier = {
  project: { name: "tidy", description: "Inbox zero, finally. It sorts your mail by sender.", tagline: "Inbox zero, finally.", install: "npx tidy", type: "cli", url: "https://github.com/me/tidy" },
  highlights: ["Snooze: newsletters wait until Friday"],
  brand: { tone: "polished" },
  claims: [{ text: "SORTS 10,000 EMAILS A MINUTE", verified: true }, { text: "made up", verified: false }],
  story: { commits: 40, days: 6, line: "6 days · 40 commits · 1 contributor" },
};

function project(readme) {
  const dir = mkdtempSync(path.join(tmpdir(), "shipreel-brief-"));
  writeFileSync(path.join(dir, "README.md"), readme);
  writeFileSync(path.join(dir, "LICENSE"), "MIT License\n\nCopyright (c) 2026");
  return dir;
}

test("readmeSignals reads who it is for, what it replaces, and the live site", () => {
  const s = readmeSignals("# tidy\n\nBuilt for founders who drown in email. No more inbox triage at midnight! Use it instead of filters, rules, and folders.\n\nLive at https://tidy.app/today. Badge: https://img.shields.io/x\n");
  assert.equal(s.audience, "founders");
  assert.equal(s.pain, "inbox triage at midnight");
  assert.equal(s.workaround, "filters, rules, and folders");
  assert.equal(s.site, "https://tidy.app/today");
});

test("prefillBrief fills every field from the dossier and says where each came from", () => {
  const dir = project("# tidy\n\nBuilt for founders who drown in email. No more inbox triage at midnight!\n");
  try {
    const b = prefillBrief(dossier, { projectDir: dir });
    assert.equal(b.audience.value, "founders");
    assert.equal(b.audience.source, "readme");
    assert.equal(b.pain.value, "They are stuck with inbox triage at midnight.");
    assert.equal(b.promise.value, "Inbox zero, finally.");
    assert.ok(b.proof.value.includes("Sorts 10,000 emails a minute"), "shouted video copy reads as a sentence");
    assert.ok(!b.proof.value.includes("made up"), "unverified claims are never proof");
    assert.ok(b.proof.value.includes("6 days · 40 commits · 1 contributor"));
    assert.deepEqual(b.objections.value.map((o) => o.q), ["Is it free?", "Is it hard to set up?", "Is it maintained?"]);
    assert.equal(b.objections.value[0].a, "Yes. It is open source under MIT.");
    assert.equal(b.cta.value, "Try it: npx tidy");
    assert.equal(b.tone.value, "premium", "a polished brand reads as premium");
    assert.ok(b.angles.value.includes("build-story"), "built in under two weeks");
    for (const a of b.angles.value) assert.ok(ANGLES[a], a);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("brief.md round-trips, and the user's edits win", () => {
  const dir = project("# tidy\n\nNothing to see.\n");
  try {
    const b = prefillBrief(dossier, { projectDir: dir });
    assert.deepEqual(applyBriefMarkdown(b, briefMarkdown(b)), b, "unchanged markdown changes nothing");
    const edited = briefMarkdown(b)
      .replace(/## Who it is for\n<!--.*-->\n.*\n/, "## Who it is for\n<!-- x -->\nsolo founders with 3 inboxes\n")
      .replace(/## What hurts today\n<!--.*-->\n.*\n/, "## What hurts today\nTwo hours a day sorting mail.\n")
      .replace("## Tone (one of: bold, playful, plain, premium, deadpan)\n<!-- pre-filled from: brand kit -->\npremium", "## Tone (one of: bold, playful, plain, premium, deadpan)\nBold");
    const after = applyBriefMarkdown(b, edited);
    assert.deepEqual(after.audience, { value: "solo founders with 3 inboxes", source: "you" });
    assert.deepEqual(after.pain, { value: "Two hours a day sorting mail.", source: "you" });
    assert.equal(after.tone.value, "bold");
    assert.equal(after.promise.source, "readme", "untouched fields keep their source");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validateBrief: proof must be verified, angles known, and nothing deceptive", () => {
  const dir = project("# tidy\n");
  try {
    const b = prefillBrief(dossier, { projectDir: dir });
    const facts = briefFacts(dossier);
    assert.deepEqual(validateBrief(b, { facts }).errors, []);
    const bad = structuredClone(b);
    bad.proof.value.push("Loved by thousands of developers");
    bad.angles.value.push("dance-trend");
    bad.cta.value = "Only 3 spots left, act now before it is gone";
    const codes = validateBrief(bad, { facts }).errors.map((e) => e.code).sort();
    assert.deepEqual(codes, ["angle", "deceptive", "deceptive", "deceptive", "unverified-proof"], "scarcity, urgency and invented social proof are each caught");
    const empty = structuredClone(b);
    empty.audience.value = "";
    assert.deepEqual(validateBrief(empty, { facts }).errors.map((e) => e.field), ["audience"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("initBrief writes brief.json and brief.md, and keeps an existing brief.md's edits", () => {
  const dir = project("# tidy\n\nInbox zero, finally.\n");
  try {
    const out = path.join(dir, "out");
    const first = initBrief(dir, { outDir: "out" });
    assert.ok(readFileSync(first.files.md, "utf8").startsWith("# Marketing brief: "));
    writeFileSync(first.files.md, readFileSync(first.files.md, "utf8").replace(/## What hurts today\n<!--.*-->\n.*\n/, "## What hurts today\nMail eats the morning.\n"));
    const second = initBrief(dir, { outDir: "out" });
    assert.equal(second.brief.pain.value, "Mail eats the morning.");
    assert.equal(JSON.parse(readFileSync(path.join(out, "brief.json"), "utf8")).pain.source, "you");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
