import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildCampaign, calendarMarkdown, planCalendar } from "../skills/shipreel/scripts/campaign.mjs";

const piece = (platform, n) => ({ id: `0${n}-a${n}`, hook: `Hook ${platform} ${n}`, kind: "video" });
const plan = { tiktok: [1, 2, 3].map((n) => piece("tiktok", n)), x: [1, 2, 3].map((n) => piece("x", n)), linkedin: [1, 2, 3, 4].map((n) => piece("linkedin", n)) };

test("the calendar spreads every piece over the days, at most three a day, rotating which platform leads", () => {
  const cal = planCalendar(plan);
  const posted = cal.flatMap((d) => d.posts.map((p) => `${p.platform}/${p.piece}`));
  assert.equal(posted.length, 10);
  assert.equal(new Set(posted).size, 10, "nothing is posted twice");
  assert.ok(cal.every((d) => d.posts.length <= 3));
  assert.equal(cal[0].posts[0].platform, "tiktok");
  assert.equal(cal[1].posts[0].platform, "x");
  const md = calendarMarkdown(cal, { product: "tidy" });
  assert.match(md, /^# tidy: two-week campaign/);
  assert.match(md, /## Day 1\n- \*\*TikTok\*\* · video · `tiktok\/01-a1`/);
});

test("buildCampaign: brief first, stop there with --brief-only; then every piece, the calendar, the check", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "shipreel-max-"));
  try {
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "tidy", description: "Inbox zero, finally.", bin: { tidy: "cli.js" } }));
    writeFileSync(path.join(dir, "README.md"), "# tidy\n\nInbox zero, finally.\n\nBuilt for founders who drown in email. No more inbox triage at midnight! Use it instead of filters and folders.\n");
    const first = await buildCampaign(dir, { briefOnly: true });
    assert.equal(first.stopped, "brief-only");
    assert.ok(existsSync(path.join(dir, "shipreel-output", "brief.md")));
    assert.ok(!existsSync(path.join(dir, "shipreel-output", "campaign")));

    const r = await buildCampaign(dir, { images: false, platforms: ["tiktok", "x"] });
    assert.deepEqual(Object.keys(r.plan), ["tiktok", "x"]);
    for (const pieces of Object.values(r.plan)) assert.ok(pieces.length >= 3, `${pieces.length}`);
    const camp = path.join(dir, "shipreel-output", "campaign");
    for (const f of ["calendar.md", "index.html", "check.json"]) assert.ok(existsSync(path.join(camp, f)), f);
    assert.ok(existsSync(path.join(camp, "tiktok", r.plan.tiktok[0].id, "caption.txt")));
    assert.equal(r.check.ok, true, JSON.stringify(r.check.platforms.map((p) => p.pieces.map((x) => x.errors)), null, 1));
    assert.match(readFileSync(path.join(camp, "tiktok", r.plan.tiktok[0].id, "caption.txt"), "utf8"), /npx tidy/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
