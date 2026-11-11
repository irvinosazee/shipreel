import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { checkCampaign, checkPiece, sameAngles } from "../skills/shipreel/scripts/campaign_check.mjs";
import { deceptiveHits } from "../skills/shipreel/scripts/brief.mjs";
import { writePiece } from "../skills/shipreel/scripts/content.mjs";

const dossier = { project: { name: "tidy", type: "cli" }, media: {} };
const brief = { hashtags: { value: ["devtools", "productivity", "email"] } };
const claims = [{ text: "Sorts 10,000 emails a minute" }];
const piece = (platform, kind, extra = {}) => ({
  n: 1, id: "01-pain-hook", platform, angle: "pain-hook", why: "x", kind, format: "vertical",
  hook: "Stuck with inbox triage at midnight?", beats: ["Stuck with inbox triage at midnight?", "Inbox zero, finally.", "Sorts 10,000 emails a minute"], cta: "Try it: npx tidy", ...extra,
});
const codes = (r) => r.errors.map((e) => e.code).sort();

function campaign() {
  const dir = mkdtempSync(path.join(tmpdir(), "shipreel-camp-"));
  writePiece(piece("tiktok", "video"), { dossier, brief, dir: path.join(dir, "tiktok", "01-pain-hook") });
  writePiece(piece("tiktok", "video", { n: 2, id: "02-demo", angle: "demo", hook: "tidy, start to finish." }), { dossier, brief, dir: path.join(dir, "tiktok", "02-demo") });
  writePiece(piece("x", "thread"), { dossier, brief, dir: path.join(dir, "x", "01-pain-hook") });
  return dir;
}

test("a well-made piece passes; unrendered media is only a warning", () => {
  const dir = campaign();
  try {
    const r = checkPiece(path.join(dir, "tiktok", "01-pain-hook"), { claims });
    assert.deepEqual(r.errors, []);
    assert.ok(r.warnings.some((w) => w.code === "not-rendered" && /video\.mp4/.test(w.message)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("each rule fails the piece that breaks it", () => {
  const dir = campaign();
  const p = path.join(dir, "tiktok", "01-pain-hook");
  try {
    writeFileSync(path.join(p, "caption.txt"), `${"x".repeat(2300)}\n10x faster than everything. Only 3 spots left — act now before it is gone. Supercharge your inbox.`);
    writeFileSync(path.join(p, "hashtags.txt"), "#a\n#b\n#c\n#d\n#e\n#f");
    writeFileSync(path.join(p, "alt.txt"), "");
    writeFileSync(path.join(p, "content.json"), readFileSync(path.join(p, "content.json")));
    const r = checkPiece(p, { claims });
    assert.deepEqual(codes(r), ["alt-text", "banned-word", "deceptive", "deceptive", "hashtags", "too-long", "uncited-claim", "uncited-claim"], "\"3 spots\" is both invented scarcity and an uncited number");
    assert.ok(r.warnings.some((w) => w.code === "em-dash"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("X posts are measured the way X counts them", () => {
  const dir = campaign();
  const p = path.join(dir, "x", "01-pain-hook");
  try {
    writeFileSync(path.join(p, "thread.txt"), `1/2\nshort\n\n2/2\n${"word ".repeat(70)}`);
    assert.deepEqual(codes(checkPiece(p, { claims })), ["too-long"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("two pieces on one platform may not share an angle or a hook", () => {
  const a = { piece: "01-a", angle: "demo", hook: "tidy, start to finish." };
  assert.equal(sameAngles([a, { ...a, piece: "02-b" }])[0].code, "same-angle");
  assert.equal(sameAngles([a, { piece: "02-b", angle: "proof", hook: "tidy start to finish" }]).length, 1);
  assert.deepEqual(sameAngles([a, { piece: "02-b", angle: "proof", hook: "Sorts 10,000 emails a minute." }]), []);
});

test("deceptiveHits names each kind of deception", () => {
  assert.deepEqual(deceptiveHits("Only 2 seats left! Offer ends tonight. Loved by thousands of developers."), ["invented scarcity", "invented urgency", "invented social proof"]);
  assert.deepEqual(deceptiveHits('"It changed how I work every single day" - Maria'), ["a quoted testimonial"]);
  assert.deepEqual(deceptiveHits("Free and open source. Try it today."), []);
});

test("checkCampaign walks every platform and piece", async () => {
  const dir = campaign();
  try {
    const report = await checkCampaign(dir, { claims, images: false });
    assert.equal(report.ok, true, JSON.stringify(report.platforms, null, 1));
    assert.deepEqual(report.platforms.map((p) => [p.platform, p.pieces.length]), [["tiktok", 2], ["x", 1]]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
