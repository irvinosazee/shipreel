# /shipreel roadmap

Working backlog. Items are implemented one at a time, each with tests, and ticked off when merged to `main`.

## Now — core backlog

- [x] **1. Skill-root resolution + preflight doctor.** Resolve assets relative to the installed skill (plugin cache, `npx skills`, manual copy, repo) instead of a hardcoded `~/.claude/skills` path. `scripts/doctor.mjs` reports Node, FFmpeg/ffprobe, Hyperframes version, `uv`, and bundled assets, and tells the run what it can and cannot do (music, SFX, beat sync source, voice).
- [x] **2. Project-type detection.** `scripts/detect_project.mjs` classifies the project (landing page, web app, CLI, library, API, mobile, game, data/ML) and step 1 picks a matching inspection and storytelling strategy.
- [x] **3. Render verification + self-critique pass.** `scripts/verify_render.mjs` probes the final MP4 (duration, audio stream, resolution, fps, size, black poster) against the plan. Step 4 snapshots settled frames and scores them against the creative laws before the final render.
- [x] **4. Platform presets + multi-format export + captions.** `--for tiktok|reels|shorts|x|linkedin|youtube|producthunt|readme|discord` sets aspect, safe zones, duration and size budgets. One plan reflows to several formats. Captions ship as `.srt` and optional burned-in word-by-word style.
- [x] **5. CI + test harness over examples.** GitHub Actions for unit tests, docs checks, manifest/symlink validation, and a static eval over `examples/`.

- [x] **Fix the gallery assets.** Posters baked into frame 0 (Fish Flight School, Horse Tinder, Taxi for Taxis, Psychologists for Chatbots, and the hero), loudness mastered to about -14 LUFS at 48 kHz for all examples and the hero. `tests/eval-baseline.json` is now empty.
- [x] **Re-render the hero for vertical platforms.** The install terminal card extends into the right rail that TikTok, Reels, and Shorts cover. Remade with `/shipreel --for vertical`: the terminal card and recording frame now sit inside the TikTok/Reels/Shorts safe rectangle, terminal type is 42px, and the install command matches the current repo.

## Next — batches

Worked in order, one batch per iteration, each with tests and a green CI run.

### Already delivered by the core backlog
- [x] **4:5 feed format** — `--format feed`, LinkedIn preset.
- [x] **Size-budget encoding** — `platforms.mjs export` two-pass re-encodes over-budget renders.
- [x] **Loudness mastering** — step 4 masters to -14 LUFS (true peak -1.5 dB) at 48 kHz; `verify_render.mjs` checks it.
- [x] **Platform safe zones overlay** — `platforms.mjs zones` shades unsafe margins on review frames.

### Batches
- [x] **B1 · Delivery finishing.** Seamless loop check (last frame vs first frame, with a fix recipe); README `shipreel-loop.webp` alongside the GIF; platform cover frames (YouTube 1280x720, OG 1200x630, Reels grid 1080x1350 crop check); upload checklist page `exports/index.html`.
- [x] **B2 · Cutdowns, stories, carousels.** `--cutdown 6|15` from scene timings keeping hook and payoff; stories splitter into ≤15s segments that end on settled frames; carousel export (Instagram 1080x1350 stills and a LinkedIn document PDF).
- [x] **B3 · One composition, every format.** Hyperframes format variables / resolution-aware layout so one composition restacks for 16:9, 9:16, 1:1, 4:5 instead of copied `composition-<format>/` directories (vertical-first reflow, never crop).
- [x] **B4 · Readability gates.** Reading-time check from scene/text timings (0.3s per word); phone-legible type check (minimum rendered text size per format); sound-off criterion in the review pass.
- [x] **B5 · Caption styles.** Named burned-caption styles (word-pop, karaoke highlight, lower-third) as composition snippets themed from the project palette, lint-checked.
- [x] **B6 · Review and iteration.** Resumable runs (`.shipreel-state.json`); versioned renders with a comparison contact sheet; scene re-roll / retone / shorter; Shipreel Studio review page with formats side by side, synced storyboard, share copy, and per-scene notes saved to `feedback.json`.
- [x] **B7 · Brand and polish.** Brand kit (`.shipreel/config.json`) validated and merged into plans; end card with QR code, handle, and avatar; optional "made with /shipreel" watermark; reduced-motion and audio-description variants.
- [x] **B8 · Truth and proof.** Truth mode claims ledger (every on-screen claim cites a source file and quote, verified); live proof metrics (GitHub stars, npm downloads) as sourced numbers; git-powered stories (`--since`, `--week`, build-story stats).
- [x] **B9 · Scene kits.** Type-native building blocks (terminal, HTTP request/response card, code editor, phone frame with swipe, browser/laptop device frames, cursor choreography, game HUD); hook tournament; monorepo story mode; explainer mode (45–60s with chapters).
- [x] **B10 · Real footage.** `--footage` scene detection and best-moment selection from a screen recording; `--capture` real UI by booting the dev server and capturing it.
- [x] **B11 · Localization.** `--lang` string extraction and per-language composition variants, share copy, and Kokoro voice mapping.
- [x] **B12 · Quality gates.** Golden-frame regression for examples; rendered eval in CI (nightly render of a committed fixture composition, then `verify_render.mjs`).
- [x] **B13 · Distribution.** Launch kit bundle (`launch_kit.mjs`); embed-into-your-site patch (`embed.mjs`); GitHub Action for release videos and PR preview videos (`action.yml` plus workflow templates, `release_video.mjs`, `pr_preview.mjs`); standalone CLI (`cli.mjs`, published as `shipreel`), all on a shared card template (`template_video.mjs`) and scripted delivery (`deliver.mjs`). Built and tested locally, never published. The action renders a template video rather than running an agent headless, so it needs no API key. **Still for the owner:** set `SHIPREEL_PRODUCTION_URL` in each repository that uses the PR preview workflow. (The npm publish and public-repo steps were dropped when shipreel became a paid, private tool — see the P batches.)

## Rename and launch — batches

Worked in order, one batch per iteration, each with tests and a green CI run.

- [x] **R1 · Rename to shipreel + credit the original.** `/brag` → `/shipreel` across the command, skill directory and symlinks, plugin and marketplace manifests, npm package, output directory and artifact names, script filenames, composition markers, docs and tests. Prominent credit to [/brag](https://github.com/latent-spaces/brag) by Shunit Haviv Hakimi in the README (with a what-changed table), SKILL.md, and the site colophon; her copyright stays in the LICENSE.
- [x] **R2 · Wider platform coverage.** Beyond the current nine: Instagram feed and Stories, Facebook feed and Reels, Threads, Bluesky, Mastodon, Reddit, Snapchat Spotlight, Pinterest, WhatsApp status, Telegram, Slack, Vimeo, dev.to, App Store and Google Play previews. New `pin` format (2:3), seven groups, a `source` link per preset, duration windows (`durationFit` warns when a render is over Stories' 15s or under the App Store's 15s), and exact-frame exports (`exportCrop` centre-crops the vertical render to Apple's 886x1920). 26 presets.
- [x] **R3 · New hero video.** Hero re-rendered at 1080x1920 (22.6s, -14.9 LUFS, poster baked): "let's show it off", the shipreel install commands, "now go ship", "made with /shipreel". The install line wraps onto a fourth card line rather than shrinking type below the 40px phone floor. Site headline resized and its highlight plate tightened so the descenders in "shipped" clear it; hero.png re-captured at 2x (capturePages gained a `--scale` option).
- [x] **R4 · PUBLISHING.md.** Superseded by the P batches below: the guide now covers selling a private tool, not publishing a public one.
- [x] **R5 · Portfolio entry.** Drafted on irvinosazee.me through its MCP endpoint: slug `shipreel`, three uploaded images (site capture, frame strip, poster), awaiting the owner's review at `/admin/collections/projects/24`. Draft-only by design — no tool on that endpoint can publish.
- [x] **R6 · Example gallery re-renders — not needed.** Checked the gallery videos frame by frame: they are entirely about their own fake products (Horse Tinder, Fish Flight School, Taxi for Taxis) and never name the tool, so the rename does not touch them. Re-rendering would change nothing.

## Paid product — batches

shipreel is sold, not published: one price, a private repository, and a signed licence that proves
ownership without enforcing it. Worked in order, one batch per iteration, each with tests and a
green CI run.

- [x] **P1 · One licence, one price.** Dropped the solo/team split — nothing could verify company size — for a single perpetual $49 licence covering the buyer and the people they work with. "No DRM" stated plainly in the licence, the README and the sales page, with the FAQ answer the pricing invites ("what stops me copying it to a friend?" — nothing does, and here is why that is deliberate). `LICENSE` scoped to the upstream MIT portions rather than reading as a blanket grant over the commercial additions. `tests/docs_truth` now checks the README's own numbers against the filesystem, after all three rows of the comparison table turned out to be wrong.
- [x] **P2 · Signed licence.** `licence.mjs`: `SR1.<payload>.<signature>`, Ed25519 over the `SR1.<payload>` string so a later format cannot be replayed as this one. Read from `SHIPREEL_LICENCE`, then `~/.shipreel/licence` at mode 600. A lapsed update window stays valid and merely says so — asserted in a test named for it, so nobody can quietly turn it into a kill switch. The issuer key is generated outside the repo; `.gitignore` blocks key material and a test runs `git grep` for it. `pack-cli` now ships both licences in the tarball.
- [x] **P3 · Gate and doctor.** An unlicensed copy is asked for a licence and exits 1; `doctor` and `licence` are never gated, because you cannot install a licence with a command that demands one and a diagnostic that refuses to run is not a diagnostic. A source checkout is not gated. `doctor` reports the licence as a line in its report, a blocker when missing and a warning when updates have lapsed.
- [x] **P4 · Issuing.** `scripts/issue-licence.mjs`: number the sale, sign the token, append to the gitignored ledger, print a receipt that can be pasted to the buyer unedited. The token carries the buyer's name but not their email. `keygen` refuses to overwrite an existing key, which would strand every licence already sold.
- [x] **P5 · `shipreel skill install`.** Replaces the rsync line in the README, for Claude Code, Codex and opencode, globally or per project. Several agents in one project share one copy with relative symlinks — three copies of the bundled audio came to 51 MB, one copy and two links to 17 MB — falling back to real copies where symlinks are unavailable.
- [x] **P6 · Docs.** PUBLISHING.md rewritten for selling a private tool: back up the signing key first, take payment, build the tarball, issue a licence, launch post, portfolio. PRODUCT.md updated for an audience that buys rather than trials. Tests guard the guide against the advice that was decided against.

**Superseded by the open-source batches below.** The licence gate, signing key and commercial licence were removed; the batches stay as a record.

## Open source — batches

shipreel is free and MIT: the audience it builds is the point. Worked in order, one batch per iteration, each with tests green and a commit.

- [x] **O1 · History audit.** All 62 commits, every blob and patch: no private keys, API tokens, licence tokens, customer names or emails, or local machine paths. The only author emails besides the owner's noreply address are upstream /brag contributors', already public. No history rewrite needed.
- [x] **O2 · MIT everywhere.** Removed `licence.mjs`, `scripts/issue-licence.mjs`, `LICENSE-COMMERCIAL.md`, the CLI gate and the doctor's licence line, and their three test files. `LICENSE` is plain MIT with both copyrights, plus a note that the bundled music stays CC BY 4.0. The private-key `git grep` guard survives, in `tests/docs_truth`.
- [ ] **O3 · One-line install.** npm package and Claude plugin marketplace manifest; README and PUBLISHING rewritten for open source, with a stars/email call to action.
- [ ] **O4 · Landing page.** `shipreel-site` from sales page to landing page: install, email signup.
- [ ] **O5 · User manual** in `docs/`.
- [ ] **O6 · Portfolio and launch.** Portfolio entry fix (cover, counts, copy) and launch post draft.

## Idea notes

### Formats and platforms
- **Hyperframes format variables.** One composition that reads the frame size and restacks itself, instead of a copied `composition-<format>/` per format, so layout fixes land everywhere at once.
- **Vertical-first reflow, never center-crop.** Each scene declares a layout for 16:9, 9:16, 1:1 and 4:5; text and UI restack instead of being cropped.
- **4:5 feed format** for Instagram and LinkedIn feeds (1080x1350), which take up more of the screen than 1:1.
- **Platform safe zones** drawn as a debug overlay in preview (TikTok right rail and caption area, Reels bottom sheet, Shorts subscribe bar).
- **Size-budget encoding.** Two-pass encode to hit hard limits (Discord 10 MB, X 512 MB, Slack inline preview).
- **Seamless loop ending.** The last frame matches the first, so autoplaying feeds loop without a visible jump.
- **README-ready loop.** `shipreel.gif` / `shipreel-loop.webp` sized for GitHub READMEs, where MP4s do not autoplay.
- **Cutdowns.** `--cutdown 6` produces a 6-second bumper and a 15-second TikTok cut from the same plan, keeping the hook and payoff.
- **Stories splitter.** Split into 15-second Instagram/WhatsApp story segments, each ending on a readable frame.
- **Carousel export.** Storyboard frames as a LinkedIn document carousel (PDF) and an Instagram carousel (1080x1350 stills).
- **Caption styles.** Named burned-caption styles (word-pop, karaoke highlight, lower-third) themed from the project's fonts and colors.
- **Upload checklist page.** `exports/index.html` with each platform's file, cover image, caption text, and notes in one place, ready to post in order.
- **Sound-off check.** Every beat must read with audio muted, since most feeds autoplay silently; the review pass fails scenes that rely on narration alone.
- **Phone-legible type.** Minimum on-screen text size per format (9:16 is watched at arm's length on a small screen), enforced at check time.
- **Platform cover frames.** Per-platform thumbnail and cover pick (TikTok cover, YouTube 1280x720 thumbnail, OG 1200x630 image).

### Story and content
- **Real UI capture (`--capture`).** Boot the dev server, record real screens and cursor flows with Playwright or `hyperframes capture`, and use them as layers.
- **Bring your own footage (`--footage demo.mov`).** Scene-detect a screen recording, cut the best 3 moments, and weave them into the edit.
- **Git-powered stories.** `--since v1.2` release videos, `--week` build-in-public recaps, "3 days · 142 commits" build-story cards.
- **Live proof metrics.** Pull GitHub stars, npm downloads, or a Lighthouse score as real, sourced numbers — never invented ones for real products.
- **Truth mode.** For non-parody projects, every claim on screen must quote the source; the plan lists the citation for each line.
- **Hook tournament.** Three hook variants rendered as stills; pick one (or let the agent judge) before building the whole video.
- **Device frames and cursor choreography.** iPhone, browser chrome and laptop frames; eased cursor paths with click ripples and typing.
- **Type-native scene kits.** Ready-made, brand-themed building blocks per project type: terminal window with real typing, HTTP request/response card, code editor with live output, phone frame with swipe physics, game HUD.
- **Monorepo story mode.** When a repo has an app and an API, cut between the screen and the real request powering it ("this tap → this call → this result").
- **Explainer mode.** `--duration 45-60` with chapters for demos that need more than 25 seconds.
- **Localization.** `--lang es,ja,pt` translates on-screen copy and share copy, with matching Kokoro voices when `--voice` is on.

### Review and iteration
- **Automatic readability metrics.** Measure text height and contrast in each settled review frame (OCR bounding boxes plus local contrast) so "readable at phone size" becomes a number, not a judgment.
- **Reading-time check from the composition.** Compare each text element's visible duration against 0.3s per word before rendering, straight from the Hyperframes timeline.
- **Shipreel Studio review page.** `shipreel-output/index.html` shows every format side by side, the storyboard synced to playback, share copy with copy buttons, and per-scene "re-roll" notes saved to `feedback.json` for the next run.
- **Scene re-roll.** `--reroll 3`, `--retone deadpan`, `--shorter`, reusing the existing plan and composition.
- **Resumable runs.** `.shipreel-state.json` records completed steps and inputs so an interrupted run continues.
- **Versioned renders** with a contact-sheet comparison between `v1`, `v2`, ...

### Brand and polish
- **Brand kit (`.shipreel/config.json`).** Tone, palette, fonts, logo, handle, CTA URL, banned words, and intro/outro cards reused across runs.
- **End card with QR code** to the product URL, plus handle and GitHub avatar.
- **Loudness mastering** to -14 LUFS with a limiter and a clean tail.
- **Optional "made with /shipreel" watermark** (off by default) as a growth loop.
- **Reduced-motion and audio-description variants** for accessibility.

### Quality gates
- **Rendered eval in CI.** A nightly job that runs a real `/shipreel` over one example headless and checks the output with `verify_render.mjs`, so Hyperframes upgrades that break the pipeline are caught within a day.
- **Golden-frame regression.** Store review contact sheets for each example and compare new renders with SSIM to flag unintended visual changes.

### Distribution
- **Launch kit bundle.** Video in all formats, OG image, X thread, LinkedIn post, Product Hunt gallery images, README embed snippet, and `credits.txt` in one folder.
- **Embed into the user's site.** Offer a patch that adds the launch video (with poster) to the project's own landing page.
- **GitHub Action.** On release, run `/shipreel` headless against the diff and attach `shipreel.mp4` and share copy to the release.
- **PR preview videos.** A 10-second clip of UI changes posted on the pull request from the preview deploy.
- **Standalone `npx shipreel` CLI** for people who do not use a coding agent.
