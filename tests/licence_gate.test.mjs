import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { COMMANDS, licenceGate } from "../skills/shipreel/scripts/cli.mjs";
import { encodeLicence, licencePath, verifyLicence } from "../skills/shipreel/scripts/licence.mjs";
import { summarize } from "../skills/shipreel/scripts/doctor.mjs";

const { privateKey, publicKey: jwk } = (() => {
  const pair = generateKeyPairSync("ed25519");
  return { privateKey: pair.privateKey, publicKey: pair.publicKey.export({ format: "jwk" }).x };
})();

const tokenFor = (overrides = {}) =>
  encodeLicence({ id: "SR-2026-0007", name: "Ada Lovelace", issued: "2026-10-11", updatesUntil: "2027-10-11", ...overrides }, privateKey);

const statusAt = (when) => verifyLicence(tokenFor(), { publicKey: jwk, now: new Date(when) });
const valid = () => statusAt("2026-11-01");
const lapsed = () => statusAt("2028-01-01");
const absent = () => ({ valid: false, reason: "no licence found", licensee: null, payload: null, updatesExpired: false });
const forged = () => verifyLicence(`${tokenFor()}x`, { publicKey: jwk });

test("a valid licence lets a command run, quietly", () => {
  const gate = licenceGate("make", { status: valid(), ownCheckout: false });
  assert.equal(gate.allowed, true);
  assert.equal(gate.notice, null, "a working licence should not narrate itself on every run");
});

test("no licence stops the command and says how to fix it", () => {
  const gate = licenceGate("make", { status: absent(), ownCheckout: false });
  assert.equal(gate.allowed, false);
  assert.match(gate.notice, /shipreel licence install/);
  assert.match(gate.notice, /SHIPREEL_LICENCE/);
  assert.match(gate.notice, /shipreel-site/, "someone without a licence needs to know where to get one");
});

test("a licence that does not verify names the reason", () => {
  const gate = licenceGate("make", { status: forged(), ownCheckout: false });
  assert.equal(gate.allowed, false);
  assert.match(gate.notice, /signature does not match/);
});

test("lapsed updates never stop a command — they only say so", () => {
  const gate = licenceGate("make", { status: lapsed(), ownCheckout: false });
  assert.equal(gate.allowed, true, "the licence is perpetual; only the update window ended");
  assert.match(gate.notice, /updates ended/i);
});

test("doctor and the licence command run without a licence", () => {
  for (const command of ["doctor", "licence"]) {
    const gate = licenceGate(command, { status: absent(), ownCheckout: false });
    assert.equal(gate.allowed, true, `${command} must work when the licence is the thing that is wrong`);
  }
});

test("a checkout of shipreel's own source is not gated", () => {
  const gate = licenceGate("make", { status: absent(), ownCheckout: true });
  assert.equal(gate.allowed, true);
  assert.equal(gate.notice, null);
});

test("the CLI offers a licence command", () => {
  assert.equal(COMMANDS.licence.script, "licence.mjs");
  assert.match(COMMANDS.licence.summary, /licence/i);
});

test("the gate reads the licence from disk when it is not handed one", () => {
  const home = mkdtempSync(path.join(tmpdir(), "shipreel-gate-"));
  try {
    mkdirSync(path.join(home, ".shipreel"), { recursive: true });
    writeFileSync(licencePath(home), `${tokenFor()}\n`);
    const gate = licenceGate("make", { env: {}, home, publicKey: jwk, now: new Date("2026-11-01"), ownCheckout: false });
    assert.equal(gate.allowed, true, gate.notice ?? "");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

const tools = { node: [22, 0, 0], ffmpeg: [7, 0, 0], ffprobe: [7, 0, 0], hyperframes: [0, 7, 0], uv: null };
const assets = { root: "assets", music: { tracks: ["a"], missingCues: [] }, sfx: { families: { ui: 3 } } };

test("doctor reports a missing licence as a blocker", () => {
  const report = summarize({ tools, assets, licence: absent() });
  assert.ok(
    report.blockers.some((blocker) => /licence/i.test(blocker)),
    `expected a licence blocker, got ${JSON.stringify(report.blockers)}`,
  );
});

test("doctor reports lapsed updates as a warning, not a blocker", () => {
  const report = summarize({ tools, assets, licence: lapsed() });
  assert.deepEqual(report.blockers, []);
  assert.ok(report.warnings.some((warning) => /updates ended/i.test(warning)));
});

test("doctor says nothing about a licence that is fine", () => {
  const report = summarize({ tools, assets, licence: valid() });
  assert.deepEqual(report.blockers, []);
  assert.deepEqual(report.warnings.filter((warning) => /licence/i.test(warning)), []);
});

test("doctor still runs for callers that know nothing about licences", () => {
  const report = summarize({ tools, assets });
  assert.deepEqual(report.blockers, []);
});

test("running from this repo is not gated, because this is the source", () => {
  assert.equal(licenceGate("make", { status: absent() }).allowed, true);
});
