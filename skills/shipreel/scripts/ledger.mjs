/**
 * The posted ledger: <campaign-dir>/posted.json records which pieces have gone out, so an update
 * (campaign_update.mjs) knows what it may still change. Posted pieces are never rewritten.
 *
 *   { "at": "<ISO time of the last change>", "keys": ["linkedin/00-announce", "x/01-pain-hook"] }
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** What has been posted. A missing or broken file reads as nothing posted. */
export function readPosted(dir) {
  try {
    const data = JSON.parse(readFileSync(path.join(dir, "posted.json"), "utf8"));
    const keys = Array.isArray(data?.keys) ? [...new Set(data.keys.filter((k) => typeof k === "string"))].sort() : [];
    return { keys, at: typeof data?.at === "string" ? data.at : null };
  } catch {
    return { keys: [], at: null };
  }
}

/** Write the ledger, sorted and unique. Returns its path. */
export function writePosted(dir, keys, { at = new Date().toISOString() } = {}) {
  const file = path.join(dir, "posted.json");
  writeFileSync(file, `${JSON.stringify({ at, keys: [...new Set(keys)].sort() }, null, 2)}\n`);
  return file;
}

/** "I'm on day N": every piece on that day and the days before it. Unscheduled pieces are not included. */
export function postedThroughDay(days, day) {
  return days.filter((d) => d.day != null && d.day <= day).flatMap((d) => d.posts);
}

/** The calendar without what has been posted; days left empty are dropped. */
export function remaining(days, postedKeys) {
  const posted = new Set(postedKeys);
  return days.map((d) => ({ ...d, posts: d.posts.filter((k) => !posted.has(k)) })).filter((d) => d.posts.length);
}
