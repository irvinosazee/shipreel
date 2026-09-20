#!/usr/bin/env node
/**
 * Localization: translate a composition's on-screen copy into other languages.
 *
 *   node <skill-root>/scripts/i18n.mjs extract <composition-dir> --out strings.json
 *   node <skill-root>/scripts/i18n.mjs validate strings.json strings.es.json
 *   node <skill-root>/scripts/i18n.mjs apply <composition-dir> --lang es --strings strings.es.json
 *   node <skill-root>/scripts/i18n.mjs voice es
 *
 * `extract` lists every visible text run inside the composition root (not scripts, styles, or
 * anything under data-i18n-skip) with a stable key in document order. Translate the `text` of each
 * key into strings.<lang>.json as { "t0": "...", ... }. `validate` checks every key is present,
 * URLs/commands/handles/numbers survive, and flags strings that grew enough to risk overflow.
 * `apply` writes composition-<lang>/ with the translated runs and <html lang>. Text inside kit
 * props or timeline scripts is not extracted; translate those in the source script.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const RAW = new Set(["script", "style", "title", "textarea"]);
const GROWTH_WARNING = 1.4;
const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

const decode = (text) => text.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (entity) => ENTITIES[entity]);
const escapeText = (text) => text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

/** Walk the HTML and call onText for every translatable text run; returns the rebuilt HTML. */
function walk(html, onText) {
  const stack = [];
  let rootDepth = -1;
  let out = "";
  let index = 0;
  const token = /<!--[\s\S]*?-->|<\/?[a-zA-Z][^>]*>|[^<]+|</g;
  token.lastIndex = 0;
  let match;
  while ((match = token.exec(html))) {
    const part = match[0];
    if (part.startsWith("<!--")) {
      out += part;
    } else if (/^<[a-zA-Z]/.test(part)) {
      const name = part.match(/^<([a-zA-Z][\w-]*)/)[1].toLowerCase();
      if (RAW.has(name)) {
        const close = html.toLowerCase().indexOf(`</${name}`, token.lastIndex);
        const end = close === -1 ? html.length : html.indexOf(">", close) + 1;
        out += html.slice(match.index, end);
        token.lastIndex = end;
        continue;
      }
      const attrs = part;
      const selfClosing = VOID.has(name) || /\/>$/.test(part);
      if (!selfClosing) {
        stack.push({ name, attrs, skip: /\sdata-i18n-skip(?:[\s=>]|$)/.test(attrs) });
        if (rootDepth === -1 && /\sdata-composition-id=/.test(attrs)) rootDepth = stack.length;
      }
      out += part;
    } else if (part.startsWith("</")) {
      const name = part.slice(2).replace(/[\s>].*$/s, "").toLowerCase();
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if (stack[i].name === name) {
          if (rootDepth > i) rootDepth = rootDepth === i + 1 ? -2 : rootDepth;
          stack.length = i;
          break;
        }
      }
      out += part;
    } else {
      const inRoot = rootDepth > 0 && stack.length >= rootDepth;
      const skipped = stack.some((el) => el.skip);
      const text = decode(part).replace(/\s+/g, " ").trim();
      // Runs without a single letter (prompts, dots, timers) never need translating.
      if (inRoot && !skipped && /\p{L}/u.test(text)) {
        const leading = part.match(/^\s*/)[0];
        const trailing = part.match(/\s*$/)[0];
        const element = stack.at(-1);
        const id = element.attrs.match(/\sid="([^"]*)"/)?.[1];
        const classes = element.attrs.match(/\sclass="([^"]*)"/)?.[1]?.trim().split(/\s+/) ?? [];
        const context = `${element.name}${id ? `#${id}` : ""}${classes.map((c) => `.${c}`).join("")}`;
        const replacement = onText({ key: `t${index}`, text, context });
        index += 1;
        out += replacement == null ? part : `${leading}${escapeText(replacement)}${trailing}`;
      } else {
        out += part;
      }
    }
  }
  return out;
}

export function extractStrings(html) {
  const strings = [];
  walk(html, (run) => {
    strings.push(run);
    return null;
  });
  return { source: html.match(/<html\b[^>]*\blang="([^"]*)"/i)?.[1] ?? "en", strings };
}

export function applyStrings(html, translations, { lang }) {
  let out = walk(html, (run) => (Object.hasOwn(translations, run.key) ? translations[run.key] : null));
  if (lang) {
    out = /<html\b[^>]*\blang="[^"]*"/i.test(out)
      ? out.replace(/(<html\b[^>]*\blang=")[^"]*(")/i, `$1${lang}$2`)
      : out.replace(/<html\b/i, `<html lang="${lang}"`);
  }
  return out;
}

export function protectedTokens(text) {
  const pattern = /(https?:\/\/[^\s,]+)|(?<![\w/:.])(\/[a-z][\w-]*)|(?<![\w@])(@[\w.-]*\w)|(?<![\w.])(\d[\d,]*(?:\.\d+)?%?)/gi;
  return [...String(text).matchAll(pattern)].map((m) => m[0].replace(/,$/, ""));
}

export function validateTranslation(sourceStrings, translations) {
  const errors = [];
  const warnings = [];
  const keys = new Set(sourceStrings.map((s) => s.key));
  for (const { key, text } of sourceStrings) {
    const label = `${key} ("${text}")`;
    if (!Object.hasOwn(translations, key)) {
      errors.push(`${label} is missing`);
      continue;
    }
    const translated = String(translations[key]);
    if (!translated.trim()) {
      errors.push(`${label} is empty`);
      continue;
    }
    const dropped = protectedTokens(text).filter((tokenText) => !translated.includes(tokenText));
    if (dropped.length) errors.push(`${label} dropped ${dropped.map((t) => `"${t}"`).join(", ")}`);
    const ratio = translated.length / text.length;
    if (text.length >= 8 && ratio > GROWTH_WARNING) {
      warnings.push(`${key} is ${ratio.toFixed(2)}x longer than the source; check it still fits (text_audit and check will tell).`);
    }
  }
  for (const key of Object.keys(translations)) if (!keys.has(key)) errors.push(`${key} is not a key in strings.json`);
  return { errors, warnings };
}

export function makeLanguageVariant(sourceDir, lang, translations) {
  const source = path.resolve(sourceDir);
  const target = path.join(path.dirname(source), `${path.basename(source)}-${lang}`);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source)) {
    if (["index.html", "snapshots", "node_modules"].includes(entry)) continue;
    cpSync(path.join(source, entry), path.join(target, entry), { recursive: true, dereference: true });
  }
  writeFileSync(path.join(target, "index.html"), applyStrings(readFileSync(path.join(source, "index.html"), "utf8"), translations, { lang }));
  writeFileSync(path.join(target, "GENERATED.md"), `# Generated — do not edit\n\n${lang} copy of \`${path.basename(source)}/\`, made by \`i18n.mjs apply\`. Edit the source or strings.${lang}.json and re-apply.\n`);
  return target;
}

// Kokoro-82M voices. `listed` voices appear in `npx hyperframes tts --list`; the others are Kokoro
// voice ids for languages its phonemizer supports but the list does not show — confirm them first.
export const KOKORO_VOICES = {
  "en-us": { voice: "af_heart", ttsLang: "en-us", listed: true },
  "en-gb": { voice: "bf_emma", ttsLang: "en-gb", listed: true },
  es: { voice: "ef_dora", ttsLang: "es", listed: true },
  fr: { voice: "ff_siwis", ttsLang: "fr-fr", listed: true },
  ja: { voice: "jf_alpha", ttsLang: "ja", listed: true },
  zh: { voice: "zf_xiaobei", ttsLang: "zh", listed: true },
  hi: { voice: "hf_alpha", ttsLang: "hi", listed: false },
  it: { voice: "if_sara", ttsLang: "it", listed: false },
  "pt-br": { voice: "pf_dora", ttsLang: "pt-br", listed: false },
};
const LANG_ALIASES = { en: "en-us", "fr-fr": "fr", pt: "pt-br", "zh-cn": "zh", "ja-jp": "ja", "es-es": "es" };

export function voiceFor(lang) {
  const key = String(lang).toLowerCase();
  return KOKORO_VOICES[LANG_ALIASES[key] ?? key] ?? null;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const [command, first, ...rest] = process.argv.slice(2);
  const flag = (name) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined);
  try {
    if (command === "extract" && first && flag("--out")) {
      const result = extractStrings(readFileSync(path.join(first, "index.html"), "utf8"));
      writeFileSync(flag("--out"), `${JSON.stringify(result, null, 2)}\n`);
      console.log(`${result.strings.length} strings → ${flag("--out")}`);
    } else if (command === "validate" && first && rest[0]) {
      const report = validateTranslation(JSON.parse(readFileSync(first, "utf8")).strings, JSON.parse(readFileSync(rest[0], "utf8")));
      console.log(JSON.stringify(report, null, 2));
      process.exitCode = report.errors.length ? 1 : 0;
    } else if (command === "apply" && first && flag("--lang") && flag("--strings") && existsSync(path.join(first, "index.html"))) {
      console.log(makeLanguageVariant(first, flag("--lang"), JSON.parse(readFileSync(flag("--strings"), "utf8"))));
    } else if (command === "voice" && first) {
      console.log(JSON.stringify(voiceFor(first)));
    } else {
      console.error("Usage: i18n.mjs extract <dir> --out strings.json | validate strings.json strings.<lang>.json | apply <dir> --lang <lang> --strings strings.<lang>.json | voice <lang>");
      process.exitCode = 2;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
