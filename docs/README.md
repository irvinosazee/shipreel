# brag — site

Static single-page launch site for `/brag`. Plain HTML/CSS/JS, no framework, no build step. This folder is the GitHub Pages deploy root.

## Local preview

```bash
python3 -m http.server 8000
open http://localhost:8000
```

## Deploy (GitHub Pages)

Fully self-contained — no build step. In the repo's **Settings → Pages**, set the source to **Deploy from a branch**, branch `main`, folder **`/docs`**.

The gallery videos ship committed: each demo shown (`examples/horse-tinder/`, `examples/fish-flight-school/`, `examples/taxi-for-taxis/`) includes its `brag.mp4`, a `brag.jpg` poster, and a `site.jpg` thumbnail. Heavy composition sources (`brag-output-*/`) are git-ignored.

## Adding / updating a gallery example

1. Render the brag video and place `brag.mp4`, `brag.jpg` (poster), and `site.jpg` (thumbnail) under `examples/<slug>/`, next to the demo's `index.html` and `styles.css`. Pick `brag.jpg` as the **best** frame, not an arbitrary one — grab the video's strongest settled beat (the hook line, or the hero/logo reveal) full-res with ffmpeg:

   ```bash
   ffmpeg -ss 3.2 -i docs/examples/<slug>/brag.mp4 -frames:v 1 -q:v 2 docs/examples/<slug>/brag.jpg
   ```
2. Add a card in `index.html` pointing at those paths.
3. Un-ignore the slug in `.gitignore` and commit the assets.
