import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { STEPS, initState, loadState, markStep, nextStep, invalidateFrom } from "../skills/shipreel/scripts/state.mjs";

function withDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "shipreel-state-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("steps follow the /shipreel workflow in order", () => {
  assert.deepEqual(STEPS, ["preflight", "inspect", "plan", "compose", "check", "draft", "review", "render", "deliver"]);
});

test("a fresh run starts at preflight and records the invocation", () => {
  withDir((dir) => {
    initState(dir, { invocation: "/shipreel --for vertical", now: "2026-09-17T03:00:00Z" });
    const state = loadState(dir);
    assert.equal(state.invocation, "/shipreel --for vertical");
    assert.deepEqual(nextStep(dir), { step: "preflight", reason: "not started" });
  });
});

test("marking steps done advances the run and hashes their artifacts", () => {
  withDir((dir) => {
    initState(dir, { invocation: "/shipreel" });
    writeFileSync(path.join(dir, "shipreel-plan.md"), "plan v1");
    for (const step of ["preflight", "inspect"]) markStep(dir, step);
    markStep(dir, "plan", { artifacts: ["shipreel-plan.md"] });
    const state = JSON.parse(readFileSync(path.join(dir, ".shipreel-state.json"), "utf8"));
    assert.equal(state.steps.plan.status, "done");
    assert.match(state.steps.plan.artifacts["shipreel-plan.md"], /^[0-9a-f]{64}$/);
    assert.deepEqual(nextStep(dir), { step: "compose", reason: "not started" });
  });
});

test("an edited or missing artifact makes its step the place to resume", () => {
  withDir((dir) => {
    initState(dir, { invocation: "/shipreel" });
    writeFileSync(path.join(dir, "shipreel-plan.md"), "plan v1");
    for (const step of ["preflight", "inspect"]) markStep(dir, step);
    markStep(dir, "plan", { artifacts: ["shipreel-plan.md"] });
    markStep(dir, "compose");

    writeFileSync(path.join(dir, "shipreel-plan.md"), "plan v2");
    assert.deepEqual(nextStep(dir), { step: "plan", reason: "shipreel-plan.md changed since plan finished" });

    rmSync(path.join(dir, "shipreel-plan.md"));
    assert.deepEqual(nextStep(dir), { step: "plan", reason: "shipreel-plan.md is missing" });
  });
});

test("invalidateFrom resets a step and everything after it, keeping earlier work", () => {
  withDir((dir) => {
    initState(dir, { invocation: "/shipreel" });
    for (const step of STEPS) markStep(dir, step);
    assert.equal(nextStep(dir), null, "a finished run has nothing left");
    invalidateFrom(dir, "compose", { reason: "reroll scene 3" });
    const state = loadState(dir);
    assert.equal(state.steps.plan.status, "done");
    assert.equal(state.steps.compose.status, "pending");
    assert.equal(state.steps.deliver.status, "pending");
    assert.deepEqual(nextStep(dir), { step: "compose", reason: "reroll scene 3" });
    assert.deepEqual(state.history.at(-1), { action: "invalidate", from: "compose", reason: "reroll scene 3" });
  });
});

test("unknown steps and a missing state file are clear errors", () => {
  withDir((dir) => {
    assert.throws(() => loadState(dir), /No \.shipreel-state\.json/);
    initState(dir, { invocation: "/shipreel" });
    assert.throws(() => markStep(dir, "polish"), /Unknown step "polish"/);
  });
});
