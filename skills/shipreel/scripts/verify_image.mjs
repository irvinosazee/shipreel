#!/usr/bin/env node
/**
 * Verify launch cards before anyone posts them: the still-image twin of verify_render.mjs.
 *
 *   node <skill-root>/scripts/verify_image.mjs <cards-dir> [--claims <claims.json>]
 *
 * Reads <cards-dir>/cards.json (written by cards.mjs) and checks every image:
 *   size              (error)   the PNG is exactly the platform's size
 *   file-too-large    (error)   over the platform's upload limit
 *   file-heavy        (warning) over the size where a platform starts to degrade it (WhatsApp drops
 *                               link previews over about 300 KB; GitHub refuses social previews over 1 MB)
 *   text-too-small    (error)   rendered text under 2.6% of the short side (28px per 1080px), what a phone reads
 *   text-outside-safe (error)   text that crosses the safe margin platforms crop and round away
 *   text-overflow     (error)   text wider than its box, or running off the card
 *   text-overlaps-image (error) text that runs into the image beside or below it
 *   contrast          (error)   below WCAG AA against the colour actually behind it (3:1 large, 4.5:1 body)
 *   uncited-claim     (error)   a number or superlative on the image that no claim covers (claims.mjs)
 *
 * Layout and contrast are measured in headless Chrome from the cards' HTML (<cards-dir>/html/).
 * Without --claims, it reads <cards-dir>/../claims.json when present.
 */

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { contrastRatio } from "./captions.mjs";
import { SAFE_MARGIN, imageSize } from "./cards.mjs";
import { withPage } from "./chrome.mjs";
import { findUncitedClaims } from "./claims.mjs";

const KB = 1024, MB = 1024 * 1024;
// Hard upload limits and the softer size past which a platform degrades the image, from each platform's docs.
export const IMAGE_BUDGETS = {
  og: { max: 5 * MB, warn: 300 * KB, note: "WhatsApp drops link previews over about 300 KB" },
  x: { max: 5 * MB, warn: 2 * MB, note: "X recompresses images over a few MB" },
  github: { max: 1 * MB, warn: 900 * KB, note: "GitHub refuses social previews over 1 MB" },
  producthunt: { max: 5 * MB, warn: 3 * MB, note: "Product Hunt gallery images load slowly past 3 MB" },
  linkedin: { max: 5 * MB, warn: 2 * MB, note: "LinkedIn document pages over a few MB load slowly" },
};
export const MIN_TEXT_SHARE = 28 / 1080;

const hexOf = (rgb) => {
  const m = String(rgb).match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?/);
  if (!m) return null;
  return { hex: `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`, alpha: m[4] === undefined ? 1 : Number(m[4]) };
};

/** Problems in one card's measured text, given its size. Pure, so it is testable without a browser. */
export function judgeText(measured, { size: [W, H] }) {
  const errors = [];
  const m = Math.round(Math.min(W, H) * SAFE_MARGIN);
  const minPx = Math.ceil(Math.min(W, H) * MIN_TEXT_SHARE);
  for (const t of measured) {
    const label = `"${t.text.length > 40 ? `${t.text.slice(0, 40)}…` : t.text}"`;
    if (t.fontPx + 0.5 < minPx) errors.push({ code: "text-too-small", message: `${label} renders at ${Math.round(t.fontPx)}px; this ${W}x${H} image needs at least ${minPx}px to read on a phone.` });
    const { left, top, right, bottom } = t.box;
    if (left < m - 1 || top < m - 1 || right > W - m + 1 || bottom > H - m + 1) {
      errors.push({ code: "text-outside-safe", message: `${label} crosses the ${m}px safe margin (box ${Math.round(left)},${Math.round(top)} to ${Math.round(right)},${Math.round(bottom)}).` });
    }
    if (t.overflow) errors.push({ code: "text-overflow", message: `${label} is wider than its box and gets cut off.` });
    if (t.overlaps) errors.push({ code: "text-overlaps-image", message: `${label} runs into the image.` });
    if (t.fg && t.bg) {
      const ratio = contrastRatio(t.fg, t.bg);
      const large = t.fontPx >= 24 || (t.fontPx >= 18.66 && t.weight >= 700);
      const need = large ? 3 : 4.5;
      if (ratio + 1e-9 < need) errors.push({ code: "contrast", message: `${label} is ${ratio.toFixed(2)}:1 (${t.fg} on ${t.bg}); needs ${need}:1.` });
    }
  }
  return errors;
}

/** Size and budget problems for one image file. */
export function judgeFile(file, { target, size }) {
  const errors = [], warnings = [];
  const actual = imageSize(file);
  if (!actual) return { errors: [{ code: "size", message: `${path.basename(file)} is missing or not a PNG/JPEG.` }], warnings };
  if (actual[0] !== size[0] || actual[1] !== size[1]) errors.push({ code: "size", message: `${path.basename(file)} is ${actual.join("x")}; ${target} needs exactly ${size.join("x")}.` });
  const bytes = statSync(file).size;
  const budget = IMAGE_BUDGETS[target];
  const human = (n) => (n >= MB ? `${(n / MB).toFixed(1)} MB` : `${Math.round(n / KB)} KB`);
  if (budget && bytes > budget.max) errors.push({ code: "file-too-large", message: `${path.basename(file)} is ${human(bytes)}; ${target} accepts at most ${human(budget.max)}.` });
  else if (budget && bytes > budget.warn) warnings.push({ code: "file-heavy", message: `${path.basename(file)} is ${human(bytes)}: ${budget.note}.` });
  return { errors, warnings, bytes };
}

/** On-image numbers and superlatives no claim covers. Each line is checked on its own, so neighbouring lines never join into a phrase. */
export function judgeClaims(texts, claims) {
  const seen = new Set();
  return texts.flatMap((t) => findUncitedClaims(t, claims)).filter((p) => !seen.has(p) && seen.add(p)).map((phrase) => ({ code: "uncited-claim", message: `"${phrase}" is on the image but no claim in claims.json covers it.` }));
}

// Runs in the page: every [data-text] element's rendered size, box, overflow, and the colours behind it.
const MEASURE = `(() => {
  const opaque = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      const a = c.match(/rgba?\\(([^)]+)\\)/);
      if (a && (a[1].split(/[ ,/]+/).length < 4 || parseFloat(a[1].split(/[ ,/]+/)[3]) > 0.5)) return c;
    }
    return getComputedStyle(document.body).backgroundColor;
  };
  const media = [...document.querySelectorAll(".media")].map((m) => m.getBoundingClientRect());
  return [...document.querySelectorAll("[data-text]")].map((el) => {
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    const range = document.createRange(); range.selectNodeContents(el);
    const t = range.getBoundingClientRect();
    return {
      text: el.textContent.trim(),
      fontPx: parseFloat(s.fontSize),
      weight: Number(s.fontWeight) || 400,
      box: { left: Math.min(r.left, t.left), top: Math.min(r.top, t.top), right: Math.max(r.right, t.right), bottom: Math.max(r.bottom, t.bottom) },
      // Display glyphs legitimately poke past their line box vertically; only sideways overflow and leaving the card count.
      overflow: el.scrollWidth > el.clientWidth + 2 || t.right > innerWidth || t.bottom > innerHeight,
      overlaps: media.some((m) => t.left < m.right && t.right > m.left && t.top < m.bottom && t.bottom > m.top),
      color: s.color,
      background: opaque(el),
    };
  });
})()`;

/** Verify every card in a cards directory. */
export async function verifyCards(cardsDir, { claims = [] } = {}) {
  const manifest = JSON.parse(readFileSync(path.join(cardsDir, "cards.json"), "utf8"));
  const results = manifest.map((card) => ({ file: card.file, target: card.target, size: card.size, ...judgeFile(path.join(cardsDir, card.file), card) }));
  await withPage("about:blank", async (session) => {
    for (const [i, card] of manifest.entries()) {
      const html = path.join(cardsDir, "html", card.file.replace(/\.png$/, ".html"));
      if (!existsSync(html)) {
        results[i].warnings.push({ code: "no-html", message: `${card.file} has no HTML source, so its text was not measured.` });
        continue;
      }
      const [width, height] = card.size;
      await session.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
      const loaded = session.once("Page.loadEventFired");
      await session.send("Page.navigate", { url: pathToFileURL(html).href });
      await loaded;
      await session.send("Runtime.evaluate", { expression: "window.__cardReady ?? document.fonts.ready", awaitPromise: true });
      const { result } = await session.send("Runtime.evaluate", { expression: MEASURE, returnByValue: true });
      const measured = result.value.map((t) => {
        const fg = hexOf(t.color), bg = hexOf(t.background);
        return { ...t, fg: fg?.hex, bg: bg?.hex };
      });
      results[i].errors.push(...judgeText(measured, card));
      results[i].measured = measured.length;
    }
  }, { extraArgs: ["--allow-file-access-from-files"] });
  for (const [i, card] of manifest.entries()) results[i].errors.push(...judgeClaims(card.texts ?? [], claims));

  const pdf = path.join(cardsDir, "linkedin-carousel.pdf");
  const extra = existsSync(pdf) && statSync(pdf).size > 100 * MB ? [{ code: "file-too-large", message: "linkedin-carousel.pdf is over LinkedIn's 100 MB document limit." }] : [];
  return { ok: results.every((r) => r.errors.length === 0) && extra.length === 0, cards: results, errors: extra };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const dir = path.resolve(args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--claims") ?? "shipreel-output/cards");
  const claimsFile = args.includes("--claims") ? args[args.indexOf("--claims") + 1] : path.join(dir, "..", "claims.json");
  const claims = existsSync(claimsFile) ? JSON.parse(readFileSync(claimsFile, "utf8")) : [];
  verifyCards(dir, { claims }).then(
    (report) => {
      for (const c of report.cards) {
        const mark = c.errors.length ? "✗" : c.warnings.length ? "!" : "✓";
        console.log(`${mark} ${c.file}  ${c.size.join("x")}  ${Math.round((c.bytes ?? 0) / KB)} KB`);
        for (const e of c.errors) console.log(`    ✗ ${e.code}: ${e.message}`);
        for (const w of c.warnings) console.log(`    ! ${w.code}: ${w.message}`);
      }
      for (const e of report.errors) console.log(`✗ ${e.code}: ${e.message}`);
      console.log(report.ok ? "✓ Cards verified." : "✗ Fix the errors above before posting.");
      if (!report.ok) process.exitCode = 1;
    },
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}
