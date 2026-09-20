# Brand kit and polish

## Brand kit (`.shipreel/config.json`)

Projects that ship often keep a brand kit in their root so every video matches:

```json
{
  "name": "Horse Tinder",
  "tone": "yc-parody",
  "palette": { "bg": "#1a120c", "fg": "#fff6ec", "accent": "#e8963a" },
  "fonts": { "display": "Fraunces", "body": "Inter", "files": { "Fraunces": "brand/Fraunces.woff2" } },
  "logo": "brand/logo.svg",
  "handle": "@horsetinder",
  "url": "https://horsetinder.app",
  "bannedWords": ["dating site"],
  "watermark": false,
  "captions": { "style": "lower-third" }
}
```

In Step 1, check for it:

```bash
node <skill-root>/scripts/brand.mjs check <project-dir>
```

- Report every `problems` entry to the user and continue with valid fields only.
- A kit **overrides** what Step 1 would extract from CSS: palette, fonts, and logo come from the kit. `tone` is the default when the user gives no `--tone`. `captions.style` is the default caption style. Copy the kit's font files into `composition/assets/fonts/` with `@font-face` rules.
- `captionTheme` in `brand.mjs` turns the palette and body font into a `caption-theme.json`.

Before delivery (Step 4), scan the composition and share copy for banned phrases — the kit's `bannedWords` plus generic filler /shipreel never uses ("streamline your workflow", "supercharge", "unlock", "seamless", …):

```bash
node <skill-root>/scripts/brand.mjs check <project-dir> --composition <output-dir>/composition --share <output-dir>/share-copy.txt
```

Rewrite every hit in the project's own words.

## End card (`--endcard`, or when the kit has a `url`)

A closing card with a QR code to the product, the handle, and an avatar (or initials). Plan it as part of the payoff scene — reserve a rectangle inside the safe area that no other element uses for the card's duration (at least 2.5s).

```bash
node <skill-root>/scripts/overlays.mjs endcard <output-dir>/composition \
  --url https://horsetinder.app --handle @horsetinder --start 19.2 --duration 3.3 \
  --rect 96,1060,816,360 --theme caption-theme.json [--avatar assets/avatar.png]
```

For an avatar, copy the logo or a supplied image into `composition/assets/` — never hotlink. The QR code is black on white with a quiet zone so phones scan it off a screen; it shrinks (to at least 200px) before the URL text drops below 28px, and a URL too long for one line wraps only after `/`. Inject it after captions, then run `check` and `text_audit.mjs`.

## Watermark (off by default)

Only when the user passes `--watermark` or the kit sets `"watermark": true`. A small "made with /shipreel" label in the bottom-left of the safe area, hidden once the end card starts:

```bash
node <skill-root>/scripts/overlays.mjs watermark <output-dir>/composition --duration 22.5 --safe 65,250,864,1190 --theme caption-theme.json
```

Inject the end card first so the watermark knows when to stop.

## Reduced-motion variant (`--reduced-motion`)

```bash
node <skill-root>/scripts/access.mjs reduced-motion <output-dir>/composition
```

Writes `composition-reduced-motion/`: every timeline tween keeps its fades, colors, and timing but loses position, scale, rotation, and skew, so nothing slides, zooms, or shakes. Check and render it like any other composition (`shipreel-reduced-motion.mp4`). Offer it for embeds on sites that honour `prefers-reduced-motion`.

## Audio descriptions (`--describe`)

Add a `description` to every scene in `scenes.json` — what a viewer who cannot see the screen needs: the on-screen words and what the visual shows, in one or two short sentences. Then:

```bash
node <skill-root>/scripts/access.mjs descriptions <output-dir>/scenes.json --out <output-dir>/shipreel.descriptions.vtt
```

Use it as a `<track kind="descriptions">` next to the video on a website, or, with `--voice`, as the script for an audio-described render.
