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
