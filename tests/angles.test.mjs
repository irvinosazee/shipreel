import { test } from "node:test";
import assert from "node:assert/strict";

import { hookOverlap, MAX_PER_PLATFORM, MIN_PER_PLATFORM, PLATFORMS, planAngles } from "../skills/shipreel/scripts/angles.mjs";

const f = (value) => ({ value, source: "test" });
const full = {
  product: "tidy",
  audience: f("founders"),
  pain: f("They are stuck with inbox triage at midnight."),
  workaround: f("filters and folders"),
  promise: f("Inbox zero, finally."),
  proof: f(["Sorts 10,000 emails a minute", "Snooze: newsletters wait until Friday"]),
  objections: f([]),
  cta: f("Try it: npx tidy"),
  tone: f("bold"),
  angles: f(["pain-hook", "before-after", "demo", "myth-buster", "proof"]),
};
const story = { commits: 40, days: 6 };

test("every platform gets 3 to 5 pieces, each a different angle, in that platform's formats", () => {
  const { plan, skipped } = planAngles(full, { story });
  assert.deepEqual(Object.keys(plan), Object.keys(PLATFORMS));
  for (const [platform, pieces] of Object.entries(plan)) {
    assert.ok(pieces.length >= MIN_PER_PLATFORM && pieces.length <= MAX_PER_PLATFORM, `${platform}: ${pieces.length}`);
    assert.equal(new Set(pieces.map((p) => p.angle)).size, pieces.length, `${platform} repeats an angle`);
    for (const p of pieces) {
      assert.ok(PLATFORMS[platform].formats.some(([kind]) => kind === p.kind), `${platform} ${p.kind}`);
      assert.ok(p.hook && p.beats.length >= 2 && p.cta === "Try it: npx tidy");
      assert.match(p.id, /^\d\d-[a-z-]+$/);
    }
    for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) assert.ok(hookOverlap(pieces[i].hook, pieces[j].hook) <= 0.6, `${pieces[i].hook} / ${pieces[j].hook}`);
  }
  assert.deepEqual(skipped, []);
  assert.deepEqual(plan.instagram.map((p) => p.kind).slice(0, 3), ["video", "carousel", "story"]);
  assert.deepEqual(plan.x.map((p) => p.kind)[0], "thread");
});

test("hooks come from the brief: the pain as a question, the workaround busted, the build story from git", () => {
  const hooks = Object.fromEntries(planAngles(full, { story }).plan.tiktok.map((p) => [p.angle, p.hook]));
  assert.equal(hooks["pain-hook"], "Stuck with inbox triage at midnight?");
  assert.equal(hooks["before-after"], "Before: filters and folders. After: tidy.");
  assert.equal(hooks["myth-buster"], "You don't need filters and folders.");
  // The brief's own angles fill a platform first; build story and how-to appear where the platform favours them.
  const ys = Object.fromEntries(Object.values(planAngles({ ...full, angles: f(["demo"]) }, { story }).plan).flat().map((p) => [p.angle, p.hook]));
  assert.equal(ys["build-story"], "I built tidy in 6 days.");
  assert.equal(ys["how-to"], "tidy in one line.", "the product name keeps its own spelling");
});

test("an angle is planned only when the brief has what it needs", () => {
  const thin = { ...full, pain: f(""), workaround: f(""), cta: f("Try it: https://tidy.app"), angles: f(["pain-hook", "myth-buster", "demo"]) };
  const { plan, skipped } = planAngles(thin, { story: { commits: 13, days: 200 } });
  const angles = new Set(Object.values(plan).flat().map((p) => p.angle));
  for (const a of ["myth-buster", "before-after", "hot-take", "how-to", "build-story"]) assert.ok(!angles.has(a), a);
  assert.ok(skipped.some((s) => s.angle === "myth-buster"), "the brief's own angle that could not be planned is reported once");
  assert.equal(skipped.filter((s) => s.angle === "myth-buster").length, 1);
});

test("hookOverlap measures shared words", () => {
  assert.equal(hookOverlap("tidy, start to finish.", "tidy start to finish"), 1);
  assert.ok(hookOverlap("Stuck with inbox triage?", "I built tidy in 6 days.") < 0.2);
});

test("an unknown platform is refused", () => {
  assert.throws(() => planAngles(full, { platforms: ["myspace"] }), /Unknown platform "myspace"/);
});
