import { test } from "node:test";
import assert from "node:assert/strict";

import { compactNumber, parseGitHubRemote, githubMetrics, npmMetrics, metricClaims } from "../skills/brag/scripts/metrics.mjs";

test("compactNumber reads like a social post", () => {
  assert.equal(compactNumber(7), "7");
  assert.equal(compactNumber(4210), "4.2k");
  assert.equal(compactNumber(12000), "12k");
  assert.equal(compactNumber(1_530_000), "1.5M");
});

test("parseGitHubRemote handles https and ssh remotes", () => {
  assert.deepEqual(parseGitHubRemote("https://github.com/irvinosazee/brag.git"), { owner: "irvinosazee", repo: "brag" });
  assert.deepEqual(parseGitHubRemote("git@github.com:heygen-com/hyperframes.git"), { owner: "heygen-com", repo: "hyperframes" });
  assert.equal(parseGitHubRemote("https://gitlab.com/a/b.git"), null);
});

const fakeFetch = (routes) => async (url) => {
  const body = routes[url];
  return body === undefined
    ? { ok: false, status: 404, json: async () => ({ message: "Not Found" }) }
    : { ok: true, status: 200, json: async () => body };
};

test("githubMetrics returns stars and forks with their source URL", async () => {
  const metrics = await githubMetrics(
    { owner: "acme", repo: "app" },
    { fetch: fakeFetch({ "https://api.github.com/repos/acme/app": { stargazers_count: 4210, forks_count: 88, private: false } }), now: "2026-09-17T04:00:00Z" },
  );
  assert.deepEqual(metrics, [
    { id: "github-stars", label: "GitHub stars", value: 4210, source: "https://api.github.com/repos/acme/app", fetchedAt: "2026-09-17T04:00:00Z" },
    { id: "github-forks", label: "forks", value: 88, source: "https://api.github.com/repos/acme/app", fetchedAt: "2026-09-17T04:00:00Z" },
  ]);
});

test("githubMetrics reports a private or missing repo instead of inventing numbers", async () => {
  await assert.rejects(() => githubMetrics({ owner: "acme", repo: "secret" }, { fetch: fakeFetch({}) }), /acme\/secret: GitHub returned 404/);
});

test("npmMetrics returns last-week downloads", async () => {
  const metrics = await npmMetrics("tiny-date", {
    fetch: fakeFetch({ "https://api.npmjs.org/downloads/point/last-week/tiny-date": { downloads: 15320, package: "tiny-date" } }),
    now: "2026-09-17T04:00:00Z",
  });
  assert.deepEqual(metrics, [
    { id: "npm-weekly-downloads", label: "npm downloads last week", value: 15320, source: "https://api.npmjs.org/downloads/point/last-week/tiny-date", fetchedAt: "2026-09-17T04:00:00Z" },
  ]);
});

test("metricClaims leaves out zero values, which are true but nothing to brag about", () => {
  const claims = metricClaims([
    { id: "github-stars", label: "GitHub stars", value: 0, source: "https://api.github.com/repos/a/b", fetchedAt: "2026-09-17T04:00:00Z" },
    { id: "npm-weekly-downloads", label: "npm downloads last week", value: 211000, source: "https://api.npmjs.org/downloads/point/last-week/x", fetchedAt: "2026-09-17T04:00:00Z" },
  ]);
  assert.deepEqual(claims.map((c) => c.text), ["211k npm downloads last week"]);
});

test("metricClaims turns metrics into claims.json entries with on-screen wording", () => {
  const claims = metricClaims([{ id: "github-stars", label: "GitHub stars", value: 4210, source: "https://api.github.com/repos/acme/app", fetchedAt: "2026-09-17T04:00:00Z" }]);
  assert.deepEqual(claims, [{ text: "4.2k GitHub stars", value: 4210, source: "https://api.github.com/repos/acme/app", fetchedAt: "2026-09-17T04:00:00Z" }]);
});
