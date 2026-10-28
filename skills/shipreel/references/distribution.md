# Distribution (`--kit`, `--embed`, release videos, PR previews, the CLI)

Getting a finished reel in front of people. Nothing here posts anything: every tool writes files for the user to upload, a patch for them to apply, or a workflow for them to commit.

## Launch kit (`--kit`)

After Step 4 (and `--for` exports, when used):

```bash
node <skill-root>/scripts/launch_kit.mjs <output-dir> [--url https://…] [--title "name"] [--highlights "a|b|c"]
```

Writes `<output-dir>/launch-kit/` and `launch-kit.zip`:

- `videos/`: `shipreel.mp4`, every `shipreel-<format>.mp4`, every per-platform export with its GIF/WebP.
- `images/`: poster, `og.jpg` (1200x630), `youtube.jpg`, `reels-grid.jpg`, and `producthunt-N.jpg` (1270x760, one per scene still from `scenes.json`, from a landscape render when there is one).
- `copy/`: `share-copy.txt`, `x-thread.txt` (numbered posts, each ≤280 characters), `linkedin.txt`, `producthunt.txt` (name, ≤60-character tagline, ≤260-character description). A `## X`, `## LinkedIn`, or `## Product Hunt` section in `share-copy-variants.md` replaces the caption for that platform.
- `embed/`: a README image-link snippet and an autoplaying, muted `<video>` tag.
- `credits.txt`: the bundled music track and Kenney SFX the composition actually uses, plus tools.

Pass `--highlights` with two to four of the video's own proof points (the same claims as in `claims.json`, in plain words) so the thread and LinkedIn post list them. Pass `--url` unless `.shipreel/config.json` has one. Tell the user the kit's path and that nothing was posted.

## Embed in the project's site (`--embed`)

```bash
node <skill-root>/scripts/embed.mjs <project-dir> --video <output-dir>/shipreel.mp4 --poster <output-dir>/shipreel.jpg \
  --patch <output-dir>/embed.patch --title "<name> launch video"
```

It finds the landing page (Next.js `app/` or `pages/`, Astro, SvelteKit, a Vite or CRA `App`, Vue, a plain `index.html`, then `README.md`), follows local imports up to two levels to the component that renders the first `<h1>`, and puts an autoplaying, muted, looping `<video>` with the poster right after it, or at the start of `<main>`. JSX gets JSX attributes (`autoPlay`, `playsInline`, `style={{…}}`). Media goes to `public/` (`static/` for SvelteKit), beside a plain HTML page (in `assets/` when that exists), or beside the README, which gets a poster image link because GitHub does not autoplay video.

Without `--apply` the project is untouched: show the user the patch and the two media copies. Apply only when they ask (`--apply`, or `git apply` plus the copies). It refuses a file that already embeds `shipreel.mp4`, and it refuses to read iCloud placeholder files instead of hanging on them.

## Release videos (no agent)

```bash
node <skill-root>/scripts/release_video.mjs <project-dir> --tag v1.2.0 --out <dir> [--since v1.1.0] [--notes notes.md] [--format vertical]
```

The range is the previous tag to `--tag` (or `--since`). Highlights come from the release notes when given (GitHub's generated `* feat: x by @y in url` bullets work), otherwise from commit subjects: features, then fixes and performance, with chores, docs, CI, and version bumps only as a fallback. Trailing references like `(#42)` or `(B10)` are dropped. Stats are commits, contributors (when more than one), and files changed. The outro is the install command for that version (`npm i name@1.2.0`, `pip install name==1.2.0`), or the homepage or repository.

This is the template path. When the user asks the agent for a release video (`--since`), build a bespoke composition as usual and use `git_story.mjs` for the material (see `truth-and-proof.md`); reach for `release_video.mjs` when they want it automated or in CI.

## Card template and scripted delivery

Release videos, PR previews, and `shipreel make` share two scripts:

- `template_video.mjs <content.json> --out <dir> [--format]` builds a card composition: hook, stats, up to two screenshots (full-page captures pan; viewport captures are fitted whole), highlights, and outro. Every line holds for its reading time, the total stays within 25s (it drops extra screenshots, then highlight items, then stats, and reports what it dropped), vertical content stays inside the TikTok/Reels/Shorts safe rectangle, and colors are hex so `hyperframes check` audits contrast.
- `deliver.mjs render <composition> --out <video>` runs `hyperframes render`. `deliver.mjs finish <video> --poster-at <s> [--format] [--min --max]` masters to -14 LUFS at 48 kHz, pulls the poster, bakes it into frame 0, and runs `verify_render`. That is Step 4's mastering, poster, and verify sequence as one command, and the agent path may use it too.

## PR preview videos

```bash
node <skill-root>/scripts/pr_preview.mjs --base https://myapp.com --head https://pr-7.preview.app \
  --changed-files changed.txt --out <dir>
# or two local checkouts: --base-dir ../main --head-dir .
```

Changed files map to routes: `app/**/page.tsx`, `pages/**`, `src/pages/*.astro`, `src/routes/**/+page.svelte`, and HTML files map to their URLs. Route groups are ignored, dynamic segments fall back to `/`, other UI files map to `/`, and docs, config, tests, and API routes map to nothing, which skips the preview. There are at most three routes. Each is captured on both sides, and SSIM below 0.995 marks a visible change. Changed routes become labeled before and after cards (3s each), written as `preview.mp4`, `preview.gif`, `routes.json`, and `comment.md`. The comment carries the `<!-- shipreel:pr-preview -->` marker so a workflow updates it in place.

## GitHub Action and workflows

`action.yml` at the repository root is a composite action (`uses: irvinosazee/shipreel@main`) with `mode: release` or `mode: pr-preview`. It sets up Node 24 and FFmpeg, runs the scripts above, attaches `release.mp4` and `release.jpg` to the release, or uploads the preview artifact and creates or updates the pull request comment. It uses only the workflow token.

Install a ready workflow into a project:

```bash
node <skill-root>/scripts/cli.mjs github install release      # .github/workflows/shipreel-release-video.yml
node <skill-root>/scripts/cli.mjs github install pr-preview   # .github/workflows/shipreel-pr-preview.yml
```

The PR preview workflow needs the repository variable `SHIPREEL_PRODUCTION_URL`, and a preview deployment that loads without a login. Tell the user both. Committing and pushing the workflow is the user's call.

## Standalone CLI (`shipreel`)

`scripts/cli.mjs` is the `shipreel` command for people without a coding agent:

- `make [dir] [--format] [--screenshot file | --no-capture]` reads package metadata, the README's first paragraph and Features list, and git history. It captures the running site for web apps and landing pages, fills the card template, renders, finishes, and writes covers, `scenes.json`, and `share-copy.txt`, so `kit` and `cuts` work on the result.
- `release`, `preview`, `kit`, `embed`, and `github install` wrap the tools above. Every other skill script is available by name (`doctor`, `verify`, `platforms`, `captions`, `cuts`, …).

The CLI never calls a model. When the user has an agent, /shipreel's own workflow is the better video, so do not substitute `make` for Steps 1–4.

`npm run pack-cli` stages `dist/shipreel/` (the `@irvinosazee/shipreel` npm package, mirroring this layout) and packs a tarball. Publishing is the user's step: `npm publish ./dist/shipreel --access public`. Point users at the scoped name: the unscoped `shipreel` on npm is a different package.
