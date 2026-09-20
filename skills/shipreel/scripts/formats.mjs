#!/usr/bin/env node
/**
 * One composition, every frame shape.
 *
 *   node <skill-root>/scripts/formats.mjs stamp <composition-dir> --formats vertical,landscape,feed
 *
 * Hyperframes fixes a composition's frame size at compile time, so each shape needs
 * its own directory. The source composition stays the only thing anyone edits: it
 * carries every format's layout as `[data-format="<format>"]` CSS rules, and this
 * script generates `composition-<format>/` beside it with the root size, viewport,
 * `data-resolution`, and `data-format` stamped in and the assets copied. The timeline
 * is shared, so scene timing and beat locks stay identical across formats.
 *
 * Source contract: size the page from the stamp (do not rely on hardcoded body
 * sizes surviving; the stamp's style comes last and wins), and read
 * `root.dataset.format` in scripts when motion differs by format.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FORMATS = {
  landscape: { size: [1920, 1080], resolution: "landscape" },
  vertical: { size: [1080, 1920], resolution: "portrait" },
  square: { size: [1080, 1080], resolution: "square" },
  feed: { size: [1080, 1350], resolution: "feed" },
};

const ROOT_TAG = /<([a-z]+)\b([^>]*\bdata-composition-id="[^"]*"[^>]*)>/i;

function rootAttributes(html) {
  const match = html.match(ROOT_TAG);
  if (!match) throw new Error("No element with data-composition-id found; is this a Hyperframes composition?");
  return match;
}

export function detectFormat(html) {
  const [, , attrs] = rootAttributes(html);
  const width = Number(attrs.match(/\bdata-width="(\d+)"/)?.[1]);
  const height = Number(attrs.match(/\bdata-height="(\d+)"/)?.[1]);
  return Object.entries(FORMATS).find(([, f]) => f.size[0] === width && f.size[1] === height)?.[0] ?? null;
}

export function stampHtml(html, format) {
  const target = FORMATS[format];
  if (!target) throw new Error(`Unknown format "${format}". Use one of: ${Object.keys(FORMATS).join(", ")}.`);
  const [width, height] = target.size;

  const [tag, name, attrs] = rootAttributes(html);
  let rootAttrs = attrs
    .replace(/\bdata-width="\d+"/, `data-width="${width}"`)
    .replace(/\bdata-height="\d+"/, `data-height="${height}"`)
    .replace(/\s+data-format="[^"]*"/, "");
  rootAttrs = `${rootAttrs.replace(/\s+$/, "")} data-format="${format}"`;
  let out = html.replace(tag, `<${name}${rootAttrs}>`);

  out = out.replace(/(<html\b[^>]*?)\s+data-resolution="[^"]*"/i, "$1");
  out = out.replace(/<html\b([^>]*)>/i, (_, rest) => `<html${rest} data-resolution="${target.resolution}">`);
  out = out.replace(/<meta name="viewport" content="[^"]*"\s*\/?>/i, `<meta name="viewport" content="width=${width}, height=${height}" />`);

  // Rewrite pixel sizes in the source's html/body rules too; `hyperframes lint` reads those statically.
  out = out.replace(/(\bhtml\s*,\s*body\s*\{)([^}]*)\}/g, (_, open, body) =>
    `${open}${body.replace(/\bwidth:\s*\d+px/, `width: ${width}px`).replace(/\bheight:\s*\d+px/, `height: ${height}px`)}}`,
  );
  out = out.replace(/\s*<style id="shipreel-format">[\s\S]*?<\/style>/, "");
  out = out.replace(/\n?(\s*)<\/head>/i, `\n    <style id="shipreel-format">html, body { width: ${width}px; height: ${height}px; }</style>\n  </head>`);
  return out;
}

export function stampFormats(sourceDir, formats) {
  const indexPath = path.join(sourceDir, "index.html");
  const html = readFileSync(indexPath, "utf8");
  const own = detectFormat(html);
  const parent = path.dirname(path.resolve(sourceDir));
  const base = path.basename(path.resolve(sourceDir));

  return formats.map((format) => {
    if (format === own) {
      const stamped = stampHtml(html, own);
      if (stamped !== html) writeFileSync(indexPath, stamped);
      return { format, dir: sourceDir, generated: false };
    }
    const dir = path.join(parent, `${base}-${format}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    for (const entry of readdirSync(sourceDir)) {
      if (entry === "index.html" || entry === "snapshots" || entry === "node_modules") continue;
      cpSync(path.join(sourceDir, entry), path.join(dir, entry), { recursive: true, dereference: true });
    }
    writeFileSync(path.join(dir, "index.html"), stampHtml(html, format));
    writeFileSync(
      path.join(dir, "GENERATED.md"),
      `# Generated — do not edit\n\nThis is the ${format} (${FORMATS[format].size.join("x")}) copy of \`${base}/\`, made by \`formats.mjs stamp\`.\nEdit \`${base}/index.html\` (use \`[data-format="${format}"]\` rules for this shape) and re-stamp.\n`,
    );
    return { format, dir, generated: true };
  });
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const [command, dir, flag, list] = process.argv.slice(2);
  if (command !== "stamp" || !dir || flag !== "--formats" || !list || !existsSync(path.join(dir, "index.html"))) {
    console.error("Usage: formats.mjs stamp <composition-dir> --formats vertical,landscape,feed");
    process.exitCode = 2;
  } else {
    try {
      console.log(JSON.stringify(stampFormats(dir, list.split(",").map((f) => f.trim())), null, 2));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
