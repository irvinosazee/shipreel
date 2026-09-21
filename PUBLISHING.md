# Publishing shipreel

Everything here is a step **you** take. Nothing in this repo publishes itself, and no agent has done any of it for you.

Order matters: the repository rename (step 1) is what makes every link in the README, the site, and the workflows resolve.

---

## 1. Rename the repository — required

The repo is still `irvinosazee/brag`; the code, docs, site, and action all say `irvinosazee/shipreel`.

**Settings → General → Repository name → `shipreel` → Rename.**

Or:

```bash
gh repo rename shipreel --repo irvinosazee/brag
git remote set-url origin https://github.com/irvinosazee/shipreel.git
```

GitHub redirects the old URL, so nothing breaks while you update links. Rename the local folder too, if you like (`~/Documents/Web Dev/Projects/brag` → `shipreel`); nothing in the code depends on the folder name.

### Optional: drop the 61 MB of scratch files from history

Commit `e6a40e7` accidentally added the local render directory (`brag-output/`, 520 files). It is untracked now, but the blobs still sit in history, so a clone pulls ~73 MB instead of ~12 MB. Only worth fixing **before** the repo is public and before anyone forks it:

```bash
# from a clean working tree, on main
git filter-repo --path brag-output --invert-paths   # brew install git-filter-repo
git push --force origin main
```

This rewrites history. You are the only committer, so nothing else breaks. Skipping it costs a bigger clone and nothing else.

---

## 2. Make it public

**Settings → General → Danger Zone → Change visibility → Public.**

Required for: the plugin marketplace, `uses: irvinosazee/shipreel@main` in other repos, `npx github:irvinosazee/shipreel`, and the GitHub Pages site.

Before you flip it, check with fresh eyes:

- [ ] `git log -p --all | grep -iE "api[_-]?key|secret|token|password"` finds nothing real.
- [ ] `.shipreel/config.json` files, `.env` files, and render outputs are still ignored.
- [ ] The four example projects are fake products you are happy to publish (they are).
- [ ] The portfolio MCP key you pasted into a chat is **not** in the repo (it isn't) — and rotate it anyway from `/studio` → "the key", since it has been in a transcript.

---

## 3. Turn on the site

**Settings → Pages → Source: Deploy from a branch → `main` → `/docs` → Save.**

Live at `https://irvinosazee.github.io/shipreel/` a minute later. Check the hero video plays and the install commands are the shipreel ones.

If you want `shipreel.dev` (or any domain) instead: add a `CNAME` file under `docs/` with the domain, point a DNS `CNAME` at `irvinosazee.github.io`, then set it as the custom domain in Pages.

---

## 4. Claude Code plugin marketplace

The manifests are already correct (`.claude-plugin/marketplace.json` and `plugin.json`, both named `shipreel`, version `0.2.2`).

Once the repo is public, anyone can install it:

```
/plugin marketplace add irvinosazee/shipreel
/plugin install shipreel@shipreel
```

Test it yourself first, from a different project directory, exactly as a stranger would:

1. `/plugin marketplace add irvinosazee/shipreel`
2. `/plugin install shipreel@shipreel`
3. `/shipreel` inside some small project of yours.
4. Confirm it finds its own assets (music, SFX) from the plugin cache — that is what the doctor's `assetsRoot` line is for.

To get listed in Anthropic's public directory, submit the repo through their plugin directory form; being installable does not require it.

**Bump the version** in `.claude-plugin/plugin.json` whenever you ship changes — installs pin to it.

---

## 5. Other agents (optional)

The `skills` CLI already works against a public repo, no publishing needed:

```bash
npx skills add https://github.com/irvinosazee/shipreel --skill shipreel
```

---

## 6. npm, for the standalone CLI (optional)

`shipreel` is free on npm. The package is built from this repo, never published automatically:

```bash
npm run pack-cli                 # stages dist/shipreel + a tarball
tar tzf dist/shipreel-0.2.2.tgz | head -20   # look at what is inside
npm publish dist/shipreel        # needs npm login and 2FA
```

Then `npx shipreel make` works for anyone. Until you publish, `npx github:irvinosazee/shipreel` does the same job from the public repo.

Cut a GitHub release at the same time (`gh release create v0.2.2 --generate-notes`) — if you install the release workflow, that release gets its own video attached automatically.

---

## 7. The launch post

Generate the assets from the repo's own video rather than writing them by hand:

```bash
node skills/shipreel/scripts/launch_kit.mjs brag-output \
  --url https://irvinosazee.github.io/shipreel/ --title shipreel \
  --highlights "one command, twenty seconds|every platform's frame size and safe zones|captions, covers, and share copy included"
```

That writes `launch-kit/` (and a zip) with:

- `videos/` — the hero in every format and per-platform export
- `images/` — poster, `og.jpg` for link previews, YouTube thumbnail, Product Hunt gallery
- `copy/` — an X thread, a LinkedIn post, Product Hunt name/tagline/description
- `embed/` — README and HTML snippets
- `credits.txt` — music, SFX, tools

**Say what it is.** shipreel is a fork of [/brag](https://github.com/latent-spaces/brag) by Shunit Haviv Hakimi, which has 6k+ stars. Leading with that is both honest and a better story than pretending otherwise: you took a good idea and built the verification, platform coverage, and distribution layer it did not have. The README's "what changed since the fork" table is the receipts.

A shape that works:

> I forked @shunithaviv's /brag — a Claude Code skill that turns your project into a launch video — and spent three days turning it into a pipeline that checks its own work: 36 scripts, 234 tests, 26 platform presets, and a nightly render that catches upstream breakage within a day.
>
> [video]
>
> shipreel: [link]

---

## 8. Portfolio entry

A draft sits on irvinosazee.me (slug `shipreel`), written through the site's MCP endpoint. Nothing is published by it: open `/studio` → "awaiting review", read it, fix anything you disagree with, press **Publish**.

---

## What is already done

- Every manifest, doc, script, and test renamed to shipreel; the original project credited in the README, the skill, and the site colophon.
- 26 platform presets with sourced specs.
- Hero video re-rendered and verified; site copy updated.
- CI green on every push; a nightly render checks the pipeline against the latest Hyperframes.
- `dist/shipreel` builds and installs locally (tested), but has **not** been published.
