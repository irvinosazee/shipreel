#!/usr/bin/env node
/**
 * Stage the standalone `brag-video` npm package from this repo, and optionally pack it.
 *
 *   node scripts/pack-cli.mjs [--out dist/brag-video] [--pack]
 *
 * The package mirrors the repo layout (skills/brag/…) so the CLI resolves its scripts and assets
 * the same way in both places. --pack runs `npm pack` into dist/. This never publishes: to
 * release, check the tarball, then run `npm publish dist/brag-video` yourself.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const EXCLUDE = /(^|\/)(__pycache__|\.venv|\.pytest_cache|node_modules)(\/|$)|\.pyc$|\.DS_Store$/;
export const PACKAGE_NAME = "brag-video";

export function packageJson() {
  const plugin = JSON.parse(readFileSync(path.join(ROOT, ".claude-plugin", "plugin.json"), "utf8"));
  return {
    name: PACKAGE_NAME,
    version: plugin.version,
    description: "Launch videos, release videos, and PR previews for your projects, rendered with Hyperframes. The standalone CLI of the /brag skill.",
    type: "module",
    bin: { [PACKAGE_NAME]: "skills/brag/scripts/brag_cli.mjs" },
    files: ["skills/brag", "README.md", "LICENSE"],
    engines: { node: ">=22" },
    license: plugin.license,
    author: plugin.author.name,
    homepage: plugin.homepage,
    repository: { type: "git", url: `git+${plugin.repository}.git` },
    keywords: ["video", "launch", "release", "hyperframes", "cli"],
  };
}

const README = `# brag-video

Launch videos for your projects, without a coding agent. The standalone CLI of [/brag](https://github.com/irvinosazee/brag).

\`\`\`bash
npx brag-video make                 # a launch video for the project in this folder
npx brag-video release --tag v1.2.0 # a release video from git history
npx brag-video kit brag-output      # videos, covers, captions, and embeds in one folder
npx brag-video embed . --video brag-output/brag.mp4 --poster brag-output/brag.jpg
npx brag-video github install release
npx brag-video --help
\`\`\`

Needs Node 22+, FFmpeg, and Chrome. Rendering runs \`npx hyperframes\`. Nothing is uploaded or posted anywhere.

With Claude Code, Codex, or another coding agent, install the /brag skill instead: it writes a video made for your project rather than filling a template.
`;

export function stageCli(out = path.join(ROOT, "dist", PACKAGE_NAME)) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  // dereference: .claude/skills/brag style symlinks must become real files in the package.
  cpSync(path.join(ROOT, "skills", "brag"), path.join(out, "skills", "brag"), {
    recursive: true,
    dereference: true,
    filter: (source) => !EXCLUDE.test(path.relative(ROOT, source).split(path.sep).join("/")),
  });
  cpSync(path.join(ROOT, "LICENSE"), path.join(out, "LICENSE"));
  writeFileSync(path.join(out, "README.md"), README);
  writeFileSync(path.join(out, "package.json"), `${JSON.stringify(packageJson(), null, 2)}\n`);
  return out;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const out = args.includes("--out") ? path.resolve(args[args.indexOf("--out") + 1]) : undefined;
  const staged = stageCli(out);
  console.log(`staged ${staged}`);
  if (args.includes("--pack")) {
    const dest = path.dirname(staged);
    const result = spawnSync("npm", ["pack", "--pack-destination", dest], { cwd: staged, encoding: "utf8" });
    if (result.status !== 0) {
      console.error(result.stderr);
      process.exitCode = 1;
    } else {
      const tarball = path.join(dest, result.stdout.trim().split("\n").at(-1));
      console.log(`packed ${tarball}${existsSync(tarball) ? "" : " (missing?)"}`);
      console.log(`Not published. To publish: npm publish ${staged}`);
    }
  }
}
