#!/usr/bin/env node
/**
 * Launch cards: the still images a launch needs, rendered from the product dossier.
 *
 *   node <skill-root>/scripts/cards.mjs <project-dir> [--out <output-dir>] [--only og,x,github,producthunt,linkedin]
 *
 * | Target      | Size       | Files                                   | For                                  |
 * |-------------|------------|-----------------------------------------|--------------------------------------|
 * | og          | 1200x630   | og.png                                  | link previews (Slack, Discord, iMessage, LinkedIn) |
 * | x           | 1600x900   | x.png                                   | an X post image                      |
 * | github      | 1280x640   | github-social.png                       | GitHub social preview and README hero |
 * | producthunt | 1270x760   | producthunt-1.png ...                   | the Product Hunt gallery             |
 * | linkedin    | 1080x1350  | linkedin-01.png ... + linkedin-carousel.pdf | a LinkedIn document post         |
 *
 * Every card is an HTML page in the project's own palette and fonts, showing the project's real
 * frames (posters, review frames, captures from a /shipreel run), never generated UI. Text is sized
 * to fit its column and kept inside a safe margin. The same dossier gives the same cards.
 *
 * Output goes to <output-dir>/cards/ with cards.json: one entry per image with its size, the
 * images it used, and every line of visible text, which verify_image.mjs audits.
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { contrastRatio } from "./captions.mjs";
import { withPage } from "./chrome.mjs";
import { buildPdf } from "./cuts.mjs";
import { buildDossier } from "./dossier.mjs";
import { fitFontPx } from "./template_video.mjs";

export const CARD_TARGETS = {
  og: { size: [1200, 630], layout: "split", file: () => "og.png" },
  x: { size: [1600, 900], layout: "split", file: () => "x.png" },
  github: { size: [1280, 640], layout: "split", file: () => "github-social.png" },
  producthunt: { size: [1270, 760], layout: "gallery", file: (i) => `producthunt-${i + 1}.png` },
  linkedin: { size: [1080, 1350], layout: "carousel", file: (i) => `linkedin-${String(i + 1).padStart(2, "0")}.png`, pdf: "linkedin-carousel.pdf" },
};

const MAX_FEATURES = 4;
// Inset from every edge, as a share of the short side: platforms crop and round corners.
export const SAFE_MARGIN = 0.07;

const escapeHtml = (text) => String(text ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const host = (url) => {
  try {
    return new URL(url).host.replace(/^www\./, "") + new URL(url).pathname.replace(/\/$/, "");
  } catch {
    return null;
  }
};
const sentence = (text, max = 18) => {
  const words = String(text ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length <= max) return words.join(" ");
  const cut = words.slice(0, max).join(" ");
  const stop = cut.search(/[.!?](?=[^.!?]*$)/);
  return stop > 20 ? cut.slice(0, stop + 1) : `${cut.replace(/[,;:]$/, "")}…`;
};

/** Text and fill colours that pass WCAG: fg on bg at 4.5:1 (else black or white), the accent only where it reaches 3:1. */
export function cardTheme(brand = {}) {
  const p = { bg: "#0f0d15", fg: "#f5f1ea", muted: "#b9b2a8", accent: "#ff6b3d", ...(brand.palette ?? {}) };
  const best = (bg) => (contrastRatio("#000000", bg) >= contrastRatio("#ffffff", bg) ? "#000000" : "#ffffff");
  const fg = contrastRatio(p.fg, p.bg) >= 4.5 ? p.fg : best(p.bg);
  const muted = contrastRatio(p.muted, p.bg) >= 4.5 ? p.muted : fg;
  const accentText = contrastRatio(p.accent, p.bg) >= 3 ? p.accent : fg;
  const onAccent = best(p.accent);
  return { bg: p.bg, fg, muted, accent: p.accent, accentText, onAccent, display: brand.fonts?.display ?? null, body: brand.fonts?.body ?? null, mono: brand.fonts?.mono ?? null, fontFiles: brand.fonts?.files ?? {} };
}

/** Width and height of a PNG or JPEG, read from its header; null for anything else. */
export function imageSize(file) {
  let buf;
  try {
    buf = readFileSync(file);
  } catch {
    return null;
  }
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i + 9 < buf.length; ) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1], len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
      i += 2 + len;
    }
  }
  return null;
}

/** Where a card's copy and image sit. Shared by planning (to pick a well-shaped image) and the HTML. */
export function cardGeometry({ size: [W, H], layout, kind }, hasImage = true) {
  const m = Math.round(Math.min(W, H) * SAFE_MARGIN);
  const gap = Math.round(m * 0.8);
  const portrait = H > W;
  if (kind === "cta" || !hasImage) return { m, gap, portrait, textW: W - 2 * m, media: null };
  if (portrait) {
    const textH = Math.round((H - 2 * m) * (kind === "feature" ? 0.3 : 0.34));
    return { m, gap, portrait, textW: W - 2 * m, textH, media: { w: W - 2 * m, h: H - 2 * m - textH - gap } };
  }
  const textW = Math.round((W - 2 * m - gap) * (layout === "gallery" ? 0.36 : 0.4));
  return { m, gap, portrait, textW, media: { w: W - 2 * m - gap - textW, h: H - 2 * m } };
}

/** The cards to render for each target: specs only (text, images, kind), no layout. */
export function planCards(dossier, { targets = Object.keys(CARD_TARGETS), projectDir = "." } = {}) {
  const { project = {}, highlights = [], media = {} } = dossier;
  const images = [...(media.posters ?? []), ...(media.frames ?? []), ...(media.captures ?? [])]
    .map((f) => path.resolve(projectDir, f))
    .filter((f, i, all) => existsSync(f) && all.indexOf(f) === i)
    .map((file) => ({ file, size: imageSize(file) }))
    .filter((img) => img.size);
  // The i-th best-shaped image for a box. A poster of the right orientation leads (it is the run's chosen
  // best frame); then frames and captures, closest shape first.
  const posters = new Set((media.posters ?? []).map((f) => path.resolve(projectDir, f)));
  const pick = (card, i) => {
    const box = cardGeometry(card).media;
    if (!box || !images.length) return null;
    const miss = (img) => Math.abs(Math.log(img.size[0] / img.size[1] / (box.w / box.h)));
    const best = Math.min(...images.map(miss));
    const rank = (img) => (posters.has(img.file) && miss(img) < 0.7 ? 0 : 1);
    const fits = images.filter((img) => miss(img) <= best + 0.12 || rank(img) === 0).sort((a, b) => rank(a) - rank(b) || miss(a) - miss(b));
    return fits[i % fits.length].file;
  };
  const words = (t) => String(t ?? "").split(/\s+/).filter(Boolean).length;
  const tagline = sentence(project.description && words(project.description) <= 24 ? project.description : project.tagline ?? project.description ?? "", 24);
  const link = host(project.url) ?? host(project.repository);
  // A short link reads as a kicker; a long repository path does not.
  const kicker = link && link.length <= 26 ? link : (project.type && project.type !== "unknown" ? project.type.replace(/-/g, " ") : "introducing");
  // "Label: what it means" becomes a short title over a smaller line; plain bullets stay one title.
  const features = highlights.slice(0, MAX_FEATURES).map((h) => {
    const m = h.match(/^([^:.!?]{3,40}):\s+(.+)$/);
    return m ? { title: m[1].trim(), subtitle: sentence(m[2], 18) } : { title: sentence(h, 12) };
  });
  const cta = { kind: "cta", kicker: "try it", title: project.name, detail: project.install ?? link ?? null, footer: project.install && link ? link : null };
  const hero = { kind: "hero", kicker, title: project.name, subtitle: tagline };

  const cards = [];
  for (const target of targets) {
    const spec = CARD_TARGETS[target];
    if (!spec) throw new Error(`Unknown card target "${target}". Use one of: ${Object.keys(CARD_TARGETS).join(", ")}.`);
    let set = [hero];
    if (spec.layout === "gallery") set = [hero, ...features.map((f) => ({ kind: "feature", kicker: project.name, ...f }))];
    if (spec.layout === "carousel") set = [hero, ...features.map((f, i) => ({ kind: "feature", kicker: `${String(i + 1).padStart(2, "0")} / ${String(features.length).padStart(2, "0")}`, ...f })), cta];
    set.forEach((card, i) => {
      const full = { target, size: spec.size, layout: spec.layout, file: spec.file(i), ...card };
      cards.push({ ...full, image: card.kind === "cta" ? null : pick(full, i) });
    });
  }
  return cards;
}

function fontLinks(theme) {
  const names = [theme.display, theme.body, theme.mono].filter((n, i, all) => n && all.indexOf(n) === i && !theme.fontFiles[n]);
  if (!names.length) return "";
  const families = names.map((n) => `family=${encodeURIComponent(n).replace(/%20/g, "+")}:wght@400;500;700;900`).join("&");
  return `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${families}&display=block" />`;
}

function fontFaces(theme, projectDir) {
  return Object.entries(theme.fontFiles)
    .map(([name, file]) => `@font-face { font-family: "${name}"; src: url("${pathToFileURL(path.resolve(projectDir, file)).href}"); font-weight: 100 900; }`)
    .join("\n");
}

/** One card as a self-contained HTML page. Pure: the same card and theme give the same page. */
export function cardHtml(card, theme, { projectDir = "." } = {}) {
  const [W, H] = card.size;
  const hasImage = Boolean(card.image);
  const { m, gap, portrait, textW, textH } = cardGeometry(card, hasImage);
  const short = Math.min(W, H);
  // Heavy display faces run wider than the estimator assumes.
  const titleFit = fitFontPx(card.title, { width: textW * 0.88, maxPx: Math.round(short * (card.kind === "feature" ? 0.11 : 0.15)), minPx: Math.round(short * 0.06), maxLines: card.kind === "feature" && !card.subtitle ? 3 : 2 });
  const subFit = card.subtitle ? fitFontPx(card.subtitle, { width: textW, maxPx: Math.round(short * 0.05), minPx: Math.round(short * 0.034), maxLines: 4 }) : null;
  const detailFit = card.detail ? fitFontPx(card.detail, { width: (W - 2 * m - 2 * Math.round(short * 0.04)) * 0.78, maxPx: Math.round(short * 0.05), minPx: Math.round(short * 0.03), maxLines: 2 }) : null;
  const small = Math.round(short * 0.034);
  const display = theme.display ? `"${theme.display}", ` : "";
  const body = theme.body ? `"${theme.body}", ` : "";
  const mono = theme.mono ? `"${theme.mono}", ` : "";
  const imgUrl = hasImage ? pathToFileURL(card.image).href : null;
  // The image panel takes the image's own shape inside the space it is given: nothing cropped, no bars.
  let box = null;
  const room = cardGeometry(card, hasImage).media;
  if (hasImage && room) {
    const [iw, ih] = imageSize(card.image) ?? [room.w, room.h];
    const k = Math.min(room.w / iw, room.h / ih);
    box = { w: Math.round(iw * k), h: Math.round(ih * k) };
  }

  const text = [
    card.kicker && `<div class="kicker" data-text>${escapeHtml(card.kicker)}</div>`,
    `<h1 data-text data-fit data-min="${Math.round(short * 0.05)}" style="font-size:${titleFit.px}px">${escapeHtml(titleFit.text)}</h1>`,
    subFit && `<p class="sub" data-text data-fit data-min="${Math.ceil(short * 28 / 1080)}" style="font-size:${subFit.px}px">${escapeHtml(subFit.text)}</p>`,
    detailFit && `<div class="detail" data-text data-fit data-min="${Math.ceil(short * 28 / 1080)}" style="font-size:${detailFit.px}px">${escapeHtml(detailFit.text)}</div>`,
    card.footer && `<div class="footer" data-text>${escapeHtml(card.footer)}</div>`,
  ].filter(Boolean).join("\n      ");

  const media = hasImage ? `<div class="media"><img src="${imgUrl}" alt="" /></div>` : `<div class="bar"></div>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=${W}, height=${H}" />
${fontLinks(theme)}
<style>
${fontFaces(theme, projectDir)}
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: ${theme.bg}; }
body { position: relative; font-family: ${body}system-ui, sans-serif; color: ${theme.fg}; -webkit-font-smoothing: antialiased; }
.glow { position: absolute; inset: 0; background: radial-gradient(60% 70% at ${portrait ? "50% 100%" : "100% 50%"}, ${theme.accent}22, transparent 65%); }
.frame { position: absolute; left: ${m}px; top: ${m}px; width: ${W - 2 * m}px; height: ${H - 2 * m}px; display: ${portrait ? "flex" : "grid"}; ${portrait ? `flex-direction: column; gap: ${gap}px;` : `grid-template-columns: ${hasImage && card.kind !== "cta" ? `${textW}px 1fr` : "1fr"}; gap: ${gap}px; align-items: center;`} }
.copy { ${portrait && textH && card.kind !== "cta" ? `height: ${textH}px; flex: none;` : ""} display: flex; flex-direction: column; justify-content: ${card.kind === "cta" ? "center" : portrait ? "flex-start" : "center"}; gap: ${Math.round(short * 0.025)}px; ${card.kind === "cta" ? "height: 100%;" : ""} }
.kicker { font-family: ${mono}ui-monospace, monospace; font-size: ${small}px; letter-spacing: 0.12em; text-transform: uppercase; color: ${theme.accentText}; }
h1 { overflow-wrap: normal; word-break: keep-all; font-family: ${display}system-ui, sans-serif; font-weight: 800; line-height: 1.02; letter-spacing: -0.035em; color: ${theme.fg}; }
.sub { line-height: 1.3; color: ${theme.muted}; max-width: ${textW}px; }
.detail { align-self: flex-start; max-width: 100%; overflow-wrap: anywhere; font-family: ${mono}ui-monospace, monospace; font-weight: 500; padding: ${Math.round(short * 0.03)}px ${Math.round(short * 0.04)}px; border-radius: ${Math.round(short * 0.025)}px; background: ${theme.accent}; color: ${theme.onAccent}; }
.footer { font-family: ${mono}ui-monospace, monospace; font-size: ${small}px; color: ${theme.muted}; }
.media { position: relative; ${box ? `width: ${box.w}px; height: ${box.h}px; flex: none;` : ""} ${portrait ? "align-self: center; margin: auto 0;" : "justify-self: center;"} border-radius: ${Math.round(short * 0.03)}px; overflow: hidden; box-shadow: 0 ${Math.round(short * 0.03)}px ${Math.round(short * 0.08)}px rgba(0,0,0,0.35), 0 0 0 1px ${theme.fg}1f; }
.media img { width: 100%; height: 100%; object-fit: contain; display: block; }
.bar { width: ${Math.round(short * 0.16)}px; height: ${Math.round(short * 0.018)}px; border-radius: 999px; background: ${theme.accent}; }
</style>
</head>
<body>
  <div class="glow"></div>
  <div class="frame">
    <div class="copy">
      ${text}
    </div>
    ${card.kind === "cta" ? "" : media}
  </div>
<script>
// The estimate above is a first guess; the real font decides. Shrink each text 2px at a time until no
// word is wider than its column and the copy fits beside or above the image. Deterministic for a given font.
window.__cardReady = document.fonts.ready.then(() => {
  const copy = document.querySelector(".copy"), media = document.querySelector(".media");
  const clash = () => {
    if (copy.scrollHeight > copy.clientHeight + 1 && getComputedStyle(copy).height !== "auto") return true;
    if (!media) return false;
    const a = copy.getBoundingClientRect(), b = media.getBoundingClientRect();
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  };
  const shrink = (el, until) => {
    const min = Number(el.dataset.min);
    let px = parseFloat(getComputedStyle(el).fontSize);
    while (px > min && until()) el.style.fontSize = (px -= 2) + "px";
  };
  const fits = [...document.querySelectorAll("[data-fit]")];
  // First every line fits its own width; then, if the copy still crowds the image, the supporting
  // lines give way before the title does.
  for (const el of fits) shrink(el, () => el.scrollWidth > el.clientWidth + 1);
  for (const el of [...fits].reverse()) shrink(el, clash);
});
</script>
</body>
</html>
`;
}

/** Every line a card shows, for verify_image.mjs. */
export function cardTexts(card) {
  return [card.kicker, card.title, card.subtitle, card.detail, card.footer].filter(Boolean);
}

/** Render every planned card to PNG (and the LinkedIn carousel to a PDF) under <outDir>/cards/. */
export async function renderCards(dossier, { projectDir, outDir, targets } = {}) {
  const dir = path.join(outDir, "cards");
  const htmlDir = path.join(dir, "html");
  mkdirSync(htmlDir, { recursive: true });
  const theme = cardTheme(dossier.brand);
  const cards = planCards(dossier, { targets, projectDir });
  for (const card of cards) writeFileSync(path.join(htmlDir, card.file.replace(/\.png$/, ".html")), cardHtml(card, theme, { projectDir }));

  const manifest = [];
  const pdfPages = [];
  await withPage("about:blank", async (session) => {
    for (const card of cards) {
      const [width, height] = card.size;
      await session.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
      const loaded = session.once("Page.loadEventFired");
      await session.send("Page.navigate", { url: pathToFileURL(path.join(htmlDir, card.file.replace(/\.png$/, ".html"))).href });
      await loaded;
      // Web fonts and images must be ready before the shot, or the card renders in a fallback face.
      await session.send("Runtime.evaluate", { expression: "Promise.all([window.__cardReady, ...[...document.images].map((i) => i.decode().catch(() => {}))])", awaitPromise: true });
      const clip = { x: 0, y: 0, width, height, scale: 1 };
      const { data } = await session.send("Page.captureScreenshot", { format: "png", clip });
      writeFileSync(path.join(dir, card.file), Buffer.from(data, "base64"));
      if (CARD_TARGETS[card.target].pdf) {
        const jpeg = await session.send("Page.captureScreenshot", { format: "jpeg", quality: 92, clip });
        pdfPages.push({ data: Buffer.from(jpeg.data, "base64"), width, height });
      }
      manifest.push({ file: card.file, target: card.target, kind: card.kind, size: card.size, texts: cardTexts(card), images: card.image ? [path.relative(projectDir, card.image)] : [], theme: { bg: theme.bg, fg: theme.fg, muted: theme.muted, accentText: theme.accentText, onAccent: theme.onAccent, accent: theme.accent } });
    }
  }, { extraArgs: ["--allow-file-access-from-files"] });

  if (pdfPages.length) writeFileSync(path.join(dir, CARD_TARGETS.linkedin.pdf), buildPdf(pdfPages));
  // Re-rendering some targets keeps the other targets' entries.
  const manifestFile = path.join(dir, "cards.json");
  const done = new Set(cards.map((c) => c.target));
  const kept = targets && existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")).filter((c) => !done.has(c.target)) : [];
  const order = Object.keys(CARD_TARGETS);
  const all = [...kept, ...manifest].sort((a, b) => order.indexOf(a.target) - order.indexOf(b.target));
  writeFileSync(manifestFile, `${JSON.stringify(all, null, 2)}\n`);
  return { dir, cards: manifest, pdf: pdfPages.length ? path.join(dir, CARD_TARGETS.linkedin.pdf) : null };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const projectDir = path.resolve(args.find((a, i) => !a.startsWith("--") && !(i > 0 && ["--out", "--only"].includes(args[i - 1]))) ?? ".");
  const outDir = path.resolve(projectDir, flag("--out") ?? "shipreel-output");
  const targets = flag("--only")?.split(",").map((t) => t.trim()).filter(Boolean);
  const dossierFile = path.join(outDir, "dossier.json");
  const dossier = existsSync(dossierFile) ? JSON.parse(readFileSync(dossierFile, "utf8")) : buildDossier(projectDir, { outDir });
  renderCards(dossier, { projectDir, outDir, targets }).then(
    ({ dir, cards, pdf }) => {
      for (const c of cards) console.log(`${c.file}  ${c.size.join("x")}`);
      if (pdf) console.log(path.basename(pdf));
      console.error(`wrote ${cards.length} card(s) to ${dir}`);
    },
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}
