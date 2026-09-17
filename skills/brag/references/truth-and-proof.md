# Truth and proof

A brag is only as good as its claims. Parody projects can say anything their own site says; real products must not say anything their project cannot back up.

## Claims ledger (every run)

While planning (Step 2), write `<output-dir>/claims.json`: one entry for every claim the video makes on screen or in narration — numbers, capabilities, comparisons, testimonials.

```json
[
  { "text": "Available in 12 metros", "source": "index.html", "quote": "Available in 12 metros" },
  { "text": "8,400 cabs a day", "source": "README.md", "quote": "moves 8,400 cabs a day" }
]
```

- `source` is a path relative to the project root; `quote` is the exact wording in that file (for HTML, the visible text — matching ignores case, whitespace, and entities).
- Paraphrase on screen if you like, but the quote must exist verbatim in the source.

Before the final render (Step 4):

```bash
node <skill-root>/scripts/claims.mjs verify <output-dir> --project <project-dir> [--strict]
```

Fix every problem by correcting the quote, citing the right file, or cutting the claim.

## Truth mode (`--truth`, and every non-parody project)

Use `--strict`. It also scans the composition's visible text for numbers with a noun ("3 taps", "10x faster") and superlatives ("the fastest", "#1") that no claim covers. Clock times, aspect ratios, resolutions, versions, and years are ignored. Every flagged phrase needs a claim with a source, or it comes out of the video. In Step 1, question 6, decide parody vs real: a real product runs strict; a parody runs the plain check.

## Live proof metrics (`--metrics`)

Real numbers beat adjectives. Fetch them instead of writing them:

```bash
node <skill-root>/scripts/metrics.mjs <project-dir> --out <output-dir>/metrics.json [--github owner/repo] [--npm package]
```

It reads the GitHub repo from the `origin` remote and the npm package from `package.json`, and returns metrics with their source URL and fetch time, plus ready `claims` ("4.2k GitHub stars", "211k npm downloads last week") to append to `claims.json`. Zero values stay out of the claims. Private repos need `GITHUB_TOKEN`; if a fetch fails, say so and leave the number out — never estimate one.

## Git-powered stories

```bash
node <skill-root>/scripts/git_story.mjs <project-dir>               # build story: "3 days · 142 commits · 1 contributor"
node <skill-root>/scripts/git_story.mjs <project-dir> --since v1.2  # release video
node <skill-root>/scripts/git_story.mjs <project-dir> --days 7      # weekly recap
```

- `--since <tag>` / `/brag --since v1.2`: a release video. Use `highlights` (commit subjects without merges) as raw material: group them into 2–3 user-facing changes and show each one working; do not put commit messages on screen verbatim.
- `/brag --week`: a build-in-public recap from `--days 7`.
- The `line` field is a ready build-story card for a hook or outro. Save the output to `<output-dir>/git-story.json`; its numbers come straight from `git log`, so cite them in `claims.json` with the file's path from the project root (for example `"source": "brag-output/git-story.json"`) and the exact line as the quote.
