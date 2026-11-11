#!/usr/bin/env node
/**
 * The marketing brief behind a `max` campaign: who it is for, what hurts, what changes, and the proof.
 *
 *   node <skill-root>/scripts/brief.mjs init <project-dir> [--out <output-dir>]    pre-fill brief.md + brief.json
 *   node <skill-root>/scripts/brief.mjs read <output-dir>                          re-read brief.md (your edits win)
 *
 * `init` pre-fills every field from the dossier (dossier.mjs): the README's own words for the audience,
 * pain and promise, the run's verified claims and git story as proof, objections a reader of that kind of
 * project raises (each with an answer drawn from the project), the install line or link as the call to
 * action, and a starting set of angles. Each field records where it came from. An agent sharpens it; then
 * the user edits brief.md, the human-readable copy, and `read` folds those edits back into brief.json.
 *
 * The rule the whole campaign keeps: persuasive, never deceptive. Proof points must be verified claims
 * or facts from git; `validateBrief` flags anything else, and fake scarcity or testimonials.
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildDossier } from "./dossier.mjs";

export const TONES = ["bold", "playful", "plain", "premium", "deadpan"];
export const ANGLES = {
  "pain-hook": "open on the problem the audience feels, then the product ends it",
  "before-after": "the old way next to the new way, side by side",
  demo: "the product doing its main job, start to finish, no talking",
  "myth-buster": "a belief the audience holds, and why it is wrong",
  proof: "the hardest facts the project can back up, one at a time",
  "build-story": "how and how fast it was built, from the git history",
  "how-to": "three steps from nothing to the result",
  "hot-take": "a strong opinion about the problem space, then the product as the answer",
};
// A brand kit's video tone, as the campaign tone it reads closest to.
const TONE_FROM_VIDEO = { default: "bold", polished: "premium", cinematic: "premium", "yc-parody": "deadpan", deadpan: "deadpan", chaotic: "bold", "app-store": "plain", ...Object.fromEntries(["bold", "playful", "plain", "premium"].map((t) => [t, t])) };
const FIELDS = ["audience", "pain", "workaround", "promise", "proof", "objections", "cta", "tone", "angles", "hashtags"];
const DEV_TYPES = new Set(["cli", "library", "api"]);
const DEV_TAGS = { type: { cli: ["devtools", "cli"], library: ["opensource", "devtools"], api: ["api", "devtools"] }, framework: { next: ["nextjs"], react: ["react"], vue: ["vuejs"], svelte: ["sveltekit"], astro: ["astro"], django: ["django"], rails: ["rails"] } };

// Who a kind of project is for, when the README does not say.
const AUDIENCE_BY_TYPE = {
  cli: "developers who live in the terminal",
  library: "developers building on this stack",
  api: "developers integrating this service",
  "web-app": "people who would use this in a browser",
  "landing-page": "people who would use this in a browser",
  mobile: "people who would use this on their phone",
  game: "players looking for a new game",
  "data-ml": "people working with this kind of data",
};

// The doubts a reader of each kind of project raises first. Answers are filled from project facts.
const OBJECTIONS = [
  { when: () => true, q: "Is it free?", a: (d) => (d.license ? `Yes. It is open source under ${d.license}.` : null) },
  { when: (d) => d.project.install, q: "Is it hard to set up?", a: (d) => `One line: ${d.project.install}` },
  { when: (d) => ["cli", "library", "api"].includes(d.project.type), q: "Does my code leave my machine?", a: () => null },
  { when: (d) => ["web-app", "landing-page", "mobile"].includes(d.project.type), q: "Do I need an account?", a: () => null },
  { when: (d) => d.story?.commits, q: "Is it maintained?", a: (d) => `${d.story.line}, and counting.` },
];

const firstSentence = (t) => String(t ?? "").replace(/\s+/g, " ").trim().match(/^.*?[.!?](?=\s|$)/)?.[0] ?? String(t ?? "").trim();
const field = (value, source) => ({ value, source });

/** README phrases that say who it is for and what it replaces: "for X", "without Y", "no more Z", "instead of W". */
export function readmeSignals(markdown) {
  const text = String(markdown ?? "").replace(/```[\s\S]*?```/g, " ").replace(/[`*_>#]/g, " ").replace(/\s+/g, " ");
  const grab = (re) => text.match(re)?.[1]?.trim().replace(/[.,;:]$/, "") || null;
  return {
    audience: grab(/\bbuilt for ([a-z][\w\s,'-]{3,60}?)(?=[.;:]|\s(?:who|that|to)\b)/i) ?? grab(/\b(?:made|designed|perfect) for ([a-z][\w\s,'-]{3,60}?)(?=[.;:])/i),
    pain: grab(/\b(?:tired of|sick of|no more|stop) ([a-z][\w\s,'-]{3,80}?)(?=[.;:!])/i),
    workaround: grab(/\binstead of ([a-z][\w\s,'-]{3,80}?)(?=[.;:!])/i),
    // The product's own live link: the first URL that is not a code host, registry, badge, or docs site.
    site: text.match(/https?:\/\/(?!(?:www\.)?(?:github|gitlab|npmjs|img\.shields|shields|badgen|pypi|crates|docs\.|localhost|127\.0))[\w.-]+\.[a-z]{2,}(?:\/[\w./-]*)?/i)?.[0]?.replace(/[.,]+$/, "") ?? null,
  };
}

function licenseOf(dir) {
  const file = ["LICENSE", "LICENSE.md", "LICENSE.txt"].map((f) => path.join(dir, f)).find(existsSync);
  if (!file) return null;
  const head = readFileSync(file, "utf8").slice(0, 400);
  return /MIT License/i.test(head) ? "MIT" : /Apache License/i.test(head) ? "Apache 2.0" : /GNU GENERAL PUBLIC/i.test(head) ? "GPL" : /BSD/i.test(head) ? "BSD" : null;
}

const sentenceCase = (t) => (/^[^a-z]*$/.test(t) && /[A-Z]{3}/.test(t) ? t.charAt(0) + t.slice(1).toLowerCase() : t);

/** Pre-fill a brief from a dossier. Pure apart from reading the README and LICENSE. */
export function prefillBrief(dossier, { projectDir = "." } = {}) {
  const readme = ["README.md", "readme.md", "Readme.md"].map((f) => path.join(projectDir, f)).find(existsSync);
  const signals = readmeSignals(readme ? readFileSync(readme, "utf8") : "");
  const d = { ...dossier, license: licenseOf(projectDir) };
  const { project } = dossier;
  const proof = [
    ...(dossier.claims ?? []).filter((c) => c.verified).map((c) => sentenceCase(c.text)),
    ...(dossier.highlights ?? []),
  ].filter((p, i, all) => p && all.indexOf(p) === i).slice(0, 6);
  if (dossier.story?.line && !proof.some((p) => p.includes(dossier.story.line))) proof.push(dossier.story.line);

  // The tagline is already the first sentence, plus the second when the first is a short hook.
  const promise = project.tagline ?? firstSentence(project.description ?? project.name);
  const link = signals.site ?? project.url;
  const objections = OBJECTIONS.filter((o) => o.when(d)).map((o) => ({ q: o.q, a: o.a(d) ?? "" })).filter((o) => o.a).slice(0, 4);
  const angles = ["pain-hook", "demo", "proof"];
  if (dossier.story?.days && dossier.story.days <= 14) angles.push("build-story");
  angles.push(project.install ? "how-to" : "before-after");

  return {
    briefVersion: 1,
    product: project.name,
    audience: field(signals.audience ?? AUDIENCE_BY_TYPE[project.type] ?? "people who would use this", signals.audience ? "readme" : "project type"),
    pain: field(signals.pain ? `They are stuck with ${signals.pain}.` : "", signals.pain ? "readme" : "needs you"),
    workaround: field(signals.workaround ?? "", signals.workaround ? "readme" : "needs you"),
    promise: field(promise, "readme"),
    proof: field(proof, proof.length ? "claims + git" : "needs you"),
    objections: field(objections, "project facts"),
    cta: field(project.install ? `Try it: ${project.install}` : link ? `Try it: ${link}` : "", project.install ? "install line" : signals.site ? "the live site in the README" : link ? "project link" : "needs you"),
    tone: field(TONE_FROM_VIDEO[dossier.brand?.tone] ?? "bold", dossier.brand?.tone ? "brand kit" : "default"),
    angles: field(angles.slice(0, 5), "default for this project"),
    // Topic tags only where the audience is developers; anyone else's tags are the user's call.
    hashtags: field(
      DEV_TYPES.has(project.type) || /developer|engineer|programmer/i.test(signals.audience ?? "")
        ? [...new Set([...(DEV_TAGS.framework[project.framework] ?? []), ...(DEV_TAGS.type[project.type] ?? []), "buildinpublic"])]
        : [],
      DEV_TYPES.has(project.type) ? "project type" : "needs you",
    ),
  };
}

// ---------------------------------------------------------------- brief.md: the copy the user edits

const SECTIONS = {
  audience: "Who it is for",
  pain: "What hurts today",
  workaround: "What they do instead",
  promise: "What changes with it",
  proof: "Proof (verified claims and facts only)",
  objections: "Doubts, and the answer to each",
  cta: "The one thing to do next",
  tone: `Tone (one of: ${TONES.join(", ")})`,
  angles: `Angles (from: ${Object.keys(ANGLES).join(", ")})`,
  hashtags: "Hashtags your audience follows (without #; the product's own tag is added)",
};

/** brief.json as editable markdown. Lists are "- " bullets; objections are "- Question? Answer." */
export function briefMarkdown(brief) {
  const lines = [
    `# Marketing brief: ${brief.product}`,
    "",
    "<!-- Edit anything here, then run `shipreel max` again: your words replace the pre-filled ones. -->",
    "<!-- Keep it honest: proof is only what the project can back up; no invented numbers, quotes, or deadlines. -->",
    "",
  ];
  for (const key of FIELDS) {
    const { value, source } = brief[key];
    lines.push(`## ${SECTIONS[key]}`, `<!-- pre-filled from: ${source} -->`);
    if (key === "objections") value.forEach((o) => lines.push(`- ${o.q} ${o.a}`));
    else if (Array.isArray(value)) value.forEach((v) => lines.push(`- ${v}`));
    else lines.push(value || "_(fill this in)_");
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}

/** Read an edited brief.md back over a brief: every section present in the markdown replaces the pre-fill. */
export function applyBriefMarkdown(brief, markdown) {
  const out = structuredClone(brief);
  const byTitle = Object.fromEntries(Object.entries(SECTIONS).map(([k, t]) => [t.toLowerCase(), k]));
  const parts = String(markdown).replace(/<!--[\s\S]*?-->/g, "").split(/^## /m).slice(1);
  for (const part of parts) {
    const [titleLine, ...body] = part.split("\n");
    const key = byTitle[titleLine.trim().toLowerCase()];
    if (!key) continue;
    const text = body.join("\n").trim();
    const bullets = text.split("\n").filter((l) => /^[-*]\s+/.test(l)).map((l) => l.replace(/^[-*]\s+/, "").trim()).filter(Boolean);
    let value;
    if (key === "objections") {
      value = bullets.map((b) => {
        const m = b.match(/^(.+?\?)\s*(.*)$/);
        return m ? { q: m[1].trim(), a: m[2].trim() } : { q: b, a: "" };
      });
    } else if (key === "proof" || key === "angles") value = bullets;
    else if (key === "hashtags") value = bullets.length ? bullets.map((b) => b.replace(/^#/, "")) : text.split(/[\s,]+/).map((t) => t.replace(/^#/, "")).filter(Boolean);
    else value = text.replace(/^_\(fill this in\)_$/, "").trim();
    if (key === "angles") value = value.map((a) => a.toLowerCase().replace(/\s+/g, "-"));
    if (key === "tone") value = value.toLowerCase();
    if (JSON.stringify(value) !== JSON.stringify(out[key].value)) out[key] = { value, source: "you" };
  }
  return out;
}

// Copy that would make the campaign deceptive: invented urgency, scarcity, or social proof.
const DECEPTIVE = [
  [/\b(?:only|just) \d+ (?:spots?|seats?|left|copies)\b/i, "invented scarcity"],
  [/\b(?:offer|sale|price) ends (?:today|tonight|soon)\b|\blast chance\b|\b(?:act|buy) now before\b/i, "invented urgency"],
  [/\b(?:thousands|millions|hundreds) of (?:users|developers|people|customers|happy)\b/i, "invented social proof"],
  [/["“][^"”]{12,}["”]\s*[-—–]\s*[A-Z][a-z]+/, "a quoted testimonial"],
];

/** Every deceptive pattern a text contains: invented scarcity, urgency, social proof, or a quoted testimonial. */
export function deceptiveHits(text) {
  return DECEPTIVE.filter(([re]) => re.test(String(text))).map(([, what]) => what);
}

/** Problems that stop a brief from driving a campaign. `facts` are the verified claim texts and git facts proof may use. */
export function validateBrief(brief, { facts = [] } = {}) {
  const errors = [], warnings = [];
  for (const key of ["audience", "promise", "cta"]) if (!String(brief[key]?.value ?? "").trim()) errors.push({ code: "missing", field: key, message: `"${SECTIONS[key]}" is empty.` });
  for (const key of ["pain"]) if (!String(brief[key]?.value ?? "").trim()) warnings.push({ code: "missing", field: key, message: `"${SECTIONS[key]}" is empty; pain hooks are the strongest openers, so fill it in.` });
  if (!TONES.includes(brief.tone?.value)) errors.push({ code: "tone", field: "tone", message: `tone "${brief.tone?.value}" is not one of ${TONES.join(", ")}.` });
  const unknown = (brief.angles?.value ?? []).filter((a) => !ANGLES[a]);
  if (unknown.length) errors.push({ code: "angle", field: "angles", message: `unknown angle${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}.` });
  if (!(brief.hashtags?.value ?? []).length) warnings.push({ code: "hashtags", field: "hashtags", message: "no hashtags yet; add 2 to 4 your audience actually follows, or posts carry only the product's own tag." });
  if ((brief.angles?.value ?? []).length < 3) warnings.push({ code: "angles", field: "angles", message: "fewer than 3 angles; each platform gets 3 to 5 pieces, so they will repeat." });
  const known = facts.map((f) => String(f).toLowerCase());
  for (const p of brief.proof?.value ?? []) {
    if (!known.some((f) => f.includes(String(p).toLowerCase()) || String(p).toLowerCase().includes(f))) {
      errors.push({ code: "unverified-proof", field: "proof", message: `"${p}" is not a verified claim or git fact; add it to claims.json with its source, or take it out.` });
    }
  }
  const all = FIELDS.map((k) => JSON.stringify(brief[k]?.value ?? "")).join(" ");
  for (const [re, what] of DECEPTIVE) if (re.test(all)) errors.push({ code: "deceptive", field: "brief", message: `the brief contains ${what}; persuasive, never deceptive.` });
  return { ok: errors.length === 0, errors, warnings };
}

/** The facts proof may cite: verified claim texts, README highlights, and the git story line. */
export function briefFacts(dossier) {
  return [...(dossier.claims ?? []).filter((c) => c.verified).map((c) => sentenceCase(c.text)), ...(dossier.highlights ?? []), dossier.story?.line].filter(Boolean);
}

/** init: pre-fill and write brief.json + brief.md, keeping an existing brief.md's edits. */
export function initBrief(projectDir, { outDir } = {}) {
  const dir = path.resolve(projectDir);
  const out = path.resolve(dir, outDir ?? "shipreel-output");
  mkdirSync(out, { recursive: true });
  const dossierFile = path.join(out, "dossier.json");
  const dossier = existsSync(dossierFile) ? JSON.parse(readFileSync(dossierFile, "utf8")) : buildDossier(dir, { outDir: out });
  let brief = prefillBrief(dossier, { projectDir: dir });
  const md = path.join(out, "brief.md");
  if (existsSync(md)) brief = applyBriefMarkdown(brief, readFileSync(md, "utf8"));
  writeFileSync(path.join(out, "brief.json"), `${JSON.stringify(brief, null, 2)}\n`);
  writeFileSync(md, briefMarkdown(brief));
  return { brief, check: validateBrief(brief, { facts: briefFacts(dossier) }), files: { json: path.join(out, "brief.json"), md } };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const [command, target = ".", ...rest] = process.argv.slice(2);
  const flag = (name) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined);
  try {
    if (command === "init" || command === "read") {
      const { brief, check, files } = initBrief(target, { outDir: flag("--out") });
      console.log(`${files.md}`);
      for (const key of FIELDS) {
        const v = brief[key].value;
        console.log(`  ${key.padEnd(10)} ${Array.isArray(v) ? `${v.length} item(s)` : String(v).slice(0, 70) || "(empty)"}  [${brief[key].source}]`);
      }
      for (const e of check.errors) console.log(`  ✗ ${e.code}: ${e.message}`);
      for (const w of check.warnings) console.log(`  ! ${w.code}: ${w.message}`);
      console.log(check.ok ? "✓ Brief ready. Edit brief.md to change anything, then run it again." : "✗ Fix the brief before generating a campaign.");
      if (!check.ok) process.exitCode = 1;
    } else {
      console.error("Usage: brief.mjs init|read <project-dir> [--out <output-dir>]");
      process.exitCode = 2;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
