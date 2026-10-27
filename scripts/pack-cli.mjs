#!/usr/bin/env node
/**
 * Stage the standalone `@irvinosazee/shipreel` npm package from this repo, and optionally pack it.
 *
 *   node scripts/pack-cli.mjs [--out dist/shipreel] [--pack]
 *
 * The package mirrors the repo layout (skills/shipreel/…) so the CLI resolves its scripts and assets
 * the same way in both places. --pack runs `npm pack` into dist/. This never publishes: to
 * release, check the tarball, then run `npm publish dist/shipreel` yourself.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const EXCLUDE = /(^|\/)(__pycache__|\.venv|\.pytest_cache|node_modules)(\/|$)|\.pyc$|\.DS_Store$/;
// Scoped because the unscoped `shipreel` on npm belongs to someone else. The command stays `shipreel`.
export const PACKAGE_NAME = "@irvinosazee/shipreel";
export const BIN_NAME = "shipreel";

export function packageJson() {
  const plugin = JSON.parse(readFileSync(path.join(ROOT, ".claude-plugin", "plugin.json"), "utf8"));
  return {
    name: PACKAGE_NAME,
    version: plugin.version,
    description: "Launch videos, release videos, and PR previews for your projects, rendered with Hyperframes. The standalone CLI of the /shipreel skill.",
    type: "module",
    bin: { [BIN_NAME]: "skills/shipreel/scripts/cli.mjs" },
    files: ["skills/shipreel", "README.md", "LICENSE"],
    engines: { node: ">=22" },
    license: plugin.license,
    author: plugin.author.name,
    homepage: plugin.homepage,
    repository: { type: "git", url: `git+${plugin.repository}.git` },
    keywords: ["video", "launch", "release", "hyperframes", "cli", "claude-code", "skill"],
    publishConfig: { access: "public" },
  };
}

const README = `# @irvinosazee/shipreel

Launch videos for your projects. Free and open source: [github.com/irvinosazee/shipreel](https://github.com/irvinosazee/shipreel).

\`\`\`bash
npx @irvinosazee/shipreel skill install   # the /shipreel skill, for Claude Code
npx @irvinosazee/shipreel make            # or: a launch video for this folder, no agent needed
\`\`\`

Installed globally (\`npm i -g @irvinosazee/shipreel\`), the command is \`shipreel\`:

\`\`\`bash
shipreel release --tag v1.2.0              # a release video from git history
shipreel kit shipreel-output               # videos, covers, captions, and embeds in one folder
shipreel embed . --video shipreel-output/shipreel.mp4 --poster shipreel-output/shipreel.jpg
shipreel github install release
shipreel --help
\`\`\`

Needs Node 22+, FFmpeg, and Chrome. Rendering runs \`npx hyperframes\`. Nothing is uploaded or posted anywhere.

Update with \`npx @irvinosazee/shipreel@latest skill install\`. The unscoped \`shipreel\` package on npm is someone else's.
`;

export function stageCli(out = path.join(ROOT, "dist", BIN_NAME)) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  // dereference: .claude/skills/shipreel style symlinks must become real files in the package.
  cpSync(path.join(ROOT, "skills", "shipreel"), path.join(out, "skills", "shipreel"), {
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
      console.log(`Not published. To publish: npm publish ${staged} --access public`);
    }
  }
}
