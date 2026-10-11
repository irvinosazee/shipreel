import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  ISSUER_PUBLIC_KEY,
  describeLicence,
  encodeLicence,
  licencePath,
  licenceStatus,
  readLicenceToken,
  verifyLicence,
} from "../skills/shipreel/scripts/licence.mjs";

const issuer = () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { privateKey, publicKey: publicKey.export({ format: "jwk" }).x };
};

const details = {
  id: "SR-2026-0007",
  name: "Ada Lovelace",
  email: "ada@example.com",
  issued: "2026-10-11",
  updatesUntil: "2027-10-11",
};

const home = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "shipreel-home-"));
  return dir;
};

test("a licence survives the round trip and names its holder", () => {
  const { privateKey, publicKey } = issuer();
  const token = encodeLicence(details, privateKey);
  assert.match(token, /^SR1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

  const status = verifyLicence(token, { publicKey, now: new Date("2026-11-01") });
  assert.equal(status.valid, true, status.reason);
  assert.equal(status.licensee, "Ada Lovelace");
  assert.equal(status.payload.id, "SR-2026-0007");
  assert.equal(status.updatesExpired, false);
});

test("an edited payload no longer verifies", () => {
  const { privateKey, publicKey } = issuer();
  const token = encodeLicence(details, privateKey);
  const [prefix, payload, signature] = token.split(".");
  const forged = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  forged.name = "Someone Else";
  const tampered = [prefix, Buffer.from(JSON.stringify(forged)).toString("base64url"), signature].join(".");

  const status = verifyLicence(tampered, { publicKey });
  assert.equal(status.valid, false);
  assert.equal(status.reason, "signature does not match the licence");
});

test("a licence signed by someone else does not verify", () => {
  const token = encodeLicence(details, issuer().privateKey);
  const status = verifyLicence(token, { publicKey: issuer().publicKey });
  assert.equal(status.valid, false);
  assert.equal(status.reason, "signature does not match the licence");
});

test("a malformed licence is reported, never thrown", () => {
  const { publicKey } = issuer();
  const reasons = [
    ["", "licence is empty"],
    ["not-a-licence", "licence is not in the SR1.<payload>.<signature> form"],
    ["SR1.only-two-parts", "licence is not in the SR1.<payload>.<signature> form"],
    ["SR2.abc.def", "licence format SR2 is newer than this copy of shipreel understands"],
    [`SR1.${Buffer.from("{nope").toString("base64url")}.AAAA`, "licence payload is not readable"],
    [`SR1.${Buffer.from(JSON.stringify({ name: "No Id" })).toString("base64url")}.AAAA`, "licence payload is missing id, issued"],
  ];
  for (const [token, reason] of reasons) {
    const status = verifyLicence(token, { publicKey });
    assert.equal(status.valid, false, token);
    assert.equal(status.reason, reason, token);
  }
});

test("a licence past its update window still works, and says so", () => {
  const { privateKey, publicKey } = issuer();
  const token = encodeLicence(details, privateKey);
  const status = verifyLicence(token, { publicKey, now: new Date("2028-01-01") });

  assert.equal(status.valid, true, "the licence is perpetual — updates lapse, the tool does not");
  assert.equal(status.updatesExpired, true);
  assert.match(describeLicence(status), /updates ended/i);
});

test("the environment variable wins over the licence file", () => {
  const dir = home();
  try {
    mkdirSync(path.join(dir, ".shipreel"), { recursive: true });
    writeFileSync(licencePath(dir), "SR1.from-file.sig");
    assert.deepEqual(readLicenceToken({ env: { SHIPREEL_LICENCE: "SR1.from-env.sig" }, home: dir }), {
      token: "SR1.from-env.sig",
      source: "SHIPREEL_LICENCE",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the licence file is read whole, trimmed of the newline an editor adds", () => {
  const dir = home();
  try {
    mkdirSync(path.join(dir, ".shipreel"), { recursive: true });
    writeFileSync(licencePath(dir), "  SR1.from-file.sig\n\n");
    const found = readLicenceToken({ env: {}, home: dir });
    assert.equal(found.token, "SR1.from-file.sig");
    assert.match(found.source, /\.shipreel[/\\]licence$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no licence anywhere reads as no licence, not as an error", () => {
  const dir = home();
  try {
    assert.equal(readLicenceToken({ env: {}, home: dir }), null);
    const status = licenceStatus({ env: {}, home: dir });
    assert.equal(status.valid, false);
    assert.equal(status.reason, "no licence found");
    assert.match(describeLicence(status), /no licence/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("licenceStatus verifies what it reads from disk", () => {
  const dir = home();
  const { privateKey, publicKey } = issuer();
  try {
    mkdirSync(path.join(dir, ".shipreel"), { recursive: true });
    writeFileSync(licencePath(dir), `${encodeLicence(details, privateKey)}\n`);
    const status = licenceStatus({ env: {}, home: dir, publicKey, now: new Date("2026-11-01") });
    assert.equal(status.valid, true, status.reason);
    assert.equal(status.licensee, "Ada Lovelace");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the public key shipped in the module is a usable Ed25519 key", () => {
  const { privateKey } = issuer();
  const token = encodeLicence(details, privateKey);
  // Wrong key, but a working one: a broken constant would report a key error instead.
  assert.equal(verifyLicence(token, { publicKey: ISSUER_PUBLIC_KEY }).reason, "signature does not match the licence");
});

test("no private key material is tracked in the repository", () => {
  const root = path.resolve(import.meta.dirname, "..");
  let tracked = "";
  try {
    tracked = execFileSync("git", ["grep", "-lE", "BEGIN [A-Z ]*PRIVATE KEY", "--", ".", ":!tests/licence.test.mjs"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  } catch (error) {
    // git grep exits 1 when nothing matches, which is the result this test wants.
    if (error.status !== 1) throw error;
  }
  assert.equal(tracked, "", "a private key must never be committed — the issuer key lives in ~/.shipreel");
});

test("the packaged tarball carries both licences", async () => {
  const { packageJson } = await import("../scripts/pack-cli.mjs");
  assert.deepEqual(packageJson().files.filter((f) => f.startsWith("LICENSE")), ["LICENSE", "LICENSE-COMMERCIAL.md"]);
});
