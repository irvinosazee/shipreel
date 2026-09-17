# Project types

`detect_project.mjs` classifies the project before Step 1 reads anything:

```bash
node <skill-root>/scripts/detect_project.mjs <project-dir>
```

It returns `type`, `confidence`, `framework`, `signals`, `alsoLooksLike`, `subprojects`, and `inspect` (the files worth reading first, most useful first). Detection is file-based and never runs project code.

How to use the result:

- **Start reading from `inspect`**, then follow imports and links from there. It is a starting point, not a limit.
- **`confidence: low` or `type: unknown`:** read the README and top-level files, decide the type yourself, and say which strategy you picked in `brag-plan.md`.
- **Monorepo story mode:** when `subprojects` include both an app and an API, cut between them — the screen action (`browser-frame` or `phone-frame` with `cursor`) and the real request behind it (`http-card` with an endpoint from the API subproject), then back to the result on screen. One pairing is enough; it proves the product is real end to end.
- **`subprojects`:** the primary type is the most showable subproject (a web or mobile app beats the API behind it). Use the others as supporting material — an API subproject can supply the real response shown on screen.
- **`alsoLooksLike`:** borrow from that strategy when it helps (a CLI that also ships a web dashboard can show both).
- The user's direction always wins. If they say "brag about the API", use the API strategy.

Every strategy still follows the creative laws in `SKILL.md`: show the real thing, keep text readable, 15–25 seconds.

---

## `landing-page`

Static marketing site or single page.

- **Read:** `index.html` in full, stylesheets, `PRODUCT.md`/README.
- **Real material:** hero headline, the strongest claim, testimonial or stat copy, the signature visual (card, diagram, mockup).
- **Flow to show:** usually none. Recreate the strongest visual and let the copy carry the story.
- **Hook pattern:** the most absurd or impressive claim, verbatim.
- **Avoid:** marching through every section in page order.

## `web-app`

Next.js, Remix, SvelteKit, Nuxt, Vite + React/Vue/Svelte, Django, Electron.

- **Read:** the user-facing routes in `inspect` (pages before API handlers), key feature components, global styles or theme tokens, seed data and fixtures for realistic content.
- **Real material:** the main screen in a realistic state, real labels and empty-state copy, the design tokens.
- **Flow to show:** entry → key action → result. For example: "create a project → paste a link → dashboard fills with results".
- **Hook pattern:** the result screen first, then rewind to how fast it was to get there.
- **Avoid:** login screens, settings pages, and admin panels unless they are the product.

## `cli`

A `bin` entry, commander/yargs/oclif/ink, clap, cobra, typer/click, `[project.scripts]`.

- **Read:** the bin or entry file, command definitions and `--help` text, README usage blocks, `examples/`.
- **Real material:** the exact command names, flags, and output format. Prefer output copied from the README or tests over invented output.
- **Flow to show:** a terminal window (the `terminal` kit): type the command (keyboard SFX from `sfx/keyboard/`), output streams in, the satisfying final line lands (✓, a table, a summary).
- **Visual identity:** most CLIs have no palette. Use a terminal theme that matches the tool's personality, and the project's logo or README badge colors if present.
- **Hook pattern:** the before/after — the painful manual way in one line, then the one command.
- **Avoid:** scrolling walls of output; show the three lines that matter.

## `library`

An npm/PyPI/crate package with exports and no app framework.

- **Read:** the public entry (`index`/`lib`/`mod`), README quick start, `examples/`, types for the main API.
- **Real material:** the smallest real usage snippet and what it produces.
- **Flow to show:** install line (`terminal` kit) → 3–6 lines of code (`code-editor` kit) → the result (rendered UI, printed value, chart, benchmark number).
- **Hook pattern:** the line count or the benchmark ("one function", "2 KB", "40× faster" only if the README states it).
- **Avoid:** code that is too long to read at video pace; one snippet per scene, large type, syntax highlighted.

## `api`

Express/Fastify/Hono/Elysia/NestJS, FastAPI/Flask, axum, gin, or an OpenAPI spec.

- **Read:** the OpenAPI spec if present, route and controller files, request validation schemas, README examples.
- **Real material:** real endpoint paths, request fields, and response shapes taken from schemas or tests.
- **Flow to show:** a request and its JSON response with the key field highlighted (`http-card` kit) → what the response enables.
- **Hook pattern:** the thing that used to take a whole backend, now one request.
- **Avoid:** listing every endpoint; pick the one that best shows the product.

## `mobile`

Expo/React Native, Flutter, Capacitor, native iOS/Android.

- **Read:** screen components, navigation setup, `app.json`/`pubspec.yaml` for the app name and colors, assets for the icon.
- **Real material:** the main screens and the app icon.
- **Flow to show:** inside a phone frame (`phone-frame` kit, `cursor` kit for taps): open app → the signature interaction (swipe, tap, scan) → the result screen. Vertical format is natural here; suggest `--format vertical` if the user did not choose.
- **Hook pattern:** the app icon bouncing onto a home screen, then straight into the key interaction.
- **Avoid:** onboarding carousels and permission prompts.

## `game`

Phaser, PixiJS, Kaplay, Godot, Unity, Bevy, Pygame.

- **Read:** scenes or levels, the player controller, sprite and asset folders, the title/HUD code for the name and score language.
- **Real material:** actual sprites, tiles, and palette from the asset folders (copy them into the composition's assets).
- **Flow to show:** title screen → a rebuilt gameplay moment (jump, combo, boss) with the real sprites → the score counting up (`game-hud` kit).
- **Hook pattern:** the most chaotic gameplay beat first.
- **Avoid:** claiming a gameplay recording; recreate a moment faithfully instead.

## `data-ml`

Notebooks, PyTorch/TensorFlow/scikit-learn, Streamlit/Gradio.

- **Read:** notebooks (markdown cells and final outputs), `results/` or `figures/`, metrics files, the README's headline result.
- **Real material:** real numbers and charts from saved outputs — never invented metrics.
- **Flow to show:** the input (an image, a sentence, a dataset row) → the model or pipeline step → the output or the chart that proves it works.
- **Hook pattern:** the single most surprising result number, with its source.
- **Avoid:** architecture diagrams as the centerpiece; show what it does.
