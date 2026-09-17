import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { extractStrings, applyStrings, validateTranslation, protectedTokens, makeLanguageVariant, KOKORO_VOICES, voiceFor } from "../skills/brag/scripts/i18n.mjs";

const html = `<!doctype html>
<html lang="en">
  <head><title>not visible</title><style>.x::after { content: "no" }</style></head>
  <body>
    <div id="root" data-composition-id="main">
      <p id="q" class="kicker">built something cool?</p>
      <h1 class="slam"><span class="line">let's <span class="hl">brag</span></span><span class="line">about it.</span></h1>
      <p class="sub">music &amp; motion · share copy</p>
      <div data-i18n-skip><code>/plugin install brag@brag</code></div>
      <p>made with /brag in 20 seconds</p>
      <script>const t = "not visible";</script>
    </div>
  </body>
</html>`;

test("extractStrings returns visible text runs inside the composition root, in order, with context", () => {
  const { strings } = extractStrings(html);
  assert.deepEqual(strings.map((s) => [s.key, s.text]), [
    ["t0", "built something cool?"],
    ["t1", "let's"],
    ["t2", "brag"],
    ["t3", "about it."],
    ["t4", "music & motion · share copy"],
    ["t5", "made with /brag in 20 seconds"],
  ]);
  assert.equal(strings[0].context, "p#q.kicker");
  assert.equal(strings[2].context, "span.hl");
});

test("extractStrings skips runs with no letters, like prompts, dots, and timers", () => {
  const { strings } = extractStrings('<div data-composition-id="m"><span>$</span><span>●</span><span>00:17 / 00:20</span><span>REC</span></div>');
  assert.deepEqual(strings.map((s) => s.text), ["REC"]);
});

test("applyStrings replaces each run, keeps surrounding whitespace, escapes, and sets the language", () => {
  const translated = {
    t0: "¿construiste algo genial?",
    t1: "vamos a",
    t2: "presumir",
    t3: "de ello.",
    t4: "música & movimiento · texto para compartir",
    t5: "hecho con /brag en 20 segundos",
  };
  const out = applyStrings(html, translated, { lang: "es" });
  assert.match(out, /<html lang="es">/);
  assert.match(out, /<p id="q" class="kicker">¿construiste algo genial\?<\/p>/);
  assert.match(out, /<span class="line">vamos a <span class="hl">presumir<\/span><\/span>/, "the space before the nested span is kept");
  assert.match(out, /música &amp; movimiento/);
  assert.match(out, /<code>\/plugin install brag@brag<\/code>/, "skipped regions are untouched");
  assert.match(out, /const t = "not visible";/, "scripts are untouched");
  assert.deepEqual(extractStrings(out).strings.map((s) => s.key), ["t0", "t1", "t2", "t3", "t4", "t5"], "the translated file extracts with the same keys");
});

test("protectedTokens are URLs, commands, handles, and numbers", () => {
  assert.deepEqual(protectedTokens("made with /brag at https://brag.dev by @ada in 20 seconds, 99.1% uptime"), ["/brag", "https://brag.dev", "@ada", "20", "99.1%"]);
});

test("validateTranslation requires every key, keeps protected tokens, and warns on long growth", () => {
  const source = extractStrings(html).strings;
  const good = { t0: "¿algo genial?", t1: "vamos a", t2: "presumir", t3: "de ello.", t4: "música", t5: "hecho con /brag en 20 segundos" };
  assert.deepEqual(validateTranslation(source, good), { errors: [], warnings: [] });

  const bad = { ...good, t2: " ", t5: "hecho con brag en veinte segundos", t9: "extra" };
  delete bad.t3;
  const { errors } = validateTranslation(source, bad);
  assert.deepEqual(errors, [
    't2 ("brag") is empty',
    't3 ("about it.") is missing',
    't5 ("made with /brag in 20 seconds") dropped "/brag", "20"',
    "t9 is not a key in strings.json",
  ]);

  const { warnings } = validateTranslation(source, { ...good, t0: "¿has construido algo realmente genial y quieres contarlo?" });
  assert.match(warnings[0], /t0 is 2\.\d+x longer/);
});

test("makeLanguageVariant writes composition-<lang> with translated markup and assets", () => {
  const root = mkdtempSync(path.join(tmpdir(), "brag-i18n-"));
  try {
    const src = path.join(root, "composition");
    mkdirSync(path.join(src, "assets"), { recursive: true });
    writeFileSync(path.join(src, "index.html"), html);
    writeFileSync(path.join(src, "assets", "a.txt"), "x");
    const dir = makeLanguageVariant(src, "ja", { t0: "何か作った？", t1: "", t2: "自慢", t3: "しよう。", t4: "音楽", t5: "/brag で 20 秒" });
    assert.equal(dir, path.join(root, "composition-ja"));
    const out = readFileSync(path.join(dir, "index.html"), "utf8");
    assert.match(out, /<html lang="ja">/);
    assert.match(out, /自慢/);
    assert.ok(existsSync(path.join(dir, "assets", "a.txt")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("voiceFor maps languages to Kokoro voices and flags voices that are not in the listed set", () => {
  assert.deepEqual(voiceFor("es"), { voice: "ef_dora", ttsLang: "es", listed: true });
  assert.deepEqual(voiceFor("ja"), { voice: "jf_alpha", ttsLang: "ja", listed: true });
  assert.deepEqual(voiceFor("en-GB"), { voice: "bf_emma", ttsLang: "en-gb", listed: true });
  assert.equal(voiceFor("pt").ttsLang, "pt-br");
  assert.equal(voiceFor("pt").listed, false);
  assert.equal(voiceFor("de"), null, "no Kokoro voice for German: say so instead of guessing");
  assert.ok(Object.keys(KOKORO_VOICES).length >= 6);
});
