import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { postedThroughDay, readPosted, remaining, writePosted } from "../skills/shipreel/scripts/ledger.mjs";

test("a day number marks that day and every earlier day posted", () => {
  const days = [{ day: 1, posts: ["x/01-a", "tiktok/01-a"] }, { day: 2, posts: ["x/02-b"] }, { day: 3, posts: ["x/03-c"] }];
  assert.deepEqual(postedThroughDay(days, 2), ["x/01-a", "tiktok/01-a", "x/02-b"]);
  assert.deepEqual(remaining(days, ["x/01-a", "tiktok/01-a", "x/02-b"]), [{ day: 3, posts: ["x/03-c"] }]);
  // Pieces the calendar does not list (day: null) are never posted by a day number.
  assert.deepEqual(postedThroughDay([...days, { day: null, posts: ["x/09-z"] }], 9), ["x/01-a", "tiktok/01-a", "x/02-b", "x/03-c"]);
});

test("the ledger round-trips sorted and unique; a missing or broken file is empty", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ledger-"));
  assert.deepEqual(readPosted(dir), { keys: [], at: null });
  writePosted(dir, ["x/02-b", "x/01-a", "x/01-a"], { at: "2026-11-13T00:00:00.000Z" });
  assert.deepEqual(readPosted(dir), { keys: ["x/01-a", "x/02-b"], at: "2026-11-13T00:00:00.000Z" });
  writeFileSync(path.join(dir, "posted.json"), "{nope");
  assert.deepEqual(readPosted(dir).keys, []);
});
