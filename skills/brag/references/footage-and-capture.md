# Real footage and real UI

The product *doing* its thing beats any recreation. When real material exists, use it.

## Bring your own footage (`--footage <recording>`)

The user supplies a screen recording (`.mov`, `.mp4`). Find the moments worth showing:

```bash
node <skill-root>/scripts/footage.mjs analyze demo.mov --count 3 --seconds 3
node <skill-root>/scripts/footage.mjs cut demo.mov --out <output-dir>/composition/assets/footage --count 3 --seconds 3
```

- It splits the recording at hard cuts, slides moment-length windows through each part (never across a cut), and scores each window by the fraction of pixels that change — so a cursor move, typing, or a panel sliding in counts even when most of the screen is still. Idle and blank stretches are skipped, and the chosen moments are returned in order.
- `cut` writes `moment-N.mp4` clips: muted H.264, ready for `<video muted playsinline>` in the composition (keep sound in `<audio>` elements, per hyperframes-core).
- Look at a frame from each moment before planning around it; activity is not the same as meaning. Pick the entry → key action → result beats, and frame each clip inside a `browser-frame` or `phone-frame` kit so it reads as a product.
- Plan the edit around the clips' real lengths; do not speed footage up to fit.

## Capture the real UI (`--capture`)

Run the project and capture it instead of recreating screens:

```bash
node <skill-root>/scripts/capture.mjs <project-dir> --out <output-dir>/composition/assets/capture \
  --routes /,/pricing --viewport 1080x1920 --scroll-frames 24
```

- It starts the project's `dev`/`start`/`preview` script (framework default port) or, for a plain site, a built-in static server; waits until the page answers; screenshots each route at the render's viewport in headless Chrome; and, with `--scroll-frames`, captures a scroll through the page plus `scroll-<route>.mp4`. The server is always stopped afterwards.
- It never installs dependencies. If `node_modules` is missing, ask the user to install them (or install them yourself only with their permission).
- It refuses, with the file names, when the project contains iCloud placeholder files that are not downloaded (reading them hangs); ask the user to download the folder.
- A page whose own stylesheet fails to load is an error, not an unstyled screenshot. A page that never finishes loading fails after 30 seconds.
- Use the vertical viewport (`1080x1920`) for vertical renders so the page lays out as on a phone; `1920x1080` for landscape.
- Use screenshots inside `browser-frame`/`phone-frame` kits, animate between them with the composition's own motion, and prefer the scroll video only for a short "look how much there is" beat.
- Capture real content, not secrets: if a route shows personal data, tokens, or admin views, pick another route or recreate that screen instead.
