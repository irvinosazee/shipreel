#!/usr/bin/env node
/**
 * Licence file for shipreel. Offline, signed, and deliberately not DRM.
 *
 *   node <skill-root>/scripts/licence.mjs show
 *   node <skill-root>/scripts/licence.mjs install <token>
 *
 * A licence is `SR1.<payload>.<signature>`, both base64url. The payload is JSON naming who
 * bought it; the signature is Ed25519 over the `SR1.<payload>` string, made by the issuer's
 * private key, which lives nowhere in this repository. Only the public key ships, so a copy
 * of shipreel can tell a real licence from an invented one without asking anybody.
 *
 * What this is not: it never calls home, never expires the software, and never stops anyone
 * running a copy they were given. A check that runs on the holder's machine could not do any
 * of that honestly. It exists so a copy can say whose it is — which is how updates, support
 * and refunds find the right person.
 *
 * Reading order: SHIPREEL_LICENCE in the environment (for CI), then ~/.shipreel/licence.
 */

import { createPublicKey, sign as signWith, verify as verifySignature } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TOKEN_VERSION = "SR1";

/** The issuer's Ed25519 public key (the `x` of its JWK). Public by design. */
export const ISSUER_PUBLIC_KEY = "F9iY0nqc_rSqNevELgDxj_GX2KJAsM-Eypn4TssLmgM";

const REQUIRED_FIELDS = ["id", "name", "issued"];

const keyFrom = (publicKey) =>
  typeof publicKey === "string"
    ? createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: publicKey }, format: "jwk" })
    : publicKey;

const encodeJson = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** Sign a licence. Only the issuing script calls this; it needs the private key. */
export function encodeLicence(details, privateKey) {
  const missing = REQUIRED_FIELDS.filter((field) => !details?.[field]);
  if (missing.length > 0) throw new Error(`a licence needs ${missing.join(", ")}`);

  const signed = `${TOKEN_VERSION}.${encodeJson(details)}`;
  return `${signed}.${signWith(null, Buffer.from(signed), privateKey).toString("base64url")}`;
}

export function licencePath(home = homedir()) {
  return path.join(home, ".shipreel", "licence");
}

/** The token in the environment, else the one on disk, else null. */
export function readLicenceToken({ env = process.env, home = homedir() } = {}) {
  const fromEnv = env.SHIPREEL_LICENCE?.trim();
  if (fromEnv) return { token: fromEnv, source: "SHIPREEL_LICENCE" };

  const file = licencePath(home);
  if (!existsSync(file)) return null;
  const token = readFileSync(file, "utf8").trim();
  return token ? { token, source: file } : null;
}

export function writeLicenceToken(token, { home = homedir() } = {}) {
  const file = licencePath(home);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  return file;
}

/**
 * Check a token against the issuer's key. Every failure is a named reason rather than a
 * throw: a licence problem should read as a sentence, not a stack trace.
 */
export function verifyLicence(token, { publicKey = ISSUER_PUBLIC_KEY, now = new Date() } = {}) {
  const fail = (reason) => ({ valid: false, reason, licensee: null, payload: null, updatesExpired: false });

  if (!token?.trim()) return fail("licence is empty");

  const parts = token.trim().split(".");
  if (parts.length !== 3 || !parts.every(Boolean)) {
    return fail(`licence is not in the ${TOKEN_VERSION}.<payload>.<signature> form`);
  }

  const [version, payloadPart, signaturePart] = parts;
  if (version !== TOKEN_VERSION) {
    if (/^SR\d+$/.test(version)) return fail(`licence format ${version} is newer than this copy of shipreel understands`);
    return fail(`licence is not in the ${TOKEN_VERSION}.<payload>.<signature> form`);
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  } catch {
    return fail("licence payload is not readable");
  }

  const missing = REQUIRED_FIELDS.filter((field) => !payload?.[field]);
  if (missing.length > 0) return fail(`licence payload is missing ${missing.join(", ")}`);

  let matches = false;
  try {
    matches = verifySignature(
      null,
      Buffer.from(`${version}.${payloadPart}`),
      keyFrom(publicKey),
      Buffer.from(signaturePart, "base64url"),
    );
  } catch {
    return fail("licence signature is not readable");
  }
  if (!matches) return fail("signature does not match the licence");

  // Updates lapse; the licence does not. Nothing here ever makes a paid copy stop working.
  const updatesUntil = payload.updatesUntil ? new Date(payload.updatesUntil) : null;
  const updatesExpired = Boolean(updatesUntil && updatesUntil.getTime() < now.getTime());

  return { valid: true, reason: null, licensee: payload.name, payload, updatesUntil, updatesExpired };
}

/** Read and verify in one step — what the CLI and the doctor both want. */
export function licenceStatus({ env = process.env, home = homedir(), publicKey = ISSUER_PUBLIC_KEY, now = new Date() } = {}) {
  const found = readLicenceToken({ env, home });
  if (!found) {
    return { valid: false, reason: "no licence found", licensee: null, payload: null, updatesExpired: false, source: null };
  }
  return { ...verifyLicence(found.token, { publicKey, now }), source: found.source };
}

export function describeLicence(status) {
  if (!status.valid) {
    return status.reason === "no licence found"
      ? "no licence found — set SHIPREEL_LICENCE or write one to ~/.shipreel/licence"
      : `licence not valid: ${status.reason}`;
  }
  const until = status.payload.updatesUntil;
  const updates = status.updatesExpired ? `updates ended ${until}` : until ? `updates until ${until}` : "perpetual";
  return `licensed to ${status.licensee} (${status.payload.id}) — ${updates}`;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const [command, value] = process.argv.slice(2);
  if (command === "show") {
    const status = licenceStatus();
    console.log(describeLicence(status));
    process.exitCode = status.valid ? 0 : 1;
  } else if (command === "install" && value) {
    const status = verifyLicence(value);
    if (!status.valid) {
      console.error(`That licence did not verify: ${status.reason}`);
      process.exitCode = 1;
    } else {
      console.log(`${describeLicence(status)}\nwritten to ${writeLicenceToken(value)}`);
    }
  } else {
    console.error("Usage: licence.mjs show | licence.mjs install <token>");
    process.exitCode = 2;
  }
}
