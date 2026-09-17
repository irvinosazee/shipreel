# Iterating on a brag

A first render is rarely the last. These tools let a run resume, revise one part, and compare versions without starting over.

## Run state (every run)

At the start of a run, after choosing `<output-dir>`:

```bash
node <skill-root>/scripts/state.mjs init <output-dir> --invocation "<the full /brag invocation>"
```

At each step's gate, mark it done with the artifacts it produced:

| Step | Mark after | Artifacts |
|---|---|---|
| `preflight` | doctor has no blockers | — |
| `inspect` | the 9-question rubric is answered | — |
| `plan` | the plan gate | `brag-plan.md,scenes.json` |
| `compose` | the composition exists | `composition-brief.md,composition/index.html` |
| `check` | `hyperframes check` and `text_audit.mjs` pass | — |
| `draft` | the draft render exists | — |
| `review` | `review.md` is written | `review.md` |
| `render` | final render mastered, poster baked, verified | `brag.mp4,brag.jpg` |
| `deliver` | share copy and exports written | `share-copy.txt` |

```bash
node <skill-root>/scripts/state.mjs mark <output-dir> plan --artifacts brag-plan.md,scenes.json
```

## Resume (`--resume`, or an interrupted run)

```bash
node <skill-root>/scripts/state.mjs next <output-dir>
```

It returns the first step that is not done, or whose artifacts were edited or deleted since it finished (for example, the user edited `brag-plan.md` by hand). Continue from that step; everything before it stands. Tell the user which step you are resuming from and why.

## Revisions

Before any revision, save the current result so it can be compared and restored:

```bash
node <skill-root>/scripts/versions.mjs save <output-dir> --label "<what this version was>"
```

Read `<output-dir>/feedback.json` if it exists — notes per scene from Brag Studio — and treat them as the user's direction for the scenes they name.

| Invocation | What changes | Invalidate from |
|---|---|---|
| `/brag --reroll <scene>` | Only the named scene (name or number from `scenes.json`): new idea, same slot and timing unless the user asks otherwise. Keep every other scene's composition untouched. | `compose` |
| `/brag --retone <preset>` | Tone, writing, pacing, transitions, and audio posture across the storyboard; keep the project understanding. | `plan` |
| `/brag --shorter` | About 20% shorter (never under 15s). Start from the scenes `cuts.mjs plan` keeps, then re-plan pacing so holds still meet the reading floor. | `plan` |

```bash
node <skill-root>/scripts/state.mjs invalidate <output-dir> compose --reason "reroll scene 3: user wants the swipe, not the stat card"
node <skill-root>/scripts/cuts.mjs plan --scenes <output-dir>/scenes.json --seconds 18
```

Then continue the normal workflow from the invalidated step, and update `scenes.json` if timings moved. After the new render:

```bash
node <skill-root>/scripts/versions.mjs save <output-dir> --label "reroll scene 3"
node <skill-root>/scripts/versions.mjs compare <output-dir> 1 2
```

Look at `versions/compare-v1-v2.jpg` (previous version left, new version right, one row per scene) before telling the user what changed. `meta.json` warns when `scenes.json` no longer matches the render's length.

## Brag Studio

Offer the review page after delivery:

```bash
node <skill-root>/scripts/studio.mjs serve <output-dir>
```

It serves `http://127.0.0.1:4318/` (local only): every render side by side, the storyboard synced to playback (click a scene to seek), share copy, saved versions, and a notes box per scene that saves to `feedback.json`. Give the user the URL and stop the server when review ends. `studio.mjs build <output-dir>` writes a static `studio.html` instead; notes then download as `feedback.json` for the user to drop into the output folder.
