import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(path.join(root, relative), "utf8");
const countFiles = (dir, extension) =>
  readdirSync(path.join(root, dir)).filter((name) => name.endsWith(extension)).length;

const readme = read("README.md");

// The comparison table drifts the moment a script or a reference doc is added, and a sales
// page that cites it inherits the lie. Parse the table and check it against the repo.
const tableClaim = (label) => {
  const row = readme.match(new RegExp(`^\\| ${label} \\|([^|]*)\\|([^|]*)\\|`, "m"));
  assert.ok(row, `"${label}" row missing from the comparison table`);
  return row[2].trim();
};

test("the README's script count matches the scripts that exist", () => {
  const scripts = countFiles("skills/shipreel/scripts", ".mjs");
  assert.equal(tableClaim("Skill scripts"), String(scripts));
});

test("the README's reference-doc count matches the references that exist", () => {
  const references = countFiles("skills/shipreel/references", ".md");
  assert.equal(tableClaim("Reference docs"), String(references));
});

test("the README's test count matches the tests that run", () => {
  const declared = readdirSync(path.join(root, "tests"))
    .filter((name) => name.endsWith(".test.mjs"))
    .reduce((total, name) => total + (read(`tests/${name}`).match(/^test\(/gm)?.length ?? 0), 0);
  assert.match(tableClaim("Tests"), new RegExp(`\\b${declared}\\b`));
});

test("the README does not promise an install route that does not exist", () => {
  for (const stale of ["/plugin marketplace add", "npx skills add", "marketplace catalog", "skills add shipreel"]) {
    const lines = readme
      .split("\n")
      .filter((line) => line.includes(stale) && !line.trimStart().startsWith("> **Not published"));
    assert.deepEqual(lines, [], `README still advertises "${stale}"`);
  }
});

test("the README's HTML disclosure tags are balanced", () => {
  assert.equal((readme.match(/<details/g) ?? []).length, (readme.match(/<\/details>/g) ?? []).length);
});

test("the commercial licence sells one tier, not two", () => {
  const licence = read("LICENSE-COMMERCIAL.md");
  for (const tiered of ["solo licence", "team licence", "a solo", "a team"]) {
    assert.ok(!licence.toLowerCase().includes(tiered), `licence still mentions "${tiered}"`);
  }
});

test("the commercial licence states plainly that there is no DRM", () => {
  assert.match(read("LICENSE-COMMERCIAL.md"), /no DRM/i);
});
