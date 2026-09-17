#!/usr/bin/env node
/**
 * Run state for /brag, so an interrupted or revised run continues where it should.
 *
 *   node <skill-root>/scripts/state.mjs init <output-dir> --invocation "/brag --for vertical"
 *   node <skill-root>/scripts/state.mjs mark <output-dir> <step> [--artifacts brag-plan.md,scenes.json]
 *   node <skill-root>/scripts/state.mjs next <output-dir>
 *   node <skill-root>/scripts/state.mjs invalidate <output-dir> <step> --reason "reroll scene 3"
 *   node <skill-root>/scripts/state.mjs status <output-dir>
 *
 * <output-dir>/.brag-state.json records each step's status and the sha256 of the
 * artifacts it produced. `next` returns the first step that is not done, or whose
 * artifacts were edited or deleted since it finished.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const STEPS = ["preflight", "inspect", "plan", "compose", "check", "draft", "review", "render", "deliver"];
const FILE = ".brag-state.json";

const statePath = (dir) => path.join(dir, FILE);
const hashFile = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

function assertStep(step) {
  if (!STEPS.includes(step)) throw new Error(`Unknown step "${step}". Steps: ${STEPS.join(", ")}.`);
}

function save(dir, state) {
  writeFileSync(statePath(dir), `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

export function initState(dir, { invocation, now = new Date().toISOString() }) {
  return save(dir, {
    version: 1,
    invocation,
    createdAt: now,
    steps: Object.fromEntries(STEPS.map((step) => [step, { status: "pending" }])),
    history: [{ action: "init", invocation }],
  });
}

export function loadState(dir) {
  if (!existsSync(statePath(dir))) throw new Error(`No ${FILE} in ${dir}; run "state.mjs init" first.`);
  return JSON.parse(readFileSync(statePath(dir), "utf8"));
}

export function markStep(dir, step, { artifacts = [] } = {}) {
  assertStep(step);
  const state = loadState(dir);
  state.steps[step] = {
    status: "done",
    artifacts: Object.fromEntries(artifacts.map((rel) => [rel, hashFile(path.join(dir, rel))])),
  };
  state.history.push({ action: "done", step });
  return save(dir, state);
}

export function nextStep(dir) {
  const state = loadState(dir);
  for (const step of STEPS) {
    const entry = state.steps[step];
    if (entry.status !== "done") return { step, reason: entry.reason ?? "not started" };
    for (const [rel, hash] of Object.entries(entry.artifacts ?? {})) {
      const file = path.join(dir, rel);
      if (!existsSync(file)) return { step, reason: `${rel} is missing` };
      if (hashFile(file) !== hash) return { step, reason: `${rel} changed since ${step} finished` };
    }
  }
  return null;
}

export function invalidateFrom(dir, step, { reason }) {
  assertStep(step);
  const state = loadState(dir);
  for (const later of STEPS.slice(STEPS.indexOf(step))) state.steps[later] = { status: "pending", reason };
  state.history.push({ action: "invalidate", from: step, reason });
  return save(dir, state);
}

function main([command, dir, ...rest]) {
  const flag = (name) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined);
  if (!dir) throw new Error("Usage: state.mjs init|mark|next|invalidate|status <output-dir> ...");
  if (command === "init") initState(dir, { invocation: flag("--invocation") ?? "/brag" });
  else if (command === "mark") markStep(dir, rest[0], { artifacts: flag("--artifacts")?.split(",").filter(Boolean) ?? [] });
  else if (command === "invalidate") invalidateFrom(dir, rest[0], { reason: flag("--reason") ?? "revision" });
  else if (command !== "next" && command !== "status") throw new Error(`Unknown command "${command}".`);

  if (command === "status") {
    const state = loadState(dir);
    for (const step of STEPS) console.log(`${state.steps[step].status === "done" ? "✓" : "·"} ${step}${state.steps[step].reason ? ` (${state.steps[step].reason})` : ""}`);
  }
  console.log(JSON.stringify({ next: nextStep(dir) }));
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
