#!/usr/bin/env node
/**
 * Truth mode: every claim on screen is backed by the project.
 *
 *   node <skill-root>/scripts/claims.mjs verify <output-dir> --project <project-dir> [--strict]
 *
 * <output-dir>/claims.json lists the claims the video makes:
 *   [{ "text": "Available in 12 metros", "source": "index.html", "quote": "Available in 12 metros" },
 *    { "text": "4.2k GitHub stars", "source": "https://api.github.com/repos/o/r", "value": 4210, "fetchedAt": "..." }]
 *
 * A file claim is verified when its quote appears in the cited file (visible text for HTML,
 * whitespace/case/entity-insensitive). A metric claim is verified by its URL, value, and fetch
 * time from metrics.mjs. With --strict (non-parody projects), numbers, multipliers, and
 * superlatives on screen that no claim covers are errors too.
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compositionText } from "./brand.mjs";

const HTML_LIKE = /\.(html?|astro|vue|svelte|jsx|tsx|mdx)$/i;
const MEASURE_WORD = /^(?:am|pm|fps|px|p|s|ms|sec|secs|seconds|min|mins|minutes|x|k|m)$/i;

export function normalizeText(text) {
  return String(text)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/ /g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function sourceText(file) {
  const raw = readFileSync(file, "utf8");
  return normalizeText(HTML_LIKE.test(file) ? compositionText(raw) : raw);
}

export function verifyClaims(claims, { projectDir }) {
  const problems = [];
  let verified = 0;
  for (const claim of claims) {
    const label = `"${claim.text}"`;
    if (/^https?:\/\//.test(claim.source ?? "") && claim.value != null && claim.fetchedAt) {
      verified += 1;
      continue;
    }
    if (!claim.source || !claim.quote) {
      problems.push(`${label}: needs a source file and quote, or a fetched metric`);
      continue;
    }
    const file = path.resolve(projectDir, claim.source);
    if (!existsSync(file)) {
      problems.push(`${label}: source ${claim.source} does not exist`);
      continue;
    }
    if (sourceText(file).includes(normalizeText(claim.quote))) verified += 1;
    else problems.push(`${label}: quote "${claim.quote}" not found in ${claim.source}`);
  }
  return { verified, problems };
}

const NOT_SUPERLATIVE = /^(latest|test|rest|request|interest|contest|forest|guest|honest|modest|chest|west|nest|quest|digest|manifest|protest|harvest|arrest|suggest|invest|crest|pest|vest|zest|jest|unrest)$/i;

/** Numbers-with-a-noun, multipliers, and superlatives on screen that no claim's text covers. */
export function findUncitedClaims(screenText, claims) {
  const covered = claims.map((claim) => normalizeText(claim.text));
  const text = String(screenText)
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, " ") // clock times and aspect ratios
    .replace(/\bv\d+(?:\.\d+)*\b/gi, " "); // version labels
  const candidates = [];
  const patterns = [
    // A number is digits with optional thousands separators: "1,200 users", never the "0," that ends a clause.
    /(?<![\w.])\d(?:[\d,]*\d)?(?:\.\d+)?\s?(?:%|x|×)?\s+(?:[a-z][a-z-]*)/gi,
    /\b(?:the|most)\s+(?:[a-z]+est|best|most\s+[a-z]+)\b/gi,
    /#1\b/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const phrase = match[0].replace(/\s+/g, " ").trim();
      const words = phrase.split(" ");
      if (/^\d/.test(phrase) && (MEASURE_WORD.test(words.at(-1)) || /^(19|20)\d{2}$/.test(words[0]))) continue;
      // "01", "02 / 04": a zero-padded number is a slide or step index, not a quantity.
      if (/^0\d/.test(phrase)) continue;
      // "-est" nouns and recency words are not superlatives: "the test", "the latest Hyperframes".
      if (/^(the|most)\s/i.test(phrase) && NOT_SUPERLATIVE.test(words.at(-1))) continue;
      candidates.push({ index: match.index, phrase });
    }
  }
  const seen = new Set();
  return candidates
    .sort((a, b) => a.index - b.index)
    .map((c) => c.phrase)
    .filter((phrase) => {
      const key = normalizeText(phrase);
      if (seen.has(key) || covered.some((claim) => claim.includes(key))) return false;
      seen.add(key);
      return true;
    });
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const [command, outputDir, ...rest] = process.argv.slice(2);
  const projectDir = rest.includes("--project") ? rest[rest.indexOf("--project") + 1] : process.cwd();
  if (command !== "verify" || !outputDir) {
    console.error("Usage: claims.mjs verify <output-dir> --project <project-dir> [--strict]");
    process.exitCode = 2;
  } else {
    const claimsFile = path.join(outputDir, "claims.json");
    const claims = existsSync(claimsFile) ? JSON.parse(readFileSync(claimsFile, "utf8")) : [];
    const { verified, problems } = verifyClaims(claims, { projectDir });
    const composition = path.join(outputDir, "composition", "index.html");
    const uncited = rest.includes("--strict") && existsSync(composition)
      ? findUncitedClaims(compositionText(readFileSync(composition, "utf8")), claims)
      : [];
    console.log(JSON.stringify({ claims: claims.length, verified, problems, uncited }, null, 2));
    process.exitCode = problems.length || uncited.length ? 1 : 0;
  }
}
