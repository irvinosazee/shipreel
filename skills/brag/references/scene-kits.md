# Scene kits, hook tournament, and explainer mode

## Scene kits

Ready-made, brand-themed building blocks for the moments brags need most. Use a kit instead of hand-building the same window, card, or pointer again.

```bash
node <skill-root>/scripts/kits.mjs list                        # every kit with example props
node <skill-root>/scripts/kits.mjs install <output-dir>/composition   # writes assets/brag-kits.js
```

| Kit | Shows | Best for |
|---|---|---|
| `terminal` | Real commands typed character by character, then their output | CLIs, install steps, dev tools |
| `http-card` | Method, path, and status, then the JSON response line by line with one key highlighted | APIs, SDKs, backend products |
| `code-editor` | A filename tab and syntax-coloured code revealed line by line | Libraries, config-driven tools |
| `phone-frame` | A phone bezel around your own screen markup, optionally swiping a card away | Mobile apps, swipe UIs |
| `browser-frame` | A browser window with a URL bar around your own screen markup | Web apps, landing pages |
| `cursor` | A pointer gliding between frame coordinates with a click ripple | Simulated user actions over any scene |
| `game-hud` | A score that counts up, a health bar, and a combo callout | Games |

Load the bundle after GSAP, give each kit an empty slot element inside its scene's clip, and mount kits in the timeline script before registering the timeline:

```html
<script src="assets/vendor/gsap.min.js"></script>
<script src="assets/brag-kits.js"></script>
...
<section class="clip" data-start="7.1" data-duration="4.4"><div id="install-slot" style="position:absolute;left:96px;top:520px;width:888px"></div></section>
...
<script>
  const theme = { bg: "#120b08", panel: "#1d1410", fg: "#f6eee8", muted: "#b9aaa0", accent: "#ff6a3d", font: "Geist", mono: "Geist Mono" };
  const tl = gsap.timeline({ paused: true });
  BragKits.mount(tl, "install-slot", "terminal", { id: "install", at: 7.1, theme, props: { lines: [{ command: "npx brag", output: ["✓ done"] }] } });
  window.__timelines["main"] = tl;
</script>
```

- `at` is the composition time the kit starts; `mount` returns `end`, the time its last build settles — hold the scene until at least then.
- The theme comes from the project (or its brand kit), in hex.
- `phone-frame` and `browser-frame` take `screen` markup you write; it is inserted as-is.
- Kit text renders at 28px or more, so it passes `text_audit.mjs`; `check` and `text_audit.mjs` still run on the whole composition.
- Re-run `kits.mjs install` after updating the skill so the bundle matches.

## Hook tournament (`--hooks`)

When the hook is not obvious, render a still of 2–4 hook variants before building the rest:

1. Wrap the hook markup in the composition with `<!-- brag:hook:start -->` and `<!-- brag:hook:end -->`.
2. Write `hooks.json`: `[{ "id": "question", "html": "..." }, { "id": "dare", "html": "..." }]` — each variant keeps the same element ids so the timeline still animates it.
3. Run the tournament at the hook's settled time:

```bash
node <skill-root>/scripts/hooks.mjs tournament <output-dir>/composition --variants hooks.json --at 1.6
```

It writes `<output-dir>/hooks/sheet.jpg` with the variants side by side. Look at it, pick the variant that reads fastest and is most specific to the project (or show the sheet to the user), put that hook in the composition, and delete the `composition-hook-*` directories.

## Explainer mode (`--explainer`, `--duration 45-60`)

For demos that need more than 25 seconds:

- Plan 4–7 scenes, each a chapter a viewer could jump to; every chapter at least 10 seconds.
- The hook still lands in the first 2 seconds, and every creative law still applies. Only the length limit changes.
- Verify with the explainer range: `verify_render.mjs brag.mp4 --min 45 --max 60`.
- Write YouTube chapters from `scenes.json` (scenes under 10s merge into the next):

```bash
node <skill-root>/scripts/cuts.mjs chapters --scenes <output-dir>/scenes.json > <output-dir>/chapters.txt
```

Paste `chapters.txt` into the YouTube description. It refuses when the scenes cannot make at least 3 chapters of 10s — shorten nothing to satisfy it; a video that short does not need chapters.
