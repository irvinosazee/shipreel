# Releasing shipreel

Everything here is a step **you** take. Nothing in this repo publishes itself or sends anything
anywhere, and no agent has done any of it for you.

shipreel is **free and open source under MIT**. Its job is to build an audience: stars, a mailing
list, and a reputation that later paid products can stand on. Every step below serves that.

---

## Already done

- `LICENSE` is MIT for the whole project, carrying both copyrights. The licence gate, the signing
  key and the commercial licence are gone.
- Full git history audited before going public: no keys, tokens, licence tokens or customer data.
  A test runs `git grep` for private key material on every push.
- The package is `@irvinosazee/shipreel` (the unscoped `shipreel` on npm is someone else's), the
  command it installs is `shipreel`, and a test fails if the unscoped package name shows up in an install command again.
- `.claude-plugin/marketplace.json` lists the plugin, so the repo is its own marketplace.
- CI green on every push; a nightly render checks the pipeline against the latest Hyperframes.

---

## 1. Check the package

```bash
npm test
npm run pack-cli                          # writes dist/shipreel + dist/irvinosazee-shipreel-<version>.tgz
tar tzf dist/irvinosazee-shipreel-*.tgz | head
```

It contains the skill, the CLI, `LICENSE`, and the bundled audio — about 17 MB. It does **not**
contain the examples or the tests.

## 2. Go public — npm and GitHub together

The README's install line points at both, so do them in one sitting.

```bash
npm login                                  # as irvinosazee; the scope must match the account
npm publish dist/shipreel --access public  # scoped packages are private unless told otherwise
gh repo edit irvinosazee/shipreel --visibility public --accept-visibility-change-consequences
```

Then, on GitHub: add a description and the topics `claude-code`, `agent-skills`, `hyperframes`,
`launch-video`; set the social preview to `docs/assets/hero.png`; enable Discussions if you want
questions out of the issue tracker.

Check each install route from a clean shell before announcing anything:

```bash
npx @irvinosazee/shipreel@latest skill install
npx @irvinosazee/shipreel doctor
```

and, in Claude Code, `/plugin marketplace add irvinosazee/shipreel`.

## 3. Ship an update

Users update with `npx @irvinosazee/shipreel@latest skill install`, so a release is just a new
npm version and a tag.

1. Bump `version` in `.claude-plugin/plugin.json` (the package version follows it).
2. `npm test && npm run pack-cli`
3. `npm publish dist/shipreel --access public`
4. `git tag v<version> && git push --tags && gh release create v<version> --generate-notes`

`shipreel github install release` adds a workflow that renders a release video from the tag and
attaches it to the release. Running it on this repo means every shipreel release announces itself
with a shipreel video — the best demo there is.

## 4. The landing page

`shipreel-site` is the landing page. Its job changed from earning $49 to earning an install and a
star, and its footer links GitHub, LinkedIn, Medium and irvinosazee.me — the same accounts the
portfolio links — so a visitor who likes the tool can follow the person who made it. Publishing it
is `git push` in that repo.

There is deliberately no email list yet. Add one before the first paid product, when there is
something to tell people about; anyone who only starred before then will not be on it.

## 5. The launch post

Generate the assets from the repo's own video rather than writing them by hand:

```bash
node skills/shipreel/scripts/launch_kit.mjs shipreel-output \
  --url https://github.com/irvinosazee/shipreel --title shipreel \
  --highlights "one command, twenty seconds|every platform's frame size and safe zones|captions, covers, and share copy included"
```

That writes `launch-kit/` (and a zip) with the hero in every format, poster and link-preview
images, an X thread, a LinkedIn post, Product Hunt copy, embed snippets, and `credits.txt`.

**Say what it is.** shipreel is a fork of [/brag](https://github.com/latent-spaces/brag) by Shunit
Haviv Hakimi, which has 6k+ stars. Leading with that is both honest and the better story: you took
a good idea and built the verification, platform coverage and distribution layer it did not have.
The README's "what changed since the fork" table is the receipts. Tag her; an open-source fork that
credits its original is something she can share, where a paid one was not.

A shape that works:

> I forked @shunithaviv's /brag — a Claude Code skill that turns your project into a launch video
> — and built the layer it did not have: every render is measured before you post it. Loudness,
> phone-legible text, platform safe zones, baked thumbnails.
>
> [video]
>
> Free and open source: `npx @irvinosazee/shipreel skill install`

Where: X, LinkedIn, r/ClaudeAI, Hacker News (Show HN), and the Hyperframes community. Product Hunt
works best a week later, once the README has a few stars and the first issues are answered.

The one obligation that bites is the music: it is CC BY 4.0 by Sascha Ende, so every launch kit
writes the credit line into `credits.txt`, and a render containing it must never be registered with
YouTube Content ID.

## 6. Portfolio entry

The entry at [admin/collections/projects/24](https://www.irvinosazee.me/admin/collections/projects/24)
is published, and still describes a commercial tool, with a cover that shows $39. Nothing updates it for
you: the corrected copy and cover are prepared separately, for you to review in `/studio`.

---

## Still open

- **Rotate the portfolio MCP key** (`ad1fb1e6-…`). It was pasted into a chat transcript, so treat
  it as exposed: `/studio` → "the key".
- **The one licence already issued** (to a tester) came from a build with the licence gate. It
  keeps working; nothing needs doing unless they update, and then the gate is simply gone.
- Four portfolio drafts still have no cover image: text-extract, library-management-system,
  farm-ease, brand-bible. Each needs a screenshot only you can take.
