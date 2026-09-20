#!/usr/bin/env node
/**
 * Hook tournament: render a still of several hook variants side by side before committing to one.
 *
 *   node <skill-root>/scripts/hooks.mjs tournament <composition-dir> --variants hooks.json --at 1.6
 *
 * The composition marks its hook with <!-- shipreel:hook:start --> ... <!-- shipreel:hook:end -->.
 * hooks.json is [{ "id": "question", "html": "<h1>...</h1>" }, ...]. For each variant this writes
 * <composition-dir>-hook-<id>/ with the hook region replaced, snapshots it at --at with
 * `npx hyperframes snapshot`, and tiles the stills into <output-dir>/hooks/sheet.jpg in variant
 * order, so the choice can be made by looking at real frames.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOOK_REGION = /(<!-- shipreel:hook:start -->)[\s\S]*?(<!-- shipreel:hook:end -->)/;

export function replaceHook(html, hookHtml) {
  if (!HOOK_REGION.test(html)) throw new Error("No hook region found; wrap the hook in <!-- shipreel:hook:start --> and <!-- shipreel:hook:end -->.");
  return html.replace(HOOK_REGION, (_, start, end) => `${start}\n${hookHtml}\n${end}`);
}

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${cmd} ${args[0]} failed: ${(result.stderr || result.stdout || "").trim().split("\n").slice(-3).join(" ")}`);
  return result.stdout;
}

export function tournament(compositionDir, variants, { at }) {
  const source = path.resolve(compositionDir);
  const html = readFileSync(path.join(source, "index.html"), "utf8");
  const outDir = path.join(path.dirname(source), "hooks");
  mkdirSync(outDir, { recursive: true });

  const stills = variants.map((variant) => {
    const dir = `${source}-hook-${variant.id}`;
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    for (const entry of readdirSync(source)) {
      if (["index.html", "snapshots", "node_modules"].includes(entry)) continue;
      cpSync(path.join(source, entry), path.join(dir, entry), { recursive: true, dereference: true });
    }
    writeFileSync(path.join(dir, "index.html"), replaceHook(html, variant.html));
    run("npx", ["hyperframes", "snapshot", "--at", String(at)], dir);
    const frame = readdirSync(path.join(dir, "snapshots")).find((name) => /^frame-.*\.png$/.test(name));
    if (!frame) throw new Error(`No snapshot produced for hook "${variant.id}".`);
    const still = path.join(outDir, `${variant.id}.png`);
    copyFileSync(path.join(dir, "snapshots", frame), still);
    return { id: variant.id, still, dir };
  });

  const inputs = stills.flatMap((s) => ["-i", s.still]);
  const filter = `${stills.map((_, i) => `[${i}:v]scale=540:-2[s${i}]`).join(";")};${stills.map((_, i) => `[s${i}]`).join("")}hstack=inputs=${stills.length}[out]`;
  const sheet = path.join(outDir, "sheet.jpg");
  if (stills.length === 1) run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", stills[0].still, "-vf", "scale=540:-2", sheet]);
  else run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...inputs, "-filter_complex", filter, "-map", "[out]", "-frames:v", "1", sheet]);
  return { sheet, stills };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const [command, dir, ...rest] = process.argv.slice(2);
  const flag = (name) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined);
  if (command !== "tournament" || !dir || !existsSync(path.join(dir, "index.html")) || !flag("--variants")) {
    console.error("Usage: hooks.mjs tournament <composition-dir> --variants hooks.json --at <seconds>");
    process.exitCode = 2;
  } else {
    try {
      console.log(JSON.stringify(tournament(dir, JSON.parse(readFileSync(flag("--variants"), "utf8")), { at: Number(flag("--at") ?? 1.5) }), null, 2));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
