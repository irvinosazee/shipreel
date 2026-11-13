import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildCampaign } from "../skills/shipreel/scripts/campaign.mjs";
import { applyUpdate, freshBrief, planUpdate } from "../skills/shipreel/scripts/campaign_update.mjs";
import { parseCalendar } from "../skills/shipreel/scripts/desk.mjs";
import { postedThroughDay, writePosted } from "../skills/shipreel/scripts/ledger.mjs";

// A tidy repo with a two-platform campaign built from its first commit.
async function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "shipreel-update-"));
  const git = (...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...a], { cwd: dir }).toString().trim();
  writeFileSync(path.join(dir, ".gitignore"), "shipreel-output/\n");
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "tidy", description: "Inbox zero, finally.", bin: { tidy: "cli.js" } }));
  writeFileSync(path.join(dir, "README.md"), "# tidy\n\nInbox zero, finally.\n\nBuilt for founders who drown in email. No more inbox triage at midnight! Use it instead of filters and folders.\n");
  git("init", "-q"); git("add", "-A"); git("commit", "-qm", "init");
  await buildCampaign(dir, { images: false, platforms: ["tiktok", "x"] });
  const camp = path.join(dir, "shipreel-output", "campaign");
  const days = () => parseCalendar(readFileSync(path.join(camp, "calendar.md"), "utf8")).days;
  const commit = (file, text, msg) => { writeFileSync(path.join(dir, file), text); git("add", "-A"); git("commit", "-qm", msg); };
  return { dir, camp, days, commit, done: () => rmSync(dir, { recursive: true, force: true }) };
}

const filesOf = (camp, key) => Object.fromEntries(readdirSync(path.join(camp, key)).map((f) => [f, readFileSync(path.join(camp, key, f), "utf8")]));
const keysOf = (camp) => readdirSync(camp, { withFileTypes: true }).filter((d) => d.isDirectory()).flatMap((d) => readdirSync(path.join(camp, d.name)).map((id) => `${d.name}/${id}`));

test("posted pieces are never rewritten, moved or deleted", async () => {
  const f = await fixture();
  try {
    f.commit("archive.js", "// bulk\n", "Archive: bulk archive old newsletters in one go");
    const posted = postedThroughDay(f.days(), 2).sort();
    writePosted(f.camp, posted);
    const before = Object.fromEntries(posted.map((k) => [k, filesOf(f.camp, k)]));
    const plan = planUpdate(f.camp, { projectDir: f.dir, note: "Bulk archive old newsletters in one go." });
    assert.deepEqual(plan.position.posted, posted);
    for (const k of posted) assert.ok(!plan.rewrite.some((r) => r.key === k), k);
    await applyUpdate(f.camp, plan, { projectDir: f.dir, images: false });
    for (const k of posted) assert.deepEqual(filesOf(f.camp, k), before[k], k);
    const kept = f.days().slice(0, 2).flatMap((d) => d.posts);
    assert.deepEqual(kept.sort(), posted, "days 1 and 2 still list exactly what was posted");
  } finally {
    f.done();
  }
});

test("a claim that no longer verifies makes the unposted pieces that use it stale", async () => {
  const f = await fixture();
  try {
    const key = f.days()[2].posts[0];
    const hook = JSON.parse(readFileSync(path.join(f.camp, key, "post.json"), "utf8")).hook.replace(/[.?!]$/, "");
    writeFileSync(path.join(f.camp, "claims.json"), JSON.stringify([{ text: hook, source: "README.md", quote: "Inbox zero, finally." }]));
    f.commit("README.md", "# tidy\n\nA calmer inbox.\n", "README: new tagline");
    const plan = planUpdate(f.camp, { projectDir: f.dir, note: "", currentDay: 2 });
    const hit = plan.rewrite.find((r) => r.key === key);
    assert.ok(hit, JSON.stringify(plan.rewrite));
    assert.match(hit.why, /no longer verifies/);
  } finally {
    f.done();
  }
});

test("only unbacked points: nothing is rewritten or added, and each point is reported", async () => {
  const f = await fixture();
  try {
    const plan = planUpdate(f.camp, { projectDir: f.dir, note: "Now 10x faster.", currentDay: 1 });
    assert.deepEqual(plan.rewrite, []);
    assert.deepEqual(plan.add, []);
    assert.deepEqual(plan.unbacked, ["Now 10x faster."]);
  } finally {
    f.done();
  }
});

test("a backed change adds NN-update pieces and the calendar restarts after the current day", async () => {
  const f = await fixture();
  try {
    f.commit("archive.js", "// bulk\n", "Archive: bulk archive old newsletters in one go");
    const plan = planUpdate(f.camp, { projectDir: f.dir, note: "Bulk archive old newsletters in one go.", currentDay: 2 });
    assert.deepEqual(plan.add.map((a) => a.platform).sort(), ["tiktok", "x"]);
    const { changed, check } = await applyUpdate(f.camp, plan, { projectDir: f.dir, images: false });
    const added = keysOf(f.camp).filter((k) => /\/\d\d-update$/.test(k));
    assert.equal(added.length, 2);
    for (const k of added) {
      assert.ok(changed.includes(k));
      assert.match(JSON.parse(readFileSync(path.join(f.camp, k, "post.json"), "utf8")).changed.why, /bulk archive/i);
    }
    const days = f.days();
    assert.deepEqual(days.slice(0, 2).map((d) => d.day), [1, 2]);
    assert.equal(days[2].day, 3);
    assert.ok(days.flatMap((d) => d.posts).includes(added[0]));
    assert.match(readFileSync(path.join(f.camp, "changes.md"), "utf8"), /Bulk archive old newsletters/);
    assert.equal(check.ok, true, JSON.stringify(check.platforms.map((p) => p.pieces.map((x) => x.errors))));
  } finally {
    f.done();
  }
});

test("everything posted: only new pieces, on days after the last one", async () => {
  const f = await fixture();
  try {
    f.commit("archive.js", "// bulk\n", "Archive: bulk archive old newsletters in one go");
    const all = f.days().flatMap((d) => d.posts);
    const last = Math.max(...f.days().map((d) => d.day));
    writePosted(f.camp, all);
    const plan = planUpdate(f.camp, { projectDir: f.dir, note: "Bulk archive old newsletters in one go." });
    assert.deepEqual(plan.rewrite, []);
    assert.ok(plan.add.length > 0);
    await applyUpdate(f.camp, plan, { projectDir: f.dir, images: false });
    const days = f.days();
    assert.deepEqual(days.filter((d) => d.day <= last).flatMap((d) => d.posts), all);
    assert.ok(days.filter((d) => d.day > last).flatMap((d) => d.posts).every((k) => /-update$/.test(k)));
  } finally {
    f.done();
  }
});

test("a campaign built before 0.5 (no commit, no claims.json) still plans", async () => {
  const f = await fixture();
  try {
    writeFileSync(path.join(f.camp, "campaign.json"), JSON.stringify({ product: "tidy" }));
    rmSync(path.join(f.camp, "claims.json"));
    f.commit("archive.js", "// bulk\n", "Archive: bulk archive old newsletters in one go");
    const plan = planUpdate(f.camp, { projectDir: f.dir, note: "Bulk archive old newsletters in one go.", currentDay: 1 });
    assert.equal(plan.points[0].backed, true);
  } finally {
    f.done();
  }
});

test("freshBrief moves a git-story fact to today's line and drops other broken claims; the user's brief is not edited", () => {
  const brief = { product: "tidy", proof: { value: ["1 day · 1 commit · 1 contributor", "344 tests", "MIT"] }, objections: { value: [{ q: "Maintained?", a: "1 day · 1 commit · 1 contributor, and counting." }] } };
  const { brief: next, stale } = freshBrief(brief, ["1 day · 1 commit · 1 contributor", "344 tests"], "2 days · 2 commits · 1 contributor");
  assert.deepEqual(next.proof.value, ["2 days · 2 commits · 1 contributor", "MIT"]);
  assert.equal(next.objections.value[0].a, "2 days · 2 commits · 1 contributor, and counting.");
  assert.deepEqual(stale, ["1 day · 1 commit · 1 contributor", "344 tests"]);
  assert.equal(brief.proof.value[0], "1 day · 1 commit · 1 contributor");
  assert.deepEqual(freshBrief(brief, [], null), { brief, stale: [] });
});

test("a campaign copied out of the project reads brief and claims from the project's shipreel-output", async () => {
  const f = await fixture();
  const { outDirFor } = await import("../skills/shipreel/scripts/campaign_update.mjs");
  try {
    assert.equal(outDirFor(f.camp, f.dir), path.join(f.dir, "shipreel-output"));
    assert.equal(outDirFor(path.join(tmpdir(), "somewhere"), f.dir), path.join(f.dir, "shipreel-output"));
    const bare = mkdtempSync(path.join(tmpdir(), "bare-"));
    assert.equal(outDirFor(path.join(bare, "copy"), bare), path.join(bare, "copy"));
    rmSync(bare, { recursive: true, force: true });
  } finally {
    f.done();
  }
});

test("a claim whose quote moved but whose words are still in the file holds: no rewrite, the quote is reported", async () => {
  const f = await fixture();
  try {
    const key = f.days()[2].posts[0];
    const hook = JSON.parse(readFileSync(path.join(f.camp, key, "post.json"), "utf8")).hook.replace(/[.?!]$/, "");
    writeFileSync(path.join(f.camp, "claims.json"), JSON.stringify([{ text: hook, source: "README.md", quote: "a sentence that was edited away" }]));
    writeFileSync(path.join(f.dir, "README.md"), `# tidy\n\n${hook}.\n`);
    const plan = planUpdate(f.camp, { projectDir: f.dir, note: "", currentDay: 2 });
    assert.ok(!plan.rewrite.some((r) => r.key === key), JSON.stringify(plan.rewrite));
    assert.deepEqual(plan.staleQuotes.map((q) => q.text), [hook]);
  } finally {
    f.done();
  }
});
