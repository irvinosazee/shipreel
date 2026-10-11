import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { AGENTS, installSkill, skillSource, skillTargets } from "../skills/shipreel/scripts/skill_install.mjs";

const scratch = () => mkdtempSync(path.join(tmpdir(), "shipreel-skill-"));

test("with no project, the skill goes where every project can see it", () => {
  const targets = skillTargets({ home: "/home/ada" });
  assert.deepEqual(targets, [{ agent: "claude", path: "/home/ada/.claude/skills/shipreel" }]);
});

test("each agent reads its own path inside a project", () => {
  const forProject = (agent) => skillTargets({ agent, projectDir: "/work/app", home: "/home/ada" })[0].path;
  assert.equal(forProject("claude"), "/work/app/.claude/skills/shipreel");
  assert.equal(forProject("codex"), "/work/app/.agents/skills/shipreel");
  assert.equal(forProject("opencode"), "/work/app/.opencode/skills/shipreel");
});

test("all installs into every agent a project may use", () => {
  const targets = skillTargets({ agent: "all", projectDir: "/work/app", home: "/home/ada" });
  assert.deepEqual(
    targets.map((target) => target.agent).sort(),
    [...AGENTS].sort(),
  );
});

test("an unknown agent names the ones that exist", () => {
  assert.throws(() => skillTargets({ agent: "cursorish", home: "/home/ada" }), /claude.*codex.*opencode/s);
});

test("installing copies the skill, not just its folder", () => {
  const dir = scratch();
  try {
    const target = path.join(dir, ".claude", "skills", "shipreel");
    const written = installSkill(skillSource(), [{ agent: "claude", path: target }]);

    assert.deepEqual(written, [{ agent: "claude", path: target, action: "installed" }]);
    assert.ok(existsSync(path.join(target, "SKILL.md")));
    assert.ok(existsSync(path.join(target, "scripts", "cli.mjs")));
    assert.ok(existsSync(path.join(target, "references", "platforms.md")));
    assert.match(readFileSync(path.join(target, "SKILL.md"), "utf8"), /^---\nname: shipreel/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("installing over an older shipreel replaces it, and says so", () => {
  const dir = scratch();
  try {
    const target = path.join(dir, "shipreel");
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, "SKILL.md"), "---\nname: shipreel\n---\nold\n");
    writeFileSync(path.join(target, "stale.md"), "left over from a previous version");

    const written = installSkill(skillSource(), [{ agent: "claude", path: target }]);
    assert.equal(written[0].action, "replaced");
    assert.ok(!existsSync(path.join(target, "stale.md")), "a replaced install should not keep old files");
    assert.ok(existsSync(path.join(target, "scripts", "cli.mjs")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("installing refuses to delete a directory that is not a shipreel skill", () => {
  const dir = scratch();
  try {
    const target = path.join(dir, "shipreel");
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, "important.txt"), "somebody else's work");

    assert.throws(() => installSkill(skillSource(), [{ agent: "claude", path: target }]), /not a shipreel skill/);
    assert.ok(existsSync(path.join(target, "important.txt")), "nothing is removed when the install refuses");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the source is this repo's own skill", () => {
  assert.ok(existsSync(path.join(skillSource(), "SKILL.md")));
  assert.match(readFileSync(path.join(skillSource(), "SKILL.md"), "utf8"), /name: shipreel/);
});

test("the CLI's verbs and the bare script's flags mean the same thing", async () => {
  const { parseSkillArgs } = await import("../skills/shipreel/scripts/skill_install.mjs");
  const { COMMANDS } = await import("../skills/shipreel/scripts/cli.mjs");

  assert.equal(COMMANDS.skill.script, "skill_install.mjs");
  assert.equal(parseSkillArgs([]).verb, "install");
  assert.equal(parseSkillArgs(["install"]).verb, "install");
  assert.equal(parseSkillArgs(["where"]).verb, "where");
  assert.equal(parseSkillArgs(["--where"]).verb, "where");
  assert.equal(parseSkillArgs(["install", "--agent", "all"]).agent, "all");
  assert.equal(parseSkillArgs(["--agent", "codex"]).agent, "codex");
  assert.ok(parseSkillArgs(["install", "--project", "."]).projectDir?.startsWith("/"));
  assert.equal(parseSkillArgs(["install"]).projectDir, undefined);
});

test("installing for several agents in one project copies the 16MB of audio once", () => {
  const dir = scratch();
  try {
    const targets = skillTargets({ agent: "all", projectDir: dir });
    const written = installSkill(skillSource(), targets);

    assert.deepEqual(written.map((entry) => entry.action), ["installed", "linked", "linked"]);
    for (const entry of written) {
      // However it got there, each agent must find a real skill at its own path.
      assert.match(readFileSync(path.join(entry.path, "SKILL.md"), "utf8"), /name: shipreel/);
      assert.ok(existsSync(path.join(entry.path, "scripts", "cli.mjs")));
    }
    assert.equal(lstatSync(written[1].path).isSymbolicLink(), true);
    assert.equal(lstatSync(written[0].path).isSymbolicLink(), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a single target is always a real copy, never a link to nowhere", () => {
  const dir = scratch();
  try {
    const [written] = installSkill(skillSource(), skillTargets({ projectDir: dir }));
    assert.equal(written.action, "installed");
    assert.equal(lstatSync(written.path).isSymbolicLink(), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("replacing a linked install does not follow the link and delete the real one", () => {
  const dir = scratch();
  try {
    const targets = skillTargets({ agent: "all", projectDir: dir });
    installSkill(skillSource(), targets);
    const again = installSkill(skillSource(), targets);

    assert.deepEqual(again.map((entry) => entry.action), ["replaced", "linked", "linked"]);
    assert.match(readFileSync(path.join(targets[0].path, "SKILL.md"), "utf8"), /name: shipreel/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
