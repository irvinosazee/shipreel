#!/usr/bin/env node
/**
 * Accessibility variants.
 *
 *   node <skill-root>/scripts/access.mjs reduced-motion <composition-dir>
 *   node <skill-root>/scripts/access.mjs descriptions <scenes.json> --out shipreel.descriptions.vtt
 *
 * `reduced-motion` generates composition-reduced-motion/: a shim loaded right after GSAP
 * strips position, scale, rotation, and skew from every timeline tween, keeping fades,
 * color changes, and timing, so the story and beat locks survive without movement.
 * `descriptions` writes a WebVTT audio-description track from each scene's `description`
 * in scenes.json, for players and platforms that accept one.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadScenes } from "./cuts.mjs";
import { formatTimestamp } from "./captions.mjs";

export const REDUCED_MOTION_SHIM = `
(function (gsap) {
  var MOTION = ["x", "y", "z", "xPercent", "yPercent", "scale", "scaleX", "scaleY", "rotation", "rotate", "rotationX", "rotationY", "skewX", "skewY", "motionPath"];
  function still(vars) {
    if (!vars || typeof vars !== "object") return vars;
    var out = {};
    for (var key in vars) if (MOTION.indexOf(key) === -1) out[key] = vars[key];
    return out;
  }
  var proto = gsap.core.Timeline.prototype;
  ["to", "from", "set"].forEach(function (method) {
    var original = proto[method];
    proto[method] = function (targets, vars) {
      var args = Array.prototype.slice.call(arguments);
      args[1] = still(vars);
      return original.apply(this, args);
    };
  });
  var fromTo = proto.fromTo;
  proto.fromTo = function (targets, fromVars, toVars) {
    var args = Array.prototype.slice.call(arguments);
    args[1] = still(fromVars);
    args[2] = still(toVars);
    return fromTo.apply(this, args);
  };
})(gsap);
`;

export function stampReducedMotion(html) {
  if (html.includes('id="shipreel-reduced-motion"')) return html;
  const gsapTag = html.match(/<script\b[^>]*\bsrc="[^"]*gsap[^"]*"[^>]*><\/script>/i);
  if (!gsapTag) throw new Error("No GSAP script tag found; the reduced-motion shim must load right after GSAP.");
  let out = html.replace(gsapTag[0], `${gsapTag[0]}\n<script id="shipreel-reduced-motion">${REDUCED_MOTION_SHIM}</script>`);
  out = out.replace(/(<[a-z]+\b[^>]*\bdata-composition-id="[^"]*"[^>]*?)(\s*\/?)>/i, (_, open, close) => `${open} data-motion="reduced"${close}>`);
  return out;
}

export function makeReducedMotionVariant(sourceDir) {
  const source = path.resolve(sourceDir);
  const target = path.join(path.dirname(source), `${path.basename(source)}-reduced-motion`);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source)) {
    if (["index.html", "snapshots", "node_modules"].includes(entry)) continue;
    cpSync(path.join(source, entry), path.join(target, entry), { recursive: true, dereference: true });
  }
  writeFileSync(path.join(target, "index.html"), stampReducedMotion(readFileSync(path.join(source, "index.html"), "utf8")));
  writeFileSync(path.join(target, "GENERATED.md"), `# Generated — do not edit\n\nReduced-motion copy of \`${path.basename(source)}/\`, made by \`access.mjs reduced-motion\`. Edit the source and regenerate.\n`);
  return target;
}

export function descriptionsVtt(input) {
  const scenes = loadScenes(input);
  const missing = scenes.filter((scene) => !scene.description?.trim()).map((scene) => scene.name);
  if (missing.length) throw new Error(`${missing.join(", ")} has no description; add a "description" to each scene in scenes.json.`);
  const cues = scenes.map((scene) => `${formatTimestamp(scene.start, "vtt")} --> ${formatTimestamp(scene.end, "vtt")}\n${scene.description.trim()}\n`);
  return `WEBVTT - audio descriptions\n\n${cues.join("\n")}`;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const [command, input, ...rest] = process.argv.slice(2);
  try {
    if (command === "reduced-motion" && input && existsSync(path.join(input, "index.html"))) {
      console.log(makeReducedMotionVariant(input));
    } else if (command === "descriptions" && input && rest[0] === "--out" && rest[1]) {
      writeFileSync(rest[1], descriptionsVtt(input));
      console.log(rest[1]);
    } else {
      console.error("Usage: access.mjs reduced-motion <composition-dir> | descriptions <scenes.json> --out <file.vtt>");
      process.exitCode = 2;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
