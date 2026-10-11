import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  appendLedger,
  issue,
  nextLicenceId,
  readLedger,
  receiptText,
  updatesUntil,
} from "../scripts/issue-licence.mjs";
import { verifyLicence } from "../skills/shipreel/scripts/licence.mjs";

const keyFile = (dir) => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const file = path.join(dir, "issuer.pem");
  writeFileSync(file, privateKey.export({ type: "pkcs8", format: "pem" }));
  return { file, publicKey: publicKey.export({ format: "jwk" }).x };
};

const scratch = () => mkdtempSync(path.join(tmpdir(), "shipreel-issue-"));

test("the first licence of the year is 0001, and the next continues from it", () => {
  assert.equal(nextLicenceId([], new Date("2026-03-01")), "SR-2026-0001");
  assert.equal(nextLicenceId(["SR-2026-0001", "SR-2026-0002"], new Date("2026-03-01")), "SR-2026-0003");
});

test("numbering restarts each year and ignores ids it does not recognise", () => {
  const existing = ["SR-2025-0009", "SR-2025-0010", "nonsense", "SR-2026-0004"];
  assert.equal(nextLicenceId(existing, new Date("2026-03-01")), "SR-2026-0005");
  assert.equal(nextLicenceId(["SR-2025-0009"], new Date("2026-01-02")), "SR-2026-0001");
});

test("the update window is a whole number of months from the issue date", () => {
  assert.equal(updatesUntil("2026-10-11", 12), "2027-10-11");
  assert.equal(updatesUntil("2026-01-31", 1), "2026-02-28", "a short month clamps rather than spilling into March");
  assert.equal(updatesUntil("2027-01-31", 1), "2027-02-28");
  assert.equal(updatesUntil("2026-12-15", 12), "2027-12-15");
});

test("issuing signs a licence that verifies, and records it", () => {
  const dir = scratch();
  try {
    const { file, publicKey } = keyFile(dir);
    const result = issue(
      { name: "Ada Lovelace", email: "ada@example.com", keyFile: file, ledgerDir: dir },
      { now: new Date("2026-10-11T09:00:00Z") },
    );

    const status = verifyLicence(result.token, { publicKey, now: new Date("2026-11-01") });
    assert.equal(status.valid, true, status.reason);
    assert.equal(status.licensee, "Ada Lovelace");
    assert.equal(result.record.id, "SR-2026-0001");
    assert.equal(result.record.updatesUntil, "2027-10-11");

    assert.deepEqual(readLedger(dir).map((entry) => entry.id), ["SR-2026-0001"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a second sale gets the next number, and both licences still verify", () => {
  const dir = scratch();
  try {
    const { file, publicKey } = keyFile(dir);
    const options = { keyFile: file, ledgerDir: dir };
    const first = issue({ ...options, name: "Ada Lovelace", email: "ada@example.com" }, { now: new Date("2026-10-11") });
    const second = issue({ ...options, name: "Grace Hopper", email: "grace@example.com" }, { now: new Date("2026-10-12") });

    assert.equal(second.record.id, "SR-2026-0002");
    for (const token of [first.token, second.token]) {
      assert.equal(verifyLicence(token, { publicKey, now: new Date("2026-11-01") }).valid, true);
    }
    assert.deepEqual(readLedger(dir).map((entry) => entry.name), ["Ada Lovelace", "Grace Hopper"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("issuing refuses without a name and an email", () => {
  const dir = scratch();
  try {
    const { file } = keyFile(dir);
    assert.throws(() => issue({ email: "ada@example.com", keyFile: file, ledgerDir: dir }), /name/);
    assert.throws(() => issue({ name: "Ada Lovelace", keyFile: file, ledgerDir: dir }), /email/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("issuing says plainly when the signing key is missing rather than failing obscurely", () => {
  const dir = scratch();
  try {
    assert.throws(
      () => issue({ name: "Ada Lovelace", email: "ada@example.com", keyFile: path.join(dir, "nope.pem"), ledgerDir: dir }),
      /keygen/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the receipt is something you can paste to a buyer as it stands", () => {
  const record = { id: "SR-2026-0001", name: "Ada Lovelace", email: "ada@example.com", issued: "2026-10-11", updatesUntil: "2027-10-11" };
  const text = receiptText(record, "SR1.payload.signature");

  assert.match(text, /Ada Lovelace/);
  assert.match(text, /SR-2026-0001/);
  assert.match(text, /SR1\.payload\.signature/);
  assert.match(text, /shipreel licence install/);
  assert.match(text, /30 days/, "the refund window is part of what was sold");
  assert.ok(!/\.pem|private key/i.test(text), "a receipt must never mention the signing key");
});

test("the ledger appends rather than overwriting, and survives a reread", () => {
  const dir = scratch();
  try {
    appendLedger(dir, { id: "SR-2026-0001", name: "Ada Lovelace" });
    appendLedger(dir, { id: "SR-2026-0002", name: "Grace Hopper" });
    assert.equal(readLedger(dir).length, 2);
    assert.match(readFileSync(path.join(dir, "ledger.jsonl"), "utf8"), /\n$/, "JSON lines end with a newline");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an empty ledger directory reads as no sales, not as an error", () => {
  const dir = scratch();
  try {
    assert.deepEqual(readLedger(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the ledger holds customer emails, so git must ignore it", () => {
  const ignores = readFileSync(path.join(import.meta.dirname, "..", ".gitignore"), "utf8");
  assert.match(ignores, /^licences\/$/m);
});
