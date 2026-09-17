import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { REDUCED_MOTION_SHIM, stampReducedMotion, makeReducedMotionVariant, descriptionsVtt } from "../skills/brag/scripts/access.mjs";

function fakeGsap() {
  const calls = [];
  class Timeline {}
  for (const method of ["to", "from", "fromTo", "set"]) {
    Timeline.prototype[method] = function (...args) {
      calls.push([method, ...args]);
      return this;
    };
  }
  return { gsap: { core: { Timeline } }, calls, Timeline };
}

test("the reduced-motion shim strips movement but keeps fades, color, and timing", () => {
  const { gsap, calls, Timeline } = fakeGsap();
  new Function("gsap", REDUCED_MOTION_SHIM)(gsap);
  const tl = new Timeline();
  tl.fromTo("#a", { y: 70, opacity: 0, scale: 0.9 }, { y: 0, opacity: 1, scale: 1, duration: 0.4, ease: "power4.out" }, 0.8);
  tl.to("#b", { x: 140, rotation: 5, backgroundColor: "#000", duration: 0.2 }, 2);
  tl.set("#c", { opacity: 1 }, 3);
  assert.deepEqual(calls[0], ["fromTo", "#a", { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power4.out" }, 0.8]);
  assert.deepEqual(calls[1], ["to", "#b", { backgroundColor: "#000", duration: 0.2 }, 2]);
  assert.deepEqual(calls[2], ["set", "#c", { opacity: 1 }, 3]);
});

test("stampReducedMotion inserts the shim right after the GSAP script and marks the root", () => {
  const html = `<head><script src="assets/vendor/gsap.min.js"></script><style></style></head><body><div id="root" data-composition-id="main" data-width="1080"></div><script>const tl = gsap.timeline();</script></body>`;
  const out = stampReducedMotion(html);
  assert.match(out, /gsap\.min\.js"><\/script>\n<script id="brag-reduced-motion">/);
  assert.match(out, /data-composition-id="main" data-width="1080" data-motion="reduced"/);
  assert.equal(stampReducedMotion(out), out, "idempotent");
  assert.throws(() => stampReducedMotion("<div data-composition-id='x'></div>"), /GSAP script/);
});

test("makeReducedMotionVariant writes composition-reduced-motion with assets", () => {
  const root = mkdtempSync(path.join(tmpdir(), "brag-rm-"));
  try {
    const src = path.join(root, "composition");
    mkdirSync(path.join(src, "assets"), { recursive: true });
    writeFileSync(path.join(src, "assets", "font.woff2"), "f");
    writeFileSync(path.join(src, "index.html"), `<script src="assets/vendor/gsap.min.js"></script><div data-composition-id="main"></div>`);
    const dir = makeReducedMotionVariant(src);
    assert.equal(dir, path.join(root, "composition-reduced-motion"));
    assert.match(readFileSync(path.join(dir, "index.html"), "utf8"), /brag-reduced-motion/);
    assert.ok(existsSync(path.join(dir, "assets", "font.woff2")));
    assert.match(readFileSync(path.join(dir, "GENERATED.md"), "utf8"), /do not edit/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("descriptionsVtt writes a WebVTT description track and names scenes missing a description", () => {
  const scenes = [
    { name: "Hook", start: 0, end: 3.553, description: "Orange screen. Headline: let's brag about it." },
    { name: "Install", start: 7.11, end: 11.471, description: "A terminal types the two install commands." },
  ];
  assert.equal(
    descriptionsVtt(scenes),
    "WEBVTT - audio descriptions\n\n00:00:00.000 --> 00:00:03.553\nOrange screen. Headline: let's brag about it.\n\n00:00:07.110 --> 00:00:11.471\nA terminal types the two install commands.\n",
  );
  assert.throws(() => descriptionsVtt([{ name: "Claim", start: 0, end: 1 }]), /Claim has no description/);
});
