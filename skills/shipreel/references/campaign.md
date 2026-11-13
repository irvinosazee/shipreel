# `max`: the whole campaign

`/shipreel max` turns a project into a two-week campaign: 3 to 5 different pieces for each of TikTok, Instagram, YouTube Shorts, LinkedIn and X, each with its video or images, caption, hashtags, alt text and posting metadata, plus a calendar and a posting desk (`campaign/index.html`). You shipped the code. Now ship the campaign.

Aggressive here means persuasive: sharp hooks, the pain named plainly, proof up front, one clear call to action. It never means deceptive: no invented numbers, no invented quotes or testimonials, no fake deadlines or scarcity. `campaign_check.mjs` fails a campaign that does any of these.

## 0. A video first (recommended)

Pieces show the project's real screens. Run the normal /shipreel video first (Steps 1 to 4) so the run has scene stills, review frames, a poster and a claims ledger. Without them, cards are text only and the brief has no verified proof.

## 1. The brief: pre-fill, then the user edits

```bash
node <skill-root>/scripts/campaign.mjs <project-dir> --brief-only
```

This writes `<output-dir>/brief.md` (and `brief.json`), pre-filled from the dossier. The script is the floor: it reads the README's own words, the verified claims and the git story, and leaves what it cannot know empty. **You fill the rest from the code.** Read the project the way a marketer would:

- **Who it is for:** a specific person, not "users". Read the README, the landing copy, the onboarding flow, the pricing page if there is one.
- **What hurts today:** the problem in the audience's words. Look at the README's "why", issue titles, error states the app handles, the empty state's copy.
- **What they do instead:** the workaround or competitor the product replaces.
- **What changes with it:** one sentence, concrete.
- **Proof:** only verified claims (`claims.json`) and git facts. If a strong fact is in the repo but not in the ledger, add it to `claims.json` with its source and quote first.
- **Doubts and answers:** the three objections this audience raises, each answered from a project fact.
- **The one thing to do next:** the live link or the install line.
- **Tone:** bold, playful, plain, premium, or deadpan.
- **Angles:** 3 to 5 from pain-hook, before-after, demo, myth-buster, proof, build-story, how-to, hot-take.
- **Hashtags:** 2 to 4 the audience actually follows, not generic reach tags.

Edit `brief.md` directly (keep the section headings). Then **show the user the brief and ask them to change anything**: who it is for, the pain, the tone, the angles. Their edits win; re-running keeps them. Do not generate the campaign until they approve the brief.

## 2. Generate

```bash
node <skill-root>/scripts/campaign.mjs <project-dir> [--platforms tiktok,instagram,...] [--videos]
```

It plans the angles (`angles.json`), writes every piece into `campaign/<platform>/<NN-angle>/`, renders the images, writes `calendar.md` and the posting desk (`index.html`, from `desk.mjs`), and runs the full check. `--videos` also renders each video piece through the card-video engine (about a minute each); without it, video pieces have their `content.json`, cover and caption, ready to render.

## 3. Make every piece good, in the brief's voice

The generated hooks and captions are the floor. Go through `campaign/` platform by platform and rewrite `caption.txt` / `thread.txt` (and `content.json` titles for videos) in the brief's tone:

- The first line is the hook. It must stop the scroll in under two seconds of reading. Lead with the pain, a surprising fact from the proof, or a bold claim the proof backs.
- One idea per piece. The angle decides it; do not repeat another piece's hook.
- Native to the platform: TikTok and Reels captions are short (the video carries it); LinkedIn opens with a line that earns "see more" in its first 210 characters; X threads make each post stand alone; YouTube titles under 100 characters.
- The call to action is the brief's, word for word or close.
- Keep every number and claim from the brief's proof. Never add one that is not there.

Then re-render what changed (`content.mjs` helpers, or run `campaign.mjs` again: the brief is kept, but hand edits to captions are overwritten, so edit captions last) and run:

```bash
node <skill-root>/scripts/campaign_check.mjs <output-dir>/campaign --claims <output-dir>/claims.json
```

Fix every error. Look at the images yourself (open `campaign/index.html`): a weak piece is cut or rewritten, not shipped.

## 4. Deliver

After rewriting captions, rebuild the desk so it shows them: `node <skill-root>/scripts/desk.mjs <output-dir>/campaign --no-open`.

Tell the user where the campaign is (`campaign/index.html` is the posting desk: open it, or run `shipreel desk`; `calendar.md` for the order), how many pieces per platform, and that nothing has been posted. Credit the music on any post that uses a video with bundled music.

## Updating a running campaign (`/shipreel max update`)

Products change mid-campaign: a feature ships, a number moves, people ask the same question. The update rewrites only what has not gone out, and only with what the repo backs. Follow this order; do not skip a step.

1. **Ask where they are.** Read `campaign/posted.json` (the desk's Save progress writes it). If it is missing, or the user may have posted since it was saved, ask one question: "Which day of the calendar are you on, or which pieces have you posted?" Record the answer: `--day N` (that day and every earlier one) or `--posted key1,key2`. Posted pieces are never rewritten, moved or deleted.
2. **Get the talking points.** What changed, in the user's words, as `--note`. What people said goes in `campaign/feedback.md` as bullets ("- people keep asking if it works for Python"), real comments only, never invented.
3. **Scan and validate:** `node <skill-root>/scripts/campaign_update.mjs <output-dir>/campaign --project <project-dir> --note "<what changed>" [--day N | --posted ...] --plan-only`. This rebuilds the dossier from the code, reads the git history since the commit the campaign was built from, and checks every point against commits, verified claims and the README and docs. Show the user each point as backed (with its evidence) or not backed. A point that is not backed stays out of every post; to use it, add a claim for it to `claims.json` (a file and a quote) and run again.
4. **Show the plan and wait for approval:** which pieces stay, which unposted pieces are rewritten and why (a claim they use no longer verifies, a git fact has moved on, or a backed point is about the same thing), which new pieces are added (one per backed change and platform, up to 5), and which posted pieces now have a follow-up.
5. **Apply:** the same command without `--plan-only` (`--day`/`--posted` write `posted.json`). It rewrites the stale pieces in their slots, adds `NN-update` pieces, re-plans everything left from the day after the current one, writes `changes.md`, rebuilds the desk and runs the campaign check.
6. **Make it good,** as in step 3 above, for the rewritten and new pieces only: rewrite their captions in the brief's tone, keep their facts, answer backed feedback (from `plan.feedback`) as "people asked …", never as a named person. Fix every error from the check, then rebuild the desk.
7. **Report:** what changed (point at `changes.md`), any lines `changes.md` says are stale in `brief.md`, and that nothing has been posted.
