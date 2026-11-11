#!/usr/bin/env node
/**
 * Campaign content: everything one piece needs to be posted, written into its own folder.
 *
 * For each piece angles.mjs planned (platform, angle, kind, hook, beats, call to action):
 *
 *   caption.txt    the post text, in the platform's shape and within its limit
 *   hashtags.txt   a small, relevant set: the product's own tag plus what the project is about
 *   alt.txt        alt text for every image, for screen readers and search
 *   post.json      title, description, link, posting window, the platform's limits, and the files
 *   video          content.json for the card-video engine (template_video.mjs), then video.mp4 and cover.png
 *   carousel       slide-NN.png from cards.mjs (plus carousel.pdf on LinkedIn, a document post)
 *   story          frame-NN.png, 1080x1920, clear of the profile row and the reply bar
 *   post / thread  the text (thread.txt numbered, each post within X's 280) and one image
 *
 * Images are the run's own scene stills, review frames and captures (the dossier's media), never
 * generated UI. The words come from the brief and the plan; with an agent, /shipreel max rewrites
 * captions and hashtags in the brief's tone before anything renders.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { buildPdf } from "./cuts.mjs";
import { PIECE_SIZES, cardGeometry, imagePrint, imageSize, renderCardSet, samePicture } from "./cards.mjs";
import { xLength } from "./copy_check.mjs";
import { finishVideo, renderComposition } from "./deliver.mjs";
import { DEFAULT_MUSIC, writeCardProject } from "./template_video.mjs";

// Each platform's caption limit and hashtag range, from its own documentation.
export const PLATFORM_RULES = {
  tiktok: { caption: 2200, hashtags: [3, 5], video: "vertical", window: "7pm to 10pm, the audience's local time" },
  instagram: { caption: 2200, hashtags: [3, 5], video: "vertical", window: "11am to 1pm or 7pm to 9pm, the audience's local time" },
  "youtube-shorts": { caption: 5000, title: 100, hashtags: [2, 3], video: "vertical", window: "12pm to 3pm, the audience's local time" },
  linkedin: { caption: 3000, hashtags: [2, 3], video: "feed", window: "Tuesday to Thursday, 7:30am to 9am, the audience's local time" },
  x: { caption: 280, hashtags: [0, 2], video: "landscape", window: "8am to 10am or 12pm to 1pm, the audience's local time" },
};

const tag = (t) => `#${String(t).replace(/[^\p{L}\p{N}]+/gu, "")}`;
const strip = (t) => String(t ?? "").trim();
const linkFrom = (cta) => strip(cta).replace(/^try it:\s*/i, "");

/** A small, relevant hashtag set for one platform: the product's own tag, then the brief's (which the user owns). */
export function hashtagsFor(platform, dossier, brief = null) {
  const [, max] = PLATFORM_RULES[platform].hashtags;
  const p = dossier.project ?? {};
  const topics = brief?.hashtags?.value ?? [];
  const tags = [tag(p.name ?? "launch"), ...topics.map(tag)];
  if (platform === "youtube-shorts") tags.splice(1, 0, "#shorts");
  return [...new Set(tags.map((t) => t.toLowerCase() === tag(p.name).toLowerCase() ? tag(p.name) : t))].slice(0, max);
}

/** The post text for one piece, shaped for its platform. X posts and threads are built in xPosts. */
export function captionFor(piece, { hashtags = [] } = {}) {
  const body = piece.beats.slice(1).filter((b) => b && b !== piece.hook);
  const link = linkFrom(piece.cta);
  const tags = hashtags.join(" ");
  if (piece.platform === "linkedin") {
    return [piece.hook, body.map((b) => `→ ${b}`).join("\n"), piece.cta, tags].filter(Boolean).join("\n\n");
  }
  if (piece.platform === "youtube-shorts") return [piece.hook, ...body, link, tags].filter(Boolean).join("\n\n");
  // TikTok and Instagram: a short caption; the hook is on screen, so the caption adds the payoff and the link.
  return [piece.hook, body[0], `${piece.cta}${piece.platform === "instagram" && /^https?:/.test(link) ? " (link in bio)" : ""}`, tags].filter(Boolean).join("\n\n");
}

/** X: a post, or a thread whose every post (with its "1/3" counter) fits 280 as X counts it. */
export function xPosts(piece, { hashtags = [] } = {}) {
  const tags = hashtags.join(" ");
  const fit = (t) => (xLength(t) <= 280 ? t : t.slice(0, 276).replace(/\s+\S*$/, "") + "…");
  if (piece.kind !== "thread") {
    const one = [piece.hook, piece.beats[1], piece.cta, tags].filter(Boolean).join("\n\n");
    return [xLength(one) <= 280 ? one : fit([piece.hook, piece.cta].filter(Boolean).join("\n\n"))];
  }
  const parts = [piece.hook, ...piece.beats.slice(1).filter((b) => b !== piece.hook), [piece.cta, tags].filter(Boolean).join("\n\n")].filter(Boolean);
  return parts.map((p, i) => fit(`${i + 1}/${parts.length}\n${p}`));
}

const prints = new Map();
const printOf = (file) => {
  if (!prints.has(file)) prints.set(file, imagePrint(file));
  return prints.get(file);
};

/**
 * The images a piece shows, from the run's own media: those whose shape fits the card's image box,
 * near-duplicates removed (imagePrint), starting at a different one per piece so pieces differ.
 */
function mediaFor(dossier, projectDir, offset, count, card = null) {
  const m = dossier.media ?? {};
  let pool = [...(m.stills ?? []), ...(m.frames ?? []), ...(m.captures ?? []), ...(m.posters ?? [])]
    .map((f) => path.resolve(projectDir, f))
    .map((file) => ({ file, size: imageSize(file) }))
    .filter((img) => img.size);
  if (!pool.length) return Array.from({ length: count }, () => null);
  const box = card ? cardGeometry({ ...card, kind: "hero" }).media : null;
  if (box) {
    const miss = (img) => Math.abs(Math.log(img.size[0] / img.size[1] / (box.w / box.h)));
    const best = Math.min(...pool.map(miss));
    pool = pool.filter((img) => miss(img) <= best + 0.35);
  }
  const distinct = [];
  for (const img of pool) if (!distinct.some((d) => samePicture(printOf(d.file), printOf(img.file)))) distinct.push(img);
  return Array.from({ length: count }, (_, i) => distinct[(offset + i) % distinct.length].file);
}

// A slide holds a short line as its title; a long one becomes body text under a big slide number.
const slide = (text, number) => (String(text).split(/\s+/).length <= 9 ? { title: text } : { title: number, subtitle: text });
const shortLink = (l) => String(l).replace(/^https?:\/\//, "").replace(/\/$/, "");

/** Card specs for a piece's images: carousel slides, story frames, a post image, or a video cover. */
export function cardsFor(piece, { dossier, projectDir = "." }) {
  const shape = piece.kind === "story" || piece.kind === "video" ? PIECE_SIZES.story : piece.platform === "x" ? PIECE_SIZES.landscape : PIECE_SIZES.feed;
  const name = dossier.project?.name;
  const base = { target: piece.platform, size: shape.size, layout: shape.layout, ...(shape.insets ? { insets: shape.insets } : {}) };
  const link = shortLink(linkFrom(piece.cta));
  if (piece.kind === "carousel") {
    const body = piece.beats.slice(1).filter((b) => b !== piece.hook);
    const images = mediaFor(dossier, projectDir, piece.n, body.length + 1, base);
    return [
      { ...base, file: "slide-01.png", kind: "hero", kicker: name, title: piece.hook, image: images[0] },
      ...body.map((b, i) => ({ ...base, file: `slide-${String(i + 2).padStart(2, "0")}.png`, kind: "feature", kicker: `${String(i + 1).padStart(2, "0")} / ${String(body.length).padStart(2, "0")}`, ...slide(b, String(i + 1).padStart(2, "0")), image: images[i + 1] })),
      { ...base, file: `slide-${String(body.length + 2).padStart(2, "0")}.png`, kind: "cta", kicker: "try it", title: name, detail: link },
    ];
  }
  if (piece.kind === "story") {
    const images = mediaFor(dossier, projectDir, piece.n, 2, base);
    return [
      { ...base, file: "frame-01.png", kind: "hero", kicker: name, title: piece.hook, image: images[0] },
      { ...base, file: "frame-02.png", kind: "feature", kicker: name, ...slide(piece.beats[1] ?? piece.hook, "02"), image: images[1] },
      { ...base, file: "frame-03.png", kind: "cta", kicker: "try it", title: name, detail: link },
    ];
  }
  const [image] = mediaFor(dossier, projectDir, piece.n, 1, base);
  return [{ ...base, file: piece.kind === "video" ? "cover.png" : "image.png", kind: "hero", kicker: name, title: piece.hook, image }];
}

/** Alt text for each image: what it says and what it shows. */
export function altFor(cards, { dossier }) {
  const what = (c) => (c.image ? `over a screen from ${dossier.project?.name}` : "on a plain background");
  return cards.map((c) => `${c.file}: "${[c.title, c.subtitle, c.detail].filter(Boolean).join(" ")}" ${c.kind === "cta" ? "with the link to try it" : what(c)}.`).join("\n");
}

/** The card-video engine's input for a video piece: the hook, the beats as highlights, the run's stills. */
export function videoContent(piece, { dossier, projectDir = ".", theme }) {
  const body = piece.beats.slice(1).filter((b) => b !== piece.hook);
  const shots = mediaFor(dossier, projectDir, piece.n, 2).filter(Boolean);
  return {
    kicker: dossier.project?.name,
    title: piece.hook,
    subtitle: body[0],
    screenshots: shots.map((file, i) => ({ file, caption: body[i + 1] ?? body[0] ?? dossier.project?.name })),
    highlights: body.length > 1 ? { heading: dossier.project?.name, items: body.slice(1, 4) } : undefined,
    outro: { line: dossier.project?.name, detail: linkFrom(piece.cta) },
    theme: theme ? { bg: theme.bg, fg: theme.fg, muted: theme.muted, accent: theme.accent } : undefined,
  };
}

/** post.json for one piece. */
export function postMeta(piece, { files, hashtags }) {
  const rules = PLATFORM_RULES[piece.platform];
  return {
    platform: piece.platform,
    piece: piece.id,
    angle: piece.angle,
    why: piece.why,
    kind: piece.kind,
    format: piece.kind === "video" ? rules.video : piece.format,
    hook: piece.hook,
    title: piece.platform === "youtube-shorts" ? piece.hook.slice(0, rules.title) : piece.hook,
    link: linkFrom(piece.cta),
    hashtags,
    postingWindow: rules.window,
    limits: { caption: rules.caption, hashtags: rules.hashtags, ...(rules.title ? { title: rules.title } : {}) },
    files,
  };
}

/**
 * Write a piece's text files and return what it still needs rendered. Pure apart from writing into `dir`.
 * The returned `cards` render with renderCardSet and `video` with renderPieceVideo.
 */
export function writePiece(piece, { dossier, brief = null, projectDir = ".", theme, dir }) {
  mkdirSync(dir, { recursive: true });
  const hashtags = hashtagsFor(piece.platform, dossier, brief);
  const cards = cardsFor(piece, { dossier, projectDir });
  const files = [];
  const put = (name, text) => {
    writeFileSync(path.join(dir, name), `${text.trim()}\n`);
    files.push(name);
  };
  if (piece.platform === "x") {
    const posts = xPosts(piece, { hashtags });
    put(piece.kind === "thread" ? "thread.txt" : "caption.txt", posts.join("\n\n"));
  } else put("caption.txt", captionFor(piece, { hashtags }));
  put("hashtags.txt", hashtags.join("\n"));
  put("alt.txt", altFor(cards, { dossier }));
  let video = null;
  if (piece.kind === "video") {
    video = { content: videoContent(piece, { dossier, projectDir, theme }), format: PLATFORM_RULES[piece.platform].video };
    put("content.json", JSON.stringify(video.content, null, 2));
    files.push("video.mp4");
  }
  files.push(...cards.map((c) => c.file));
  if (piece.kind === "carousel" && piece.platform === "linkedin") files.push("carousel.pdf");
  put("post.json", JSON.stringify(postMeta(piece, { files: files.filter((f) => f !== "post.json"), hashtags }), null, 2));
  return { cards, video, hashtags };
}

/** Render a piece's images (and, for a LinkedIn carousel, its PDF). */
export async function renderPieceCards(piece, cards, { theme, projectDir = ".", dir }) {
  const pdf = piece.kind === "carousel" && piece.platform === "linkedin";
  const { manifest, pdfPages } = await renderCardSet(cards, theme, { dir, projectDir, pdf: () => pdf });
  if (pdf && pdfPages.length) writeFileSync(path.join(dir, "carousel.pdf"), buildPdf(pdfPages));
  writeFileSync(path.join(dir, "cards.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/** Render a video piece through the card-video engine: composition, render, loudness, baked poster. */
export function renderPieceVideo(video, { projectDir = ".", dir, music = DEFAULT_MUSIC }) {
  const compositionDir = path.join(dir, "composition");
  const { plan } = writeCardProject(video.content, { outDir: compositionDir, format: video.format, theme: video.content.theme, music, baseDir: projectDir });
  const output = path.join(dir, "video.mp4");
  renderComposition(compositionDir, { output });
  finishVideo(output, { posterAt: Math.min(plan.duration - 0.5, plan.scenes[0]?.duration ? plan.scenes[0].duration * 0.8 : 1.5), poster: path.join(dir, "video-poster.jpg") });
  return output;
}
