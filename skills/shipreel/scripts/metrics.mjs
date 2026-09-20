#!/usr/bin/env node
/**
 * Live proof metrics: real, sourced numbers for the video — never invented ones.
 *
 *   node <skill-root>/scripts/metrics.mjs <project-dir> [--github owner/repo] [--npm package] [--out metrics.json]
 *
 * Without flags it reads the GitHub repo from the `origin` remote and the npm package from
 * package.json (unless private). Each metric carries its source URL and fetch time; the
 * `claims` in the output can be appended to claims.json. Set GITHUB_TOKEN for private repos
 * or rate limits; the token is only sent to api.github.com and never printed.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function compactNumber(n) {
  if (n < 1000) return String(n);
  const [value, unit] = n >= 1_000_000 ? [n / 1_000_000, "M"] : [n / 1000, "k"];
  return `${value >= 10 ? Math.round(value) : Number(value.toFixed(1))}${unit}`;
}

export function parseGitHubRemote(remote) {
  const match = String(remote).match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/);
  return match ? { owner: match[1], repo: match[2] } : null;
}

async function getJson(url, fetchImpl, headers = {}) {
  const response = await fetchImpl(url, { headers });
  if (!response.ok) throw Object.assign(new Error(`returned ${response.status}`), { status: response.status });
  return response.json();
}

export async function githubMetrics({ owner, repo }, { fetch: fetchImpl = fetch, now = new Date().toISOString(), token = process.env.GITHUB_TOKEN } = {}) {
  const source = `https://api.github.com/repos/${owner}/${repo}`;
  let data;
  try {
    data = await getJson(source, fetchImpl, token ? { Authorization: `Bearer ${token}` } : {});
  } catch (error) {
    throw new Error(`${owner}/${repo}: GitHub ${error.message}${error.status === 404 ? " (private repos need GITHUB_TOKEN)" : ""}`);
  }
  return [
    { id: "github-stars", label: "GitHub stars", value: data.stargazers_count, source, fetchedAt: now },
    { id: "github-forks", label: "forks", value: data.forks_count, source, fetchedAt: now },
  ];
}

export async function npmMetrics(name, { fetch: fetchImpl = fetch, now = new Date().toISOString() } = {}) {
  const source = `https://api.npmjs.org/downloads/point/last-week/${name}`;
  let data;
  try {
    data = await getJson(source, fetchImpl);
  } catch (error) {
    throw new Error(`${name}: npm ${error.message}`);
  }
  return [{ id: "npm-weekly-downloads", label: "npm downloads last week", value: data.downloads, source, fetchedAt: now }];
}

export function metricClaims(metrics) {
  // Zero stars or downloads stay in metrics.json but never become an on-screen claim.
  return metrics
    .filter((m) => m.value > 0)
    .map((m) => ({ text: `${compactNumber(m.value)} ${m.label}`, value: m.value, source: m.source, fetchedAt: m.fetchedAt }));
}

async function main(argv) {
  const [projectDir = ".", ...rest] = argv;
  const flag = (name) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined);
  const metrics = [];
  const errors = [];

  let github = flag("--github") ? parseGitHubRemote(`github.com/${flag("--github")}`) : null;
  if (!github) {
    try {
      github = parseGitHubRemote(execFileSync("git", ["remote", "get-url", "origin"], { cwd: projectDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim());
    } catch {
      github = null;
    }
  }
  if (github) await githubMetrics(github).then((m) => metrics.push(...m), (e) => errors.push(e.message));

  let npmName = flag("--npm");
  const pkgFile = path.join(projectDir, "package.json");
  if (!npmName && existsSync(pkgFile)) {
    const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
    if (!pkg.private && pkg.name) npmName = pkg.name;
  }
  if (npmName) await npmMetrics(npmName).then((m) => metrics.push(...m), (e) => errors.push(e.message));

  const result = { metrics, claims: metricClaims(metrics), errors };
  if (flag("--out")) writeFileSync(flag("--out"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
