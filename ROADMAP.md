# /brag roadmap

Working backlog. Items are implemented one at a time, each with tests, and ticked off when merged to `main`.

## Now — core backlog

- [x] **1. Skill-root resolution + preflight doctor.** Resolve assets relative to the installed skill (plugin cache, `npx skills`, manual copy, repo) instead of a hardcoded `~/.claude/skills` path. `scripts/brag_doctor.mjs` reports Node, FFmpeg/ffprobe, Hyperframes version, `uv`, and bundled assets, and tells the run what it can and cannot do (music, SFX, beat sync source, voice).
- [x] **2. Project-type detection.** `scripts/detect_project.mjs` classifies the project (landing page, web app, CLI, library, API, mobile, game, data/ML) and step 1 picks a matching inspection and storytelling strategy.
- [x] **3. Render verification + self-critique pass.** `scripts/verify_render.mjs` probes the final MP4 (duration, audio stream, resolution, fps, size, black poster) against the plan. Step 4 snapshots settled frames and scores them against the creative laws before the final render.
- [x] **4. Platform presets + multi-format export + captions.** `--for tiktok|reels|shorts|x|linkedin|youtube|producthunt|readme|discord` sets aspect, safe zones, duration and size budgets. One plan reflows to several formats. Captions ship as `.srt` and optional burned-in word-by-word style.
- [x] **5. CI + test harness over examples.** GitHub Actions for unit tests, docs checks, manifest/symlink validation, and a static eval over `examples/`.

- [x] **Fix the gallery assets.** Posters baked into frame 0 (Fish Flight School, Horse Tinder, Taxi for Taxis, Psychologists for Chatbots, and the hero), loudness mastered to about -14 LUFS at 48 kHz for all examples and the hero. `tests/eval-baseline.json` is now empty.
- [x] **Re-render the hero for vertical platforms.** The install terminal card extends into the right rail that TikTok, Reels, and Shorts cover. Remade with `/brag --for vertical`: the terminal card and recording frame now sit inside the TikTok/Reels/Shorts safe rectangle, terminal type is 42px, and the install command matches the current repo.

## Next — batches

Worked in order, one batch per iteration, each with tests and a green CI run.

### Already delivered by the core backlog
- [x] **4:5 feed format** — `--format feed`, LinkedIn preset.
- [x] **Size-budget encoding** — `platforms.mjs export` two-pass re-encodes over-budget renders.
- [x] **Loudness mastering** — step 4 masters to -14 LUFS (true peak -1.5 dB) at 48 kHz; `verify_render.mjs` checks it.
- [x] **Platform safe zones overlay** — `platforms.mjs zones` shades unsafe margins on review frames.

### Batches
- [x] **B1 · Delivery finishing.** Seamless loop check (last frame vs first frame, with a fix recipe); README `brag-loop.webp` alongside the GIF; platform cover frames (YouTube 1280x720, OG 1200x630, Reels grid 1080x1350 crop check); upload checklist page `exports/index.html`.
- [x] **B2 · Cutdowns, stories, carousels.** `--cutdown 6|15` from scene timings keeping hook and payoff; stories splitter into ≤15s segments that end on settled frames; carousel export (Instagram 1080x1350 stills and a LinkedIn document PDF).
- [x] **B3 · One composition, every format.** Hyperframes format variables / resolution-aware layout so one composition restacks for 16:9, 9:16, 1:1, 4:5 instead of copied `composition-<format>/` directories (vertical-first reflow, never crop).
- [x] **B4 · Readability gates.** Reading-time check from scene/text timings (0.3s per word); phone-legible type check (minimum rendered text size per format); sound-off criterion in the review pass.
- [x] **B5 · Caption styles.** Named burned-caption styles (word-pop, karaoke highlight, lower-third) as composition snippets themed from the project palette, lint-checked.
- [x] **B6 · Review and iteration.** Resumable runs (`.brag-state.json`); versioned renders with a comparison contact sheet; scene re-roll / retone / shorter; Brag Studio review page with formats side by side, synced storyboard, share copy, and per-scene notes saved to `feedback.json`.
- [x] **B7 · Brand and polish.** Brand kit (`.brag/config.json`) validated and merged into plans; end card with QR code, handle, and avatar; optional "made with /brag" watermark; reduced-motion and audio-description variants.
- [ ] **B8 · Truth and proof.** Truth mode claims ledger (every on-screen claim cites a source file and quote, verified); live proof metrics (GitHub stars, npm downloads) as sourced numbers; git-powered stories (`--since`, `--week`, build-story stats).
- [ ] **B9 · Scene kits.** Type-native building blocks (terminal, HTTP request/response card, code editor, phone frame with swipe, browser/laptop device frames, cursor choreography, game HUD); hook tournament; monorepo story mode; explainer mode (45–60s with chapters).
- [ ] **B10 · Real footage.** `--footage` scene detection and best-moment selection from a screen recording; `--capture` real UI by booting the dev server and capturing it.
- [ ] **B11 · Localization.** `--lang` string extraction and per-language composition variants, share copy, and Kokoro voice mapping.
- [ ] **B12 · Quality gates.** Golden-frame regression for examples; rendered eval in CI (nightly render of a committed fixture composition, then `verify_render.mjs`).
- [ ] **B13 · Distribution.** Launch kit bundle; embed-into-your-site patch; GitHub Action for release videos; PR preview video workflow; standalone `npx brag` CLI. Built and tested locally, never published.

## Idea notes

### Formats and platforms
- **Hyperframes format variables.** One composition that reads the frame size and restacks itself, instead of a copied `composition-<format>/` per format, so layout fixes land everywhere at once.
- **Vertical-first reflow, never center-crop.** Each scene declares a layout for 16:9, 9:16, 1:1 and 4:5; text and UI restack instead of being cropped.
- **4:5 feed format** for Instagram and LinkedIn feeds (1080x1350), which take up more of the screen than 1:1.
- **Platform safe zones** drawn as a debug overlay in preview (TikTok right rail and caption area, Reels bottom sheet, Shorts subscribe bar).
- **Size-budget encoding.** Two-pass encode to hit hard limits (Discord 10 MB, X 512 MB, Slack inline preview).
- **Seamless loop ending.** The last frame matches the first, so autoplaying feeds loop without a visible jump.
- **README-ready loop.** `brag.gif` / `brag-loop.webp` sized for GitHub READMEs, where MP4s do not autoplay.
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
- **Brag Studio review page.** `brag-output/index.html` shows every format side by side, the storyboard synced to playback, share copy with copy buttons, and per-scene "re-roll" notes saved to `feedback.json` for the next run.
- **Scene re-roll.** `--reroll 3`, `--retone deadpan`, `--shorter`, reusing the existing plan and composition.
- **Resumable runs.** `.brag-state.json` records completed steps and inputs so an interrupted run continues.
- **Versioned renders** with a contact-sheet comparison between `v1`, `v2`, ...

### Brand and polish
- **Brand kit (`.brag/config.json`).** Tone, palette, fonts, logo, handle, CTA URL, banned words, and intro/outro cards reused across runs.
- **End card with QR code** to the product URL, plus handle and GitHub avatar.
- **Loudness mastering** to -14 LUFS with a limiter and a clean tail.
- **Optional "made with /brag" watermark** (off by default) as a growth loop.
- **Reduced-motion and audio-description variants** for accessibility.

### Quality gates
- **Rendered eval in CI.** A nightly job that runs a real `/brag` over one example headless and checks the output with `verify_render.mjs`, so Hyperframes upgrades that break the pipeline are caught within a day.
- **Golden-frame regression.** Store review contact sheets for each example and compare new renders with SSIM to flag unintended visual changes.

### Distribution
- **Launch kit bundle.** Video in all formats, OG image, X thread, LinkedIn post, Product Hunt gallery images, README embed snippet, and `credits.txt` in one folder.
- **Embed into the user's site.** Offer a patch that adds the brag video (with poster) to the project's own landing page.
- **GitHub Action.** On release, run `/brag` headless against the diff and attach `brag.mp4` and share copy to the release.
- **PR preview videos.** A 10-second clip of UI changes posted on the pull request from the preview deploy.
- **Standalone `npx brag` CLI** for people who do not use a coding agent.
