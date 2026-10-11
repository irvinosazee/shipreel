#!/usr/bin/env node
/**
 * Issue a shipreel licence. This is the seller's script — it runs on your machine, and it is
 * the only thing that touches the signing key.
 *
 *   node scripts/issue-licence.mjs keygen
 *   node scripts/issue-licence.mjs --name "Ada Lovelace" --email ada@example.com [--months 12]
 *   node scripts/issue-licence.mjs list
 *
 * The key lives at ~/.shipreel/issuer-ed25519.pem and the ledger at licences/ledger.jsonl —
 * both outside anything git tracks, because one is a secret and the other holds customers'
 * email addresses. Back the key up: without it you cannot sign a licence for anyone new, and
 * the public key compiled into licence.mjs would have to change, which invalidates every
 * licence already sold.
 */

import { createPrivateKey, generateKeyPairSync } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { encodeLicence, verifyLicence } from "../skills/shipreel/scripts/licence.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULT_KEY_FILE = path.join(homedir(), ".shipreel", "issuer-ed25519.pem");
export const DEFAULT_LEDGER_DIR = path.join(ROOT, "licences");
export const DEFAULT_MONTHS = 12;

const iso = (date) => date.toISOString().slice(0, 10);
const ledgerFile = (dir) => path.join(dir, "ledger.jsonl");

/** The next id in this year's run, continuing from whatever is already recorded. */
export function nextLicenceId(existingIds, now = new Date()) {
  const year = now.getUTCFullYear();
  const used = existingIds
    .map((id) => new RegExp(`^SR-${year}-(\\d{4})$`).exec(id ?? ""))
    .filter(Boolean)
    .map((match) => Number(match[1]));
  const next = used.length > 0 ? Math.max(...used) + 1 : 1;
  return `SR-${year}-${String(next).padStart(4, "0")}`;
}

/** Add whole months, clamping to the end of a shorter month rather than spilling over. */
export function updatesUntil(issued, months = DEFAULT_MONTHS) {
  const [year, month, day] = issued.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return iso(new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day, lastDay))));
}

export function readLedger(dir = DEFAULT_LEDGER_DIR) {
  const file = ledgerFile(dir);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function appendLedger(dir, record) {
  mkdirSync(dir, { recursive: true });
  appendFileSync(ledgerFile(dir), `${JSON.stringify(record)}\n`);
  return ledgerFile(dir);
}

export function createIssuerKey(keyFile = DEFAULT_KEY_FILE) {
  if (existsSync(keyFile)) throw new Error(`${keyFile} already exists — move it aside before making a new one.`);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  mkdirSync(path.dirname(keyFile), { recursive: true, mode: 0o700 });
  writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  return { keyFile, publicKey: publicKey.export({ format: "jwk" }).x };
}

/** What you paste into the reply to a buyer. No key paths, no internals. */
export function receiptText(record, token) {
  return [
    `Hi ${record.name.split(" ")[0]},`,
    "",
    "Here is your shipreel licence. Install it once and you are done:",
    "",
    `  shipreel licence install ${token}`,
    "",
    "In CI, set SHIPREEL_LICENCE to the same value instead.",
    "",
    `Licence ${record.id}, issued to ${record.name} on ${record.issued}. Updates released up to`,
    `${record.updatesUntil} are included; after that the version you have keeps working, forever.`,
    "",
    "There is no activation and nothing phones home. If it is not for you, ask within",
    "30 days and I will refund you, no argument.",
    "",
    "— Irvin",
  ].join("\n");
}

export function issue({ name, email, keyFile = DEFAULT_KEY_FILE, ledgerDir = DEFAULT_LEDGER_DIR, months = DEFAULT_MONTHS }, { now = new Date() } = {}) {
  if (!name) throw new Error("a licence needs a name: --name \"Ada Lovelace\"");
  if (!email) throw new Error("a licence needs an email: --email ada@example.com");
  if (!existsSync(keyFile)) throw new Error(`No signing key at ${keyFile}. Run \`node scripts/issue-licence.mjs keygen\` first.`);

  const issued = iso(now);
  const record = {
    id: nextLicenceId(readLedger(ledgerDir).map((entry) => entry.id), now),
    name,
    email,
    issued,
    updatesUntil: updatesUntil(issued, months),
  };

  // The token carries no email: it is pasted around, and a buyer's address is not ours to spread.
  const token = encodeLicence(
    { id: record.id, name: record.name, issued: record.issued, updatesUntil: record.updatesUntil },
    createPrivateKey(readFileSync(keyFile)),
  );

  appendLedger(ledgerDir, { ...record, token });
  return { record, token, receipt: receiptText(record, token) };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  const flag = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);

  try {
    if (argv[0] === "keygen") {
      const { keyFile, publicKey } = createIssuerKey(flag("--key", DEFAULT_KEY_FILE));
      console.log(`Signing key written to ${keyFile} (mode 600). Back it up somewhere you trust.`);
      console.log(`\nPut this in ISSUER_PUBLIC_KEY in skills/shipreel/scripts/licence.mjs:\n\n  ${publicKey}\n`);
    } else if (argv[0] === "list") {
      const ledger = readLedger(flag("--ledger", DEFAULT_LEDGER_DIR));
      if (ledger.length === 0) console.log("No licences issued yet.");
      for (const entry of ledger) console.log(`${entry.id}  ${entry.issued}  ${entry.name} <${entry.email}>`);
    } else if (argv[0] === "verify") {
      const status = verifyLicence(argv[1] ?? "");
      console.log(status.valid ? `valid — ${status.licensee} (${status.payload.id})` : `not valid — ${status.reason}`);
      process.exitCode = status.valid ? 0 : 1;
    } else if (argv.includes("--name") || argv.includes("--email")) {
      const { record, receipt } = issue({
        name: flag("--name"),
        email: flag("--email"),
        keyFile: flag("--key", DEFAULT_KEY_FILE),
        ledgerDir: flag("--ledger", DEFAULT_LEDGER_DIR),
        months: Number(flag("--months", DEFAULT_MONTHS)),
      });
      console.log(`Issued ${record.id} to ${record.name}. Recorded in ${ledgerFile(flag("--ledger", DEFAULT_LEDGER_DIR))}.\n`);
      console.log("--- paste this to the buyer ---");
      console.log(receipt);
    } else {
      console.error("Usage: issue-licence.mjs keygen | list | verify <token> | --name <name> --email <email> [--months 12]");
      process.exitCode = 2;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
