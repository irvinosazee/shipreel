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

test("the README leads with the one-line install and every route that exists", () => {
  const install = readme.slice(readme.indexOf("## Install"), readme.indexOf("### Also works with"));
  assert.match(install, /npx @irvinosazee\/shipreel skill install/);
  assert.match(install, /\/plugin marketplace add irvinosazee\/shipreel/);
  assert.match(install, /npm i -g @irvinosazee\/shipreel/);
  assert.match(install, /### Updating/, "a user who installed once needs to know how to get the next version");
  assert.match(install, /star the repo/i, "the README is the funnel; it has to ask");
});

test("nothing tells anyone to run the unscoped shipreel package, which is somebody else's", () => {
  let hits = "";
  try {
    hits = execFileSync("git", ["grep", "-nE", "npx shipreel([^A-Za-z0-9@/_-]|$)|npm i(nstall)? (-g )?shipreel([^A-Za-z0-9@/_-]|$)", "--", ".", ":!tests/docs_truth.test.mjs"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  } catch (error) {
    if (error.status !== 1) throw error;
  }
  assert.equal(hits, "", `these lines would run a stranger's package:\n${hits}`);
});

test("the npm package is scoped, public, and still installs the shipreel command", async () => {
  const { packageJson } = await import("../scripts/pack-cli.mjs");
  const pkg = packageJson();
  assert.equal(pkg.name, "@irvinosazee/shipreel");
  assert.deepEqual(Object.keys(pkg.bin), ["shipreel"]);
  assert.equal(pkg.publishConfig?.access, "public", "a scoped package publishes as private without this");
  assert.equal(pkg.license, "MIT");
  assert.deepEqual(pkg.files.filter((f) => f.startsWith("LICENSE")), ["LICENSE"]);
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

test("the publishing guide is for an open-source release, not a sale", () => {
  const guide = read("PUBLISHING.md");
  assert.match(guide, /npm publish \.\/dist\/shipreel --access public/);
  assert.match(guide, /## 3\. Ship an update/);
  for (const stale of ["issuer-ed25519.pem", "issue-licence", "Take payment", "$49 once"]) {
    assert.ok(!guide.includes(stale), `PUBLISHING.md still says "${stale}" from the paid-product days`);
  }
});

test("the manual documents every flag the skill accepts", () => {
  // The options table in SKILL.md is the source of truth; a flag added there must reach users.
  const skill = read("skills/shipreel/SKILL.md");
  const table = skill.slice(skill.indexOf("| Option | Values | Default |"), skill.indexOf("Voice is opt-in."));
  const flags = [...table.matchAll(/^\| `(--[a-z-]+)`/gm)].map((m) => m[1]);
  assert.ok(flags.length > 20, `expected the options table, found ${flags.length} flags`);
  const manual = read("docs/manual.md");
  const missing = flags.filter((flag) => !manual.includes(`\`${flag}`));
  assert.deepEqual(missing, [], `docs/manual.md does not document ${missing.join(", ")}`);
});

test("the manual only ever installs the scoped package", () => {
  const manual = read("docs/manual.md");
  assert.match(manual, /npx @irvinosazee\/shipreel skill install/);
  assert.match(manual, /## 10\. Updating/);
});

test("the README points at a page that exists", () => {
  // The demo site (this repo's Pages) and the landing page (shipreel-site) are the two live URLs.
  for (const url of readme.match(/https:\/\/irvinosazee\.github\.io\/[^\s)"']+/g) ?? []) {
    assert.match(url, /^https:\/\/irvinosazee\.github\.io\/shipreel(-site)?\//, `unexpected site URL ${url}`);
  }
});
