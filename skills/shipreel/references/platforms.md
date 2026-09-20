# Platforms, formats, and captions

`--for` names where the reel will be posted. It decides the frame sizes to render, where text may sit, whether captions are burned in, and the size budget of each export.

```text
/shipreel --for tiktok,reels,shorts        # vertical only
/shipreel --for social                     # tiktok, reels, shorts, x, linkedin
/shipreel --for x,discord,readme
/shipreel --for all
```

Presets live in `<skill-assets>/platforms.json` (groups: `vertical`, `social`, `all`). Without `--for`, `/shipreel` renders one video in `--format` (default `landscape`) exactly as before.

## Plan the renders

```bash
node <skill-root>/scripts/platforms.mjs plan --for tiktok,reels,x,linkedin
```

It returns one render per frame size — never one per platform. TikTok, Reels, and Shorts share a single 1080x1920 render that uses the strictest safe zone of the three. Each render lists:

- `size` and `aspect`
- `platforms` served by it
- `safeZonePx` — pixel insets from each edge and the `safe` rectangle; keep all text, faces, and product UI inside it
- `captions` — `burned` (captions drawn into the video), `sidecar` (`.srt` uploaded next to it), or `none`
- `maxMb` and `maxDurationSec` when a platform imposes them

Copy the plan into `shipreel-plan.md` under `## Delivery`.

| Preset | Render | Why |
|---|---|---|
| `tiktok`, `reels`, `shorts` | vertical 1080x1920 | Full-screen phone; right rail and bottom caption area are covered by app UI. Burned captions (most viewers start muted). |
| `x` | landscape 1920x1080 | Autoplays muted in the timeline; burned captions. |
| `linkedin` | feed 1080x1350 (4:5) | Takes the most feed height on mobile; burned captions. |
| `youtube`, `producthunt` | landscape | `.srt` sidecar; Product Hunt galleries link to the YouTube upload. |
| `readme` | landscape, exported at 1280 wide | 10 MB MP4 plus an autoplaying GIF, because MP4s do not autoplay in READMEs. |
| `discord` | landscape | Re-encoded to fit the 10 MB free upload limit. |
| `stories` | vertical | 15s per card — pair with `--stories`. Profile row on top, reply bar on the bottom. |
| `snapchat` | vertical | Spotlight: 5–60s, sound required, no other app's watermark. |
| `whatsapp` | vertical | 30s and **16 MB** per clip: the tightest budget here, so the export is re-encoded down. |
| `facebook-reels` | vertical | Same furniture as Instagram Reels; 90s is the practical cap. |
| `instagram-feed`, `facebook` | feed 1080x1350 (4:5) | Tallest shape the feed shows uncropped; autoplays muted. |
| `threads` | vertical | Up to 5 minutes, autoplays muted. |
| `bluesky` | landscape | 10 minutes, 300 MB, playback around 720p — keep type large. |
| `mastodon` | landscape | Limits are per instance; 40 MB is the common default. Add a media description. |
| `reddit` | landscape | 1 GB, 15 minutes, 1080p30. |
| `telegram`, `slack` | landscape | Chat clients: Telegram 2 GB, Slack exported at 1280 wide to respect workspace storage. |
| `vimeo` | landscape | `.srt` sidecar; free accounts have a weekly quota, not a per-file cap. |
| `pinterest` | **pin 1000x1500 (2:3)** | The native pin shape; 6–15s performs best. |
| `devto` | landscape, exported at 1000 wide | Markdown posts: embed the GIF or a video link. |
| `appstore` | vertical, **centre-cropped to 886x1920** | Apple's exact iPhone preview frame. 15–30s, and it must show real app footage (`--capture`, `--footage`). |
| `googleplay` | landscape | Play takes a **YouTube URL**, not an upload; only the first 30s autoplays. |

Groups: `vertical`, `meta`, `fediverse`, `social`, `dev`, `stores`, `all`. Every preset carries a `source` link to the platform's own documentation in `assets/platforms.json` — check it before trusting a limit, because platforms move them.

### Durations that do not fit

`planRenders` merges the strictest window of the platforms sharing a frame size, and `platforms.mjs export` warns per platform:

```
22.6s is over Instagram Stories' 15s per card; use --stories to split it.
12.0s is under App Store preview's 15s minimum.
```

A 15–25s shipreel fits everything except Stories (split it) and WhatsApp (30s cap, so only the long end is a problem).

## Storyboard for every format (Step 2)

Plan one story and one timeline; each format gets its own layout.

- **Reflow, never crop or letterbox.** A landscape scene with a headline beside a product card becomes a vertical scene with the headline above the card. Write a one-line layout note per scene for each extra format ("vertical: headline top third, phone mockup fills middle").
- **Vertical needs bigger type.** Phones are watched at arm's length: headlines at least ~90px and body copy at least ~48px on a 1080-wide frame. `text_audit.mjs` enforces the floor (28px any text, 40px body copy per 1080px of short side) on the rendered, transformed size.
- **Hook inside the safe rectangle** and, for Reels, inside the center 1080x1350 the profile grid shows.
- **Captions are part of the design** when they are burned in: reserve a caption band inside the safe rectangle (lower third, above the bottom inset) in every scene, and keep other text out of it.
- **Sound-off check:** every scene must make sense muted. If a beat depends on narration, put its words on screen.

## Compose (Step 3)

Put the render plan in `composition-brief.md`: sizes, `safeZonePx` for each, caption mode, and the per-scene layout notes.

- Build **one** source composition in `<output-dir>/composition/` at the primary format's size. Write every other format's layout into the same file as `[data-format="<format>"]` rules (`landscape`, `vertical`, `square`, `feed`): container boxes sized to that format's safe rectangle, type sizes, and anything that restacks. Size content from containers, not from hardcoded page dimensions. Scripts that must differ by format read `document.querySelector("[data-composition-id]").dataset.format`.
- Generate the other formats — never copy or hand-edit them:

  ```bash
  node <skill-root>/scripts/formats.mjs stamp <output-dir>/composition --formats vertical,landscape,feed
  ```

  It stamps the source with its own `data-format` and writes `composition-<format>/` beside it with the root size, viewport, `data-resolution`, and `data-format` set and the assets copied. The timeline is shared, so scene timing and beat locks are identical. After any edit to the source, re-stamp.
- Anything that names the frame (a "9:16" label, an aspect callout) must switch per format too.
- When captions are `burned`, inject a caption style into the source composition (before stamping other formats):

  ```bash
  node <skill-root>/scripts/captions.mjs inject <output-dir>/composition \
    --cues captions.json --style karaoke --theme caption-theme.json
  ```

  | Style | Looks like | Use for |
  |---|---|---|
  | `lower-third` | The whole line on a solid bar | Calm tones: `polished`, `deadpan`, `app-store` |
  | `word-pop` | Words appear one at a time, big and bold | `chaotic`, `default` on TikTok/Reels |
  | `karaoke` | The whole line, each word lighting up in the accent as it is said | Voiceover videos (`--voice`) |

  `caption-theme.json` is `{ "font", "fg", "bg", "accent", "band": { "x", "y", "width", "height" } }` in the project's own font and palette, with `band` inside the reserved caption band of the safe rectangle. Every style sits on a solid `bg` plate so it reads over any scene; `fg` (and `accent` for karaoke) must reach 3:1 contrast with `bg` or the script refuses. Captions are plain timed markup — Hyperframes owns their visibility, `check` catches collisions with scene content, and `text_audit.mjs` checks their size (per-word states are exempt from reading time; `captions.mjs` lints each cue as a line). Re-running `inject` replaces the previous block. Without word timings (no voiceover), words are spread evenly across each cue.
- Run `npx hyperframes check` in every composition directory, and `npx hyperframes snapshot --at <settled times>` in each generated one to eyeball the restacked layouts before rendering.

## Captions files (Step 4)

Write the caption cues to `<output-dir>/captions.json` — the on-screen lines (or narration lines) with their settled start and end times:

```json
[
  { "start": 0.4, "end": 2.2, "text": "Dating apps were built for humans." },
  { "start": 2.4, "end": 3.6, "text": "Obvious mistake." }
]
```

```bash
node <skill-root>/scripts/captions.mjs captions.json --srt shipreel.srt --vtt shipreel.vtt
```

With `--voice`, convert the transcript's word timings to `[{ "text", "start", "end" }]` and pass `--words` to group them into short phone-readable lines (`--max-chars 24` for vertical). The script reports cues that overlap or are too short to read; fix them in the composition and regenerate.

## Review with safe zones

During the self-review pass, shade the unsafe margins on each vertical review frame:

```bash
node <skill-root>/scripts/platforms.mjs zones review/frame-03.jpg --for vertical --out review/frame-03-zones.jpg
```

Anything important under the shading will be covered by app buttons or captions. Score it under Readability.

## Verify and export

Verify each render with its own format and budget, then export per platform:

```bash
node <skill-root>/scripts/verify_render.mjs shipreel-vertical.mp4 --format vertical --poster shipreel-vertical.jpg
node <skill-root>/scripts/platforms.mjs export --for tiktok,reels,x,discord \
  --render vertical=shipreel-vertical.mp4 --render landscape=shipreel.mp4 --out exports
```

`export` copies a render when it already fits, re-encodes it with a two-pass bitrate when it is over a platform's size budget, scales it for `readme`, and writes the README GIF plus an animated `shipreel-readme.webp` (smaller, full color) when ffmpeg has libwebp. Each render needs its own best-beat poster baked into frame 0 (`shipreel-<format>.jpg`) before export.

## Covers

```bash
node <skill-root>/scripts/covers.mjs shipreel.jpg --out covers
```

Writes `youtube.jpg` (1280x720), `og.jpg` (1200x630 link preview), and `reels-grid.jpg` (the 1080x1350 center Instagram's grid shows). Mismatched shapes are fitted over a blurred fill, never stretched. For a vertical poster it also reports `gridCrop.risky` when there is detail in the rows the grid crops away — move the hook inside the center 1080x1350 if so.

## Seamless loops

TikTok, Reels, Shorts, and X loop videos in the feed. When the plan wants a seamless loop, end on the opening scene's background and layout, and check the seam:

```bash
node <skill-root>/scripts/verify_render.mjs shipreel-vertical.mp4 --format vertical --loop
```

`--loop` warns (`loop-seam`) when the last frame and frame 1 differ by less than 25 dB PSNR (frame 0 is the baked poster, so it is skipped).

## Upload checklist

```bash
node <skill-root>/scripts/upload_page.mjs <output-dir>
```

Writes `exports/index.html`: one card per platform with the file, the caption from `share-copy-variants.md` (falling back to `share-copy.txt`) with a copy button, the cover to use, and the platform's notes, plus the generated covers. Keep `Cover:` lines in `share-copy-variants.md` on their own line — they are shown as the cover note and never copied into the caption.

## Output

```text
shipreel-output/
  shipreel.mp4                 — primary render (landscape unless --format says otherwise)
  shipreel-vertical.mp4        — one file per extra format
  shipreel-feed.mp4
  shipreel.jpg, shipreel-vertical.jpg, ...
  shipreel.srt, shipreel.vtt       — captions
  covers/                  — youtube.jpg, og.jpg, reels-grid.jpg
  exports/
    shipreel-tiktok.mp4 ...    — one file per --for platform, ready to upload
    shipreel-readme.gif, shipreel-readme.webp
    index.html             — upload checklist
  share-copy.txt
  share-copy-variants.md   — one caption per platform, plus the cover/thumbnail note from platforms.json
```
