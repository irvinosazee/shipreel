import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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

test("everything is MIT, carrying both copyrights", () => {
  const licence = read("LICENSE");
  assert.match(licence, /^MIT License/);
  assert.match(licence, /Copyright \(c\) 2026 Irvin Osazee/);
  assert.match(licence, /Copyright \(c\) 2026 Shunit Haviv Hakimi/, "the upstream copyright must travel with the code");
  assert.match(licence, /CC BY 4\.0/, "the bundled music is not MIT, and LICENSE has to say so");
  assert.equal(JSON.parse(read(".claude-plugin/plugin.json")).license, "MIT");
});

test("no commercial licence or licence gate survives the move to open source", () => {
  for (const gone of ["LICENSE-COMMERCIAL.md", "skills/shipreel/scripts/licence.mjs", "scripts/issue-licence.mjs"]) {
    assert.ok(!existsSync(path.join(root, gone)), `${gone} should be gone`);
  }
  for (const file of ["README.md", "PUBLISHING.md", "docs/other-agents.md", "skills/shipreel/scripts/cli.mjs", "skills/shipreel/scripts/doctor.mjs"]) {
    const text = read(file);
    for (const stale of ["LICENSE-COMMERCIAL", "licence install", "SHIPREEL_LICENCE"]) {
      assert.ok(!text.includes(stale), `${file} still mentions "${stale}"`);
    }
  }
});

test("no private key is ever committed", () => {
  let tracked = "";
  try {
    tracked = execFileSync("git", ["grep", "-lE", "BEGIN [A-Z ]*PRIVATE KEY", "--", ".", ":!tests/docs_truth.test.mjs"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  } catch (error) {
    // git grep exits 1 when nothing matches, which is the result this test wants.
    if (error.status !== 1) throw error;
  }
  assert.equal(tracked, "", "a private key must never be committed to a public repo");
});

test("the publishing guide does not tell you to do what was decided against", () => {
  const guide = read("PUBLISHING.md");
  for (const [phrase, why] of [
    ["Change visibility → Public", "the repo stays private"],
    ["/plugin marketplace add", "there is no marketplace listing"],
    ["npm publish", "the package is not published"],
    ["npx skills add", "there is no public clone to add from"],
  ]) {
    assert.ok(!guide.includes(phrase), `PUBLISHING.md still says "${phrase}" — ${why}`);
  }
});

test("the README points at a page that exists", () => {
  // The product repo is private; its own Pages site and the sales site are the two live URLs.
  for (const url of readme.match(/https:\/\/irvinosazee\.github\.io\/[^\s)"']+/g) ?? []) {
    assert.match(url, /^https:\/\/irvinosazee\.github\.io\/shipreel(-site)?\//, `unexpected site URL ${url}`);
  }
});
