# 0.5 Campaign update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/shipreel max update "<what changed>"` brings a running campaign up to date. It asks where you are in the plan, rescans the code and the git history, checks every talking point against them, then rewrites only the unposted pieces that are now wrong and adds pieces for what is new and backed up. Posted pieces are never touched.

**Architecture:** There are three new modules with one job each. `ledger.mjs` tracks what has been posted. `talking_points.mjs` checks the user's notes against commits, claims and files. `campaign_update.mjs` finds stale pieces, plans the update, then applies it through the existing `writePiece` / `planCalendar` / `writeDesk` / `checkCampaign` path. The campaign folder becomes stateful: `campaign.json` records the commit it was built from, `claims.json` keeps a copy of the claims it was built with, and `posted.json` is the ledger. The desk reads and writes the ledger.

**Tech Stack:** Node ESM, `node:test`, git CLI (through `git_story.mjs`), and the File System Access API in the desk (Chrome), with a download as the fallback.

**Spec:** The design in the conversation of 2026-11-13, summarised here because no separate spec file exists:
1. **Where you are:** read `posted.json`. If it is missing or older than the calendar, ask the user which day they are on or which pieces have gone out, and write that down. Only the remaining pieces are candidates.
2. **Scan:** rebuild the dossier (code, README, claims), then read the git history since the commit in `campaign.json`.
3. **Validate the talking points:** every line in the user's note and in `feedback.md` must be backed by a commit, a verified claim or a file in the repo. An unbacked point is reported and never written into a post.
4. **Find stale pieces:** an unposted piece is stale if a claim it uses no longer verifies, or if a backed point names the same topic as the piece.
5. **Plan first:** show what will be kept, rewritten, added and followed up, and change nothing until the user approves.
6. **Apply:** rewrite the stale pieces in place, add new pieces with the `update` angle, re-plan the remaining days from the user's current day, write `changes.md`, then run the campaign check.
7. **Desk:** show a Changed badge and filter, and seed the ticks from `posted.json`, with a Save progress button that writes it.

## Global Constraints

- Aggressive means persuasive, never deceptive: no invented numbers, testimonials or false scarcity. The claims check stays on and has to pass after every update.
- Feedback is quoted only as "people asked …", never as a named person or an invented reaction.
- Posted pieces (keys in `posted.json`) are never rewritten, moved or deleted.
- Piece ids keep the `NN-angle` pattern (`/^\d\d-[a-z-]+$/`), because `parseCalendar` depends on it.
- The package name is always `@irvinosazee/shipreel`. Never write the bare package name after `npx` (docs_truth fails on it).
- Every page people open carries `faviconTag()` (pinned by `tests/favicon.test.mjs`).
- Copy has no em dashes. README counts (scripts, tests) are updated in the task that changes them.
- Nothing is pushed, published or posted without asking the user.

## Review Focus

- **A campaign built before 0.5** (no `commit` in `campaign.json`, no `claims.json` copy): update must still work. It takes the history since the campaign folder's mtime and re-checks claims from the dossier. Test in Task 4.
- **A user who says "day 3" when days 1 to 3 are only partly posted:** a day number marks that day and every earlier day as posted. Explicit keys can untick single pieces. Test in Task 1.
- **A note with only unbacked points:** nothing is regenerated. The plan reports each point and says what to add to `claims.json` to back it. Test in Task 4.
- **Everything already posted:** update adds only follow-up pieces and new calendar days after the last posted day, and never re-plans history. Test in Task 4.
- **The desk opened from disk in Safari or Firefox** (no `showDirectoryPicker`): Save progress downloads `posted.json` and says where to put it. Test in Task 6.

---

### Task 1: The posted ledger

**Files:**
- Create: `skills/shipreel/scripts/ledger.mjs`
- Test: `tests/ledger.test.mjs`

**Interfaces:**
- Produces: `readPosted(dir: string) -> { keys: string[], at: string|null }`. A missing or broken file reads as `{ keys: [], at: null }`.
- Produces: `writePosted(dir: string, keys: string[], { at = new Date().toISOString() } = {}) -> string`. Writes `<dir>/posted.json` as `{ "at", "keys" }`, with the keys sorted and unique, and returns the path.
- Produces: `postedThroughDay(days: {day:number|null, posts:string[]}[], day: number) -> string[]`. Returns every key on days `<= day`.
- Produces: `remaining(days, postedKeys: string[]) -> {day, posts}[]`. The days with posted keys removed, and empty days dropped.

- [x] **Step 1: Write the failing tests**

```js
test("a day number marks that day and every earlier day posted", () => {
  const days = [{ day: 1, posts: ["x/01-a", "tiktok/01-a"] }, { day: 2, posts: ["x/02-b"] }, { day: 3, posts: ["x/03-c"] }];
  assert.deepEqual(postedThroughDay(days, 2), ["x/01-a", "tiktok/01-a", "x/02-b"]);
  assert.deepEqual(remaining(days, ["x/01-a", "tiktok/01-a", "x/02-b"]), [{ day: 3, posts: ["x/03-c"] }]);
});
test("the ledger round-trips sorted and unique; a missing or broken file is empty", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ledger-"));
  assert.deepEqual(readPosted(dir), { keys: [], at: null });
  writePosted(dir, ["x/02-b", "x/01-a", "x/01-a"], { at: "2026-11-13T00:00:00.000Z" });
  assert.deepEqual(readPosted(dir), { keys: ["x/01-a", "x/02-b"], at: "2026-11-13T00:00:00.000Z" });
  writeFileSync(path.join(dir, "posted.json"), "{nope");
  assert.deepEqual(readPosted(dir).keys, []);
});
```

- [x] **Step 2: Run** `node --test tests/ledger.test.mjs`. Expected: FAIL, because the module is not found.
- [x] **Step 3: Implement** the four functions in `ledger.mjs`, following the signatures above.
- [x] **Step 4: Run** `node --test tests/ledger.test.mjs`. Expected: PASS.
- [x] **Step 5: Commit:** `git add skills/shipreel/scripts/ledger.mjs tests/ledger.test.mjs README.md && git commit -m "Ledger: posted.json records which campaign pieces have gone out"`. Bump the README script count by 1 and the test count by 2.

### Task 2: A campaign remembers what it was built from

**Files:**
- Modify: `skills/shipreel/scripts/campaign.mjs` (`buildCampaign`, the end of the function)
- Modify: `skills/shipreel/scripts/desk.mjs` (`writeDesk`: merge into `campaign.json`, do not overwrite)
- Modify: `skills/shipreel/scripts/claims.mjs` (add `claimsUsed`)
- Test: `tests/campaign.test.mjs`, `tests/claims.test.mjs`, `tests/desk.test.mjs`

**Interfaces:**
- Produces: `campaign.json` gains `"commit": "<HEAD sha or null>"` and `"builtAt": "<ISO>"`. `writeDesk` keeps every existing key and only sets `product`, `accent` and `onAccent`.
- Produces: `<campaignDir>/claims.json`, the claims list `buildCampaign` checked against (verified claims plus brief facts), written as JSON.
- Produces: `claimsUsed(text: string, claims: {text:string}[]) -> {text:string}[]` in `claims.mjs`. Returns the claims whose `normalizeText(text)` appears in `normalizeText(pieceText)`.
- Produces: `pieceText(pieceDir: string) -> string` in `campaign_check.mjs` (export the existing caption + thread + cards text join, or add it there). Task 3 uses it.

- [x] **Step 1: Write the failing tests**
  - `campaign.test.mjs` "a built campaign records its commit, build time and the claims it was checked against": after the existing fixture run, `campaign.json.commit` matches `/^[0-9a-f]{40}$/`, `builtAt` parses as a date, and `claims.json` is a non-empty array.
  - `desk.test.mjs` "writeDesk keeps keys it does not own in campaign.json": pre-write `{ "commit": "abc" }`, call `writeDesk`, and `commit` is still `"abc"`.
  - `claims.test.mjs` "claimsUsed finds the claims a piece repeats": `claimsUsed("Free. 344 tests, on every push.", [{text:"344 tests"},{text:"MIT"}])` deep-equals `[{text:"344 tests"}]`.
- [x] **Step 2: Run** `node --test tests/campaign.test.mjs tests/desk.test.mjs tests/claims.test.mjs`. Expected: the three new tests FAIL.
- [x] **Step 3: Implement.** The commit comes from `git rev-parse HEAD` in `projectDir`, or `null` outside git.
- [x] **Step 4: Run** the same command. Expected: PASS.
- [x] **Step 5: Commit:** "Campaign: records the commit and claims it was built from".

### Task 3: Talking points checked against the repo

**Files:**
- Create: `skills/shipreel/scripts/talking_points.mjs`
- Test: `tests/talking_points.test.mjs`

**Interfaces:**
- Consumes: `gitStory`'s commit list (use `readLog` from `git_story.mjs`; export it if it is private) and `verifyClaims` from `claims.mjs`.
- Produces: `parsePoints(note: string, feedbackMd?: string) -> {text:string, kind:"change"|"feedback"}[]`. The note splits on sentences and newlines. Each bullet in `feedback.md` is `kind:"feedback"`, as is any note line that starts with "people", "users" or "someone".
- Produces: `topicWords(text: string) -> string[]`. Lowercase words of 4 or more letters with stopwords removed, plus version strings (`/\d+\.\d+(\.\d+)?/`).
- Produces: `validatePoints(points, { projectDir, since: string|null, claims: object[] }) -> {text, kind, backed:boolean, evidence:{kind:"commit"|"claim"|"file", ref:string, line:string}[]}[]`.

  Evidence rules:
  - **commit:** a commit since `since` whose subject shares at least 2 topic words with the point, or the point's version string.
  - **claim:** a currently verified claim that shares at least 2 topic words.
  - **file:** a README or docs line that shares at least 2 topic words.

  `backed` is true when there is any evidence. A `feedback` point is backed only when the answer to it is backed, so "people ask if it works for Python" needs evidence for `python`.

- [x] **Step 1: Write the failing tests.** Use a temp git repo fixture: README "Works with Python and Node.", plus a commit "Cards: a long slide headline takes a third line" tagged after `since`.

```js
test("a change backed by a commit since the campaign is backed, with the commit as evidence", () => {
  const [p] = validatePoints(parsePoints("Slide headlines no longer get cut."), { projectDir, since, claims: [] });
  assert.equal(p.backed, true); assert.equal(p.evidence[0].kind, "commit");
});
test("a point nothing in the repo supports is unbacked and carries no evidence", () => {
  const [p] = validatePoints(parsePoints("Now 10x faster than every competitor."), { projectDir, since, claims: [] });
  assert.equal(p.backed, false); assert.deepEqual(p.evidence, []);
});
test("feedback is backed by the answer: Python support found in the README", () => {
  const [p] = validatePoints(parsePoints("", "- people keep asking if it works for Python"), { projectDir, since, claims: [] });
  assert.equal(p.kind, "feedback"); assert.equal(p.backed, true); assert.equal(p.evidence[0].kind, "file");
});
```

- [x] **Step 2: Run** `node --test tests/talking_points.test.mjs`. Expected: FAIL.
- [x] **Step 3: Implement** the module, following the signatures and evidence rules above.
- [x] **Step 4: Run** the same command. Expected: PASS.
- [x] **Step 5: Commit:** "Talking points: every point in an update is checked against commits, claims and files". Update the README counts.

### Task 4: Plan and apply an update

**Files:**
- Create: `skills/shipreel/scripts/campaign_update.mjs`
- Modify: `skills/shipreel/scripts/brief.mjs` (`ANGLES.update = "what changed since the campaign started, from a backed talking point"`)
- Modify: `skills/shipreel/scripts/angles.mjs` (`draft("update", …)` takes `brief.updates[i]`: hook = the point, beats = [the point, its evidence line, cta])
- Modify: `skills/shipreel/scripts/campaign.mjs` (`planCalendar(plan, { days, perDay, startDay = 1 })`, so days are numbered from `startDay`)
- Test: `tests/campaign_update.test.mjs`

**Interfaces:**
- Consumes: Task 1 (`readPosted`, `remaining`), Task 2 (`campaign.json.commit`, `claims.json`, `claimsUsed`, `pieceText`) and Task 3 (`parsePoints`, `validatePoints`, `topicWords`).
- Produces: `planUpdate(campaignDir, { projectDir, note = "", posted: string[], currentDay: number }) -> { position:{currentDay, posted:string[]}, points:ValidatedPoint[], keep:string[], rewrite:{key, why:string}[], add:{platform, angle:"update", point:string}[], followUps:{key, point:string}[], unbacked:string[] }`.

  Rules:
  - **rewrite:** an unposted piece with a used claim that `verifyClaims` now fails, or with 2 or more topic words shared with a backed point.
  - **add:** one piece per backed `change` point, on each platform the campaign uses, up to 5 pieces in total.
  - **followUps:** a posted piece that shares topic words with a backed point. It gets a new piece, never an edit.
  - **unbacked:** the text of each point with `backed:false`.

  When there is no `commit`, `since` is null, so the history scan uses the whole log since `builtAt`.
- Produces: `applyUpdate(campaignDir, plan, { projectDir, log }) -> { changed:string[], check }`.
  - Rewrites each `rewrite` piece through `writePiece` with the same id.
  - Adds pieces with the next free `NN` per platform, in the form `NN-update`.
  - Writes `"changed": { "at", "why" }` into each touched `post.json`.
  - Re-plans the unposted pieces with `planCalendar(..., { startDay: currentDay + 1 })`, keeping the posted days as they were.
  - Writes `changes.md`, calls `writeDesk`, and runs `checkCampaign` with the current claims.
- Produces: the CLI `campaign_update.mjs <campaign-dir> --note "<text>" [--day N | --posted k1,k2] [--plan-only] [--project <dir>]`. With `--plan-only` it prints the plan as JSON and writes nothing.

- [x] **Step 1: Write the failing tests** on a fixture campaign built by `buildCampaign` (reuse the `campaign.test.mjs` fixture), then commit a change to the fixture repo:
  - "posted pieces are never in rewrite, add or followUps edits": the plan with `posted = postedThroughDay(days, 2)` never lists a posted key in `rewrite`, and after `applyUpdate` the posted pieces' files are byte-identical.
  - "a claim that no longer verifies makes the unposted pieces that use it stale": delete the quoted README line, and every unposted piece whose text has that claim is in `rewrite` with a `why` naming the claim.
  - "only unbacked points: nothing is rewritten or added, and each point is reported": `note = "Now 10x faster."` gives `rewrite = []`, `add = []` and `unbacked = ["Now 10x faster."]`.
  - "a backed change adds NN-update pieces and the calendar restarts after the current day": the new keys match `/\/0[6-9]-update$/`, `calendar.md` keeps days 1 to 2, and the next day is `## Day 3`.
  - "everything posted: only follow-ups and new days after the last one".
  - "a pre-0.5 campaign (no commit, no claims.json) still plans".
  - "the campaign check passes after an update" (`check.ok === true`).
- [x] **Step 2: Run** `node --test tests/campaign_update.test.mjs`. Expected: FAIL.
- [x] **Step 3: Implement** `planUpdate`, `applyUpdate`, the `update` angle and `startDay`.
- [x] **Step 4: Run** `npm test`. Expected: all pass, including the existing `planCalendar` tests (the default `startDay = 1` changes nothing).
- [x] **Step 5: Commit:** "Update: rewrite only the unposted pieces a backed change affects; posted ones never move". Update the README counts.

**As built (differences from the plan above):**
- `update` is not added to `ANGLES` in `brief.mjs`: that list is shown in brief.md as angles a user can pick, and an update piece is never picked from the brief. `angles.mjs` exports `updatePiece(point, { brief, platform, n })` and `UPDATE_WHY` instead.
- Stale also covers git-story facts that have no source: "1 day · 1 commit · 1 contributor" is stale once today's dossier no longer states it word for word. `freshBrief(brief, brokenTexts, storyNow)` redrafts from a copy of the brief with that line moved to today's figures. `brief.md` is not edited; `changes.md` lists its stale lines.
- `checkCampaign` takes `skip` (posted keys). Posted pieces are history and are not re-checked, but their hooks still count against repeats.
- A backed `feedback` point is not turned into a piece mechanically. It is listed in `plan.feedback` with its evidence, for the agent to answer in the brief's tone.

### Task 5: CLI command and the skill's update flow

**Files:**
- Modify: `skills/shipreel/scripts/cli.mjs` (`update: { script: "campaign_update.mjs", summary: "bring a running campaign up to date: what changed, checked against the code, only unposted pieces rewritten" }`)
- Modify: `skills/shipreel/SKILL.md` (the `max update` trigger) and `skills/shipreel/references/campaign.md` (a new "Updating a running campaign" section)
- Modify: `docs/manual.md` (the max section) and `README.md` (one line)
- Test: `tests/cli.test.mjs`, `tests/docs_truth.test.mjs` (the existing count checks)

The `references/campaign.md` section fixes the agent's order, which is the user's requirement:
1. **Ask where they are.** Read `posted.json`. If it is missing, or older than the last calendar day the user could have reached, ask in one question: "Which day of the calendar are you on, or which pieces have you posted?" Write the answer with `writePosted`.
2. **Scan.** Run `campaign_update.mjs --plan-only`, which rebuilds the dossier and reads git since the campaign's commit.
3. **Validate.** Show the backed points with their evidence, and the unbacked points with "add a claim to `claims.json` to use this".
4. **Show the plan** (kept, rewritten, added, follow-ups) and wait for approval.
5. **Apply,** then rewrite the new and changed captions in the brief's tone (the same step 3 as `max`), then run the claims check.
6. **Report** what changed (`changes.md`) and remind the user that nothing is posted.

- [x] **Step 1: Write the failing test:** `cli.test.mjs` "update is a command" (asserts that the help output lists `update`).
- [x] **Step 2: Run** `node --test tests/cli.test.mjs`. Expected: FAIL.
- [x] **Step 3: Implement** the CLI entry and write the docs sections as listed above.
- [x] **Step 4: Run** `npm test`. Expected: all pass.
- [x] **Step 5: Commit:** "Max update: ask where the campaign is, check what changed, then rewrite only what's left".

### Task 6: The desk knows what is posted and what changed

**Files:**
- Modify: `skills/shipreel/scripts/desk.mjs` (`readPiece` adds `changed: meta.changed ?? null`; `readCampaign` adds `posted: readPosted(dir).keys`; page JS)
- Modify: `skills/shipreel/scripts/desk.mjs` (the in-page folder loader reads `posted.json` and `changed` in the same way)
- Test: `tests/desk.test.mjs`

**Interfaces:**
- Consumes: Task 1 `readPosted`, and Task 4's `post.json.changed`.
- Produces in the page:
  - Ticks are seeded from `data.posted` on top of localStorage. Their union shows as ticked.
  - A "Changed" badge on pieces with `changed`, and a "Changed" filter pill in the bar.
  - A "Save progress" button. When `showDirectoryPicker` exists, it writes `posted.json` into the picked folder. Otherwise it downloads `posted.json` and shows "Saved posted.json to your downloads: move it into the campaign folder."

- [x] **Step 1: Write the failing tests**
  - "readCampaign carries posted keys and each piece's changed note": a fixture with `posted.json` and a `post.json` with `changed` gives `data.posted` and `pieces[k].changed`.
  - "the page has a Changed filter and a Save progress control with a download fallback": `deskHtml(data)` contains `Save progress`, `showDirectoryPicker`, `posted.json` and `Changed`.
- [x] **Step 2: Run** `node --test tests/desk.test.mjs`. Expected: FAIL.
- [x] **Step 3: Implement.** Keep the night look's pill bar and put the filter pill there. Check screenshots at 1440 and 390 px wide (`chrome.mjs` `withPage` with `Emulation.setDeviceMetricsOverride`) and confirm there is no horizontal scroll.
- [x] **Step 4: Run** `npm test`. Expected: all pass.
- [x] **Step 5: Commit:** "Desk: ticks seeded from posted.json, Save progress, Changed badge and filter".

### Task 7: Dogfood and release prep

- [ ] **Step 1:** Run the update on the shipreel campaign in `~/Downloads/shipreel-campaign` (copy it to the scratchpad first) with `--day 1` and the note "0.4.2: slide headlines take a third or fourth line instead of being cut. Every page has the shipreel favicon." Confirm that both points come back backed by commits `f055b0d`/`81fcd9c` and `a7ff320`, that the Day 1 pieces are byte-identical, and that the check passes.
- [ ] **Step 2:** Write `reviews/0.5.0-update-shipreel.md`, covering what was weak and what changed, in the format of `reviews/0.4.0-max-heartrank.md`.
- [ ] **Step 3:** Bump `.claude-plugin/plugin.json` to `0.5.0` and run `npm test`. **Stop and ask the user** before merging, pushing, publishing, tagging or updating the site.
