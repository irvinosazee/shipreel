# Selling shipreel

Everything here is a step **you** take. Nothing in this repo publishes itself, charges anyone, or
sends anything anywhere, and no agent has done any of it for you.

shipreel is a **paid, private tool**. The repository stays private; what a buyer gets is a tarball
and a signed licence. That decision shapes every step below — there is no marketplace listing, no
npm package, and no public clone.

---

## Already done

- Repository renamed to `shipreel`, and the 61 MB of render scratch removed from history
  (54 commits kept, same tree, 73 MB → 47 MB).
- Both licences written: `LICENSE` (MIT, upstream portions, both copyrights) and
  `LICENSE-COMMERCIAL.md` (one tier, perpetual, no DRM).
- The signing key exists at `~/.shipreel/issuer-ed25519.pem`, and its public half is compiled into
  `skills/shipreel/scripts/licence.mjs`.
- The sales page is live at <https://irvinosazee.github.io/shipreel-site/>, from the separate
  public `shipreel-site` repo.
- The demo site is live at <https://irvinosazee.github.io/shipreel/> from `docs/`, and points at
  the sales page rather than offering an install command.
- CI green on every push; a nightly render checks the pipeline against the latest Hyperframes.
- A portfolio draft sits on irvinosazee.me (slug `shipreel`), unpublished.

---

## 1. Back up the signing key — do this first

```bash
cp ~/.shipreel/issuer-ed25519.pem <somewhere you trust that is not this machine>
```

Lose it and you cannot sign a licence for anyone new. Replacing it means changing
`ISSUER_PUBLIC_KEY` in `licence.mjs`, which invalidates **every licence already sold** — each of
those buyers would need a new token. A password manager's secure-note field is enough; it is one
line of PEM.

It is `0600`, outside the repo, and `.gitignore` blocks `*.pem`. A test runs `git grep` for private
key material on every push, so it cannot be committed by accident.

---

## 2. Take payment

No checkout exists yet. The three buttons on the sales page open your contact form, which is
honest but costs you sales.

[Polar](https://polar.sh), [Lemon Squeezy](https://lemonsqueezy.com) and
[Gumroad](https://gumroad.com) all handle VAT and sales tax as merchant of record, which matters
the moment someone in the EU buys. Create one product — **$49, one-time** — and attach the tarball
as the delivered file.

Then replace all three `https://www.irvinosazee.me/contact` hrefs in `shipreel-site/index.html`
(hero CTA, invoice row, outro) with the checkout link, and change the "No checkout yet, so this
opens a message form" note.

---

## 3. Build the tarball a buyer downloads

```bash
npm run pack-cli -- --pack              # writes dist/shipreel + dist/shipreel-0.2.2.tgz
tar tzf dist/shipreel-0.2.2.tgz | head  # look at what is inside before you sell it
```

It contains the skill, the CLI, both licences, and the bundled audio — about 17 MB. It does **not**
contain the signing key, the ledger, the examples, or the tests.

Bump `version` in `.claude-plugin/plugin.json` before packing a new one; the filename follows it.

---

## 4. Issue a licence when someone pays

```bash
node scripts/issue-licence.mjs --name "Ada Lovelace" --email ada@example.com
```

That numbers the sale, signs a token, records it in `licences/ledger.jsonl` (gitignored — it holds
customer email addresses), and prints a receipt you can paste into the reply unedited.

The buyer then runs:

```bash
npm i -g ./shipreel-0.2.2.tgz
shipreel licence install <token>
shipreel skill install
```

Other commands:

```bash
node scripts/issue-licence.mjs list              # who has what
node scripts/issue-licence.mjs verify <token>    # check one a buyer sends back
```

**There is no enforcement beyond this.** The licence names the holder; it never expires the
software, never calls home, and does not stop a copy running on a machine it was given to. That is
the deal the sales page describes, so keep it that way.

---

## 5. The launch post

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
> shipreel, $49 once: [link]

Selling a fork of an MIT project is allowed, and the README and sales page both credit it plainly.
The one obligation that bites is the music: it is CC BY 4.0 by Sascha Ende, so every launch kit
writes the credit line into `credits.txt`, and a render containing it must never be registered with
YouTube Content ID.

---

## 6. Portfolio entry

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
