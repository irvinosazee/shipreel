# Releasing shipreel

Everything here is a step **you** take. Nothing in this repo publishes itself or sends anything
anywhere, and no agent has done any of it for you.

shipreel is **open source under MIT**. It was sold for a while as a private tool; the licence gate
and the signing key are gone, and this guide is being rewritten for a public release.

---

## Already done

- Repository renamed to `shipreel`, and the 61 MB of render scratch removed from history
  (54 commits kept, same tree, 73 MB → 47 MB).
- `LICENSE` is MIT for the whole project, carrying both copyrights.
- Full git history audited before going public: no keys, tokens, licence tokens or customer data.
- The sales page is live at <https://irvinosazee.github.io/shipreel-site/>, from the separate
  public `shipreel-site` repo.
- The demo site is live at <https://irvinosazee.github.io/shipreel/> from `docs/`, and points at
  the sales page rather than offering an install command.
- CI green on every push; a nightly render checks the pipeline against the latest Hyperframes.
- A portfolio draft sits on irvinosazee.me (slug `shipreel`), unpublished.

---

## 1. Build the tarball

```bash
npm run pack-cli                        # writes dist/shipreel + dist/shipreel-0.2.2.tgz
tar tzf dist/shipreel-0.2.2.tgz | head  # look at what is inside before you ship it
```

It contains the skill, the CLI, the licence, and the bundled audio — about 17 MB. It does **not**
contain the examples or the tests.

Bump `version` in `.claude-plugin/plugin.json` before packing a new one; the filename follows it.

---

## 2. The launch post

Generate the assets from the repo's own video rather than writing them by hand:

```bash
node skills/shipreel/scripts/launch_kit.mjs shipreel-output \
  --url https://irvinosazee.github.io/shipreel-site/ --title shipreel \
  --highlights "one command, twenty seconds|every platform's frame size and safe zones|captions, covers, and share copy included"
```

That writes `launch-kit/` (and a zip) with the hero in every format, poster and link-preview
images, an X thread, a LinkedIn post, Product Hunt copy, embed snippets, and `credits.txt`.

**Say what it is.** shipreel is a fork of [/brag](https://github.com/latent-spaces/brag) by Shunit
Haviv Hakimi, which has 6k+ stars. Leading with that is both honest and the better story: you took
a good idea and built the verification, platform coverage and distribution layer it did not have.
The README's "what changed since the fork" table is the receipts.

A shape that works:

> I forked @shunithaviv's /brag — a Claude Code skill that turns your project into a launch video
> — and built the layer it did not have: every render is measured before you post it. Loudness,
> phone-legible text, platform safe zones, baked thumbnails.
>
> [video]
>
> shipreel, free and open source: [link]

The README and the site both credit the original plainly, and `LICENSE` carries her copyright.
The one obligation that bites is the music: it is CC BY 4.0 by Sascha Ende, so every launch kit
writes the credit line into `credits.txt`, and a render containing it must never be registered with
YouTube Content ID.

---

## 3. Portfolio entry

The draft is at [admin/collections/projects/24](https://www.irvinosazee.me/admin/collections/projects/24),
with the site capture as its cover plus a frame strip and the poster in the gallery. Nothing
publishes it for you: open `/studio` → "awaiting review", read it, change anything you disagree
with, press **Publish**.

---

## Still open

- **Rotate the portfolio MCP key** (`ad1fb1e6-…`). It was pasted into a chat transcript, so treat
  it as exposed: `/studio` → "the key".
- Four portfolio drafts still have no cover image: text-extract, library-management-system,
  farm-ease, brand-bible. Each needs a screenshot only you can take.
