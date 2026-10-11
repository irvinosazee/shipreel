#!/usr/bin/env node
/**
 * Put the shipreel skill where an agent will find it.
 *
 *   shipreel skill install                       # ~/.claude/skills/shipreel
 *   shipreel skill install --project .           # this project, for Claude Code
 *   shipreel skill install --project . --agent all
 *   shipreel skill where                         # print the paths, change nothing
 *
 * Every agent reads skills from its own directory, which is the only reason this exists: the
 * copy is a plain recursive copy, and doing it by hand with rsync works just as well.
 */

import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const AGENTS = ["claude", "codex", "opencode"];

const PROJECT_DIRS = {
  claude: ".claude",
  codex: ".agents",
  opencode: ".opencode",
};

/** The skill this script belongs to — its own parent directory. */
export function skillSource() {
  return path.resolve(HERE, "..");
}

/**
 * Where a copy should go. Without a project, only Claude Code has a home-level skills
 * directory, so that is the single target; the other two are discovered per project.
 */
export function skillTargets({ agent = "claude", projectDir, home = homedir() } = {}) {
  const wanted = agent === "all" ? AGENTS : [agent];
  const unknown = wanted.filter((name) => !AGENTS.includes(name));
  if (unknown.length > 0) {
    throw new Error(`Unknown agent "${unknown[0]}". Known agents: ${AGENTS.join(", ")}, or "all".`);
  }

  if (!projectDir) {
    if (!wanted.includes("claude")) {
      throw new Error(`${wanted[0]} discovers skills per project — pass --project <dir>.`);
    }
    return [{ agent: "claude", path: path.join(home, ".claude", "skills", "shipreel") }];
  }

  return wanted.map((name) => ({
    agent: name,
    path: path.join(projectDir, PROJECT_DIRS[name], "skills", "shipreel"),
  }));
}

const isShipreelSkill = (dir) => {
  const skill = path.join(dir, "SKILL.md");
  return existsSync(skill) && /^name:\s*shipreel\s*$/m.test(readFileSync(skill, "utf8"));
};

/**
 * Clear a target so it can be rewritten. An existing shipreel install goes, so a file deleted
 * upstream does not linger; anything else stays, because a directory someone put there
 * themselves is not ours to delete. A symlink is unlinked, never followed — removing the
 * link must not remove what it points at.
 */
function clearTarget(target) {
  if (!existsSync(target) && !isLink(target)) return "installed";
  if (isLink(target)) {
    // unlink, not rm: rmSync resolves the link and refuses the directory behind it.
    unlinkSync(target);
    return "replaced";
  }
  if (!isShipreelSkill(target)) {
    throw new Error(`${target} exists and is not a shipreel skill — move it aside first.`);
  }
  rmSync(target, { recursive: true, force: true });
  return "replaced";
}

function isLink(target) {
  try {
    return lstatSync(target).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Write the skill to each target. The first is a real copy; the rest point at it, because the
 * bundled audio is 16MB and three agents in one project do not need three of them. If the
 * platform will not make a link (Windows without developer mode), it gets its own copy.
 */
export function installSkill(source, targets) {
  const written = [];
  let copied = null;

  for (const target of targets) {
    const action = clearTarget(target.path);
    mkdirSync(path.dirname(target.path), { recursive: true });

    if (copied) {
      try {
        symlinkSync(path.relative(path.dirname(target.path), copied), target.path, "dir");
        written.push({ ...target, action: "linked" });
        continue;
      } catch {
        // No symlinks here; fall through and copy.
      }
    }

    cpSync(source, target.path, { recursive: true, dereference: true });
    copied ??= target.path;
    written.push({ ...target, action });
  }
  return written;
}

/** `shipreel skill install --project . --agent all`, or the bare script with the same flags. */
export function parseSkillArgs(argv) {
  const rest = ["install", "where"].includes(argv[0]) ? argv.slice(1) : argv;
  const flag = (name, fallback) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : fallback);
  return {
    verb: argv[0] === "where" || rest.includes("--where") ? "where" : "install",
    agent: flag("--agent", "claude"),
    projectDir: rest.includes("--project") ? path.resolve(flag("--project", ".")) : undefined,
  };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const { verb, agent, projectDir } = parseSkillArgs(process.argv.slice(2));
    const targets = skillTargets({ agent, projectDir });

    if (verb === "where") {
      for (const target of targets) console.log(`${target.agent.padEnd(9)} ${target.path}`);
    } else {
      for (const written of installSkill(skillSource(), targets)) {
        console.log(`${written.action} ${written.agent} skill at ${written.path}`);
      }
      console.error("Restart your agent so it picks the skill up.");
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
