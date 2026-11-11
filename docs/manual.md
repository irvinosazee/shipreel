# The shipreel manual

**You shipped the code. Now ship the campaign.**

shipreel turns a project you built into a short launch video, with music, motion, captions, and share
copy included, and with `max`, into a whole marketing campaign for every platform. It checks all of it
before you post. This manual is for using it. For how it
is built, see the [README](../README.md).

- [1. Install](#1-install)
- [2. Your first video](#2-your-first-video)
- [3. What you get](#3-what-you-get)
- [4. Steering the video](#4-steering-the-video)
- [5. Posting it everywhere](#5-posting-it-everywhere)
- [6. Changing what you got](#6-changing-what-you-got)
- [7. Your brand, every time](#7-your-brand-every-time)
- [8. Without an agent](#8-without-an-agent)
- [9. Release and pull-request videos](#9-release-and-pull-request-videos)
- [10. Updating](#10-updating)
- [11. When something goes wrong](#11-when-something-goes-wrong)
- [12. What you may do with the videos](#12-what-you-may-do-with-the-videos)

---

## 1. Install

You need **Node.js 22 or newer** and **FFmpeg** on your `PATH` (`brew install ffmpeg` on macOS,
`sudo apt install ffmpeg` on Debian or Ubuntu). Chrome is used to capture your real interface.
Rendering uses [Hyperframes](https://hyperframes.heygen.com/), which `npx` fetches for you.

```bash
npx @irvinosazee/shipreel skill install
```

That copies the skill to `~/.claude/skills/shipreel`. Restart Claude Code.

Other agents and routes:

| You use | Run |
|---|---|
| Claude Code, plugin marketplace | `/plugin marketplace add irvinosazee/shipreel`, then `/plugin install shipreel@shipreel` |
| Claude Code, Codex and opencode in one project | `npx @irvinosazee/shipreel skill install --project . --agent all` |
| Codex or opencode only | `npx @irvinosazee/shipreel skill install --project . --agent codex` (or `opencode`) |
| Any other agent | point its custom instructions at the skill's `SKILL.md`; see [other agents](other-agents.md) |
| No agent at all | `npm i -g @irvinosazee/shipreel`; see [section 8](#8-without-an-agent) |

`shipreel skill where` prints where each copy would go without changing anything.

**Check it worked:**

```bash
npx @irvinosazee/shipreel doctor
```

Every line should be a tick. A `BLOCKER` line names exactly what to install. `uv` is optional: it
only improves beat detection for music you bring yourself.

> The unscoped `shipreel` package on npm is somebody else's. Always use `@irvinosazee/shipreel`.

---

## 2. Your first video

Open your agent in the project you want to show off and say:

```text
let's /shipreel
```

That is all. It reads the project the way a person would (package metadata, README, routes, git
history), plans a 15 to 25 second video, builds it, renders it, and checks it. A first run takes a
few minutes, most of it rendering.

It works on any kind of project: a website or web app, a CLI, a library, an API, a mobile app, a
game, or a data and ML project. It works out which one it is looking at and tells the story that
suits it: a CLI gets a terminal, an API gets a request and its response.

You do not need a live URL or screenshots. When the project can be started locally and you want its
real screens in the video, add `--capture` (see [section 4](#4-steering-the-video)).

---

## 3. What you get

Everything lands in `shipreel-output/` in your project. If that folder already exists, a new run
writes to a timestamped one instead (`shipreel-output-2026-10-28-143022/`), so nothing is
overwritten.

| File | What it is |
|---|---|
| `shipreel.mp4` | The video. Loudness mastered for social platforms, with the poster baked into the first frame so every thumbnail is the frame chosen for it. |
| `shipreel.jpg` | The poster frame. |
| `share-copy.txt` | Text to post alongside it. |
| `shipreel-plan.md` | The plan: the angle, the storyboard, the timing of every scene. |
| `review.md` | The self-review: what was checked, what failed, and what was fixed. |
| `scenes.json` | Scene timings, used by cutdowns, stories and carousels. |
| `composition/` | The source of the video, as HTML. |

**Before you post,** read `review.md`. Every render is checked for duration and frame size, a
non-silent audio track, loudness, text large enough to read on a phone and held long enough to read,
and contrast. A failed check names itself and says why.

---

## 4. Steering the video

Say what you want in plain words, or use flags. Both work:

```text
/shipreel this. Make it feel like a ridiculous startup launch.
/shipreel --tone deadpan --format vertical
```

**Tone.** `--tone` takes a preset or any description you like ("fake Series A launch from 2016",
"museum exhibit", "overproduced mobile game ad").

| Preset | Feels like |
|---|---|
| `default` | Playful, clean, postable |
| `polished` | Serious and elegant, for projects that are not jokes |
| `yc-parody` | Deadpan startup energy applied to something absurd |
| `chaotic` | Fast, loud, over the top |
| `deadpan` | Calm and dry; nothing is a joke |
| `cinematic` | Trailer scale |
| `app-store` | Smooth feature cards |

**Shape and length.**

| Flag | Does |
|---|---|
| `--format landscape\|vertical\|square\|feed\|pin` | Frame size: 16:9, 9:16, 1:1, 4:5, 2:3. Landscape by default. |
| `--duration <seconds>` | Target length. Normally 15–25s, chosen for you. |
| `--explainer` | A 45–60 second demo with chapters, instead of a teaser. |
| `--title "<name>"` | The product name to use, if it should not come from the project. |

**What goes in it.**

| Flag | Does |
|---|---|
| `--capture` | Starts the project and captures its real screens with headless Chrome. |
| `--footage <recording.mp4>` | Finds the active moments in a screen recording and cuts them in. |
| `--hooks` | Renders several opening hooks side by side so you can pick one first. |
| `--metrics` | Pulls real GitHub stars or npm downloads into the video, with their source. |
| `--truth` | Strict claim checking: every claim on screen must cite a file in the repo. On by default for anything that is not a parody. |

**Sound.**

| Flag | Does |
|---|---|
| `--no-music`, `--no-sfx` | Leave out the music or the sound effects. |
| `--voice` | Adds a narrated voiceover (Kokoro, through Hyperframes). Off unless you ask. |

**Stories of change.**

| Flag | Does |
|---|---|
| `--since <tag>` | A video of what changed since that git tag or ref. |
| `--week` | A build-in-public recap of the last seven days. |

**Accessibility and polish.**

| Flag | Does |
|---|---|
| `--captions auto\|burned\|sidecar\|off` | Captions burned into the picture, or as an `.srt` file beside it. |
| `--reduced-motion` | Also renders a version without movement. |
| `--describe` | An audio-description track (WebVTT). |
| `--endcard` | An end card with a QR code to your URL. |
| `--watermark` | A small "made with /shipreel" label. Off by default. |
| `--lang es,ja,pt` | Translated versions of the video and the share copy. |

---

## 5. Posting it everywhere

```text
/shipreel --for tiktok,reels,shorts,x,linkedin
```

`--for` makes one plan and a layout for every screen, then exports a ready-to-upload file per
platform: the right frame size, text kept clear of each app's buttons and caption areas, captions
the way that platform shows them, and a file size under its limit (Discord and README exports are
squeezed under 10 MB, and the README export comes with an autoplaying GIF).

Platforms: `tiktok`, `reels`, `shorts`, `stories`, `snapchat`, `whatsapp`, `facebook-reels`,
`instagram-feed`, `facebook`, `threads`, `x`, `linkedin`, `bluesky`, `mastodon`, `reddit`,
`telegram`, `slack`, `vimeo`, `youtube`, `pinterest`, `devto`, `readme`, `discord`,
`producthunt`, `appstore`, `googleplay`.

Or groups: `vertical`, `meta`, `fediverse`, `social`, `dev`, `stores`, `all`.

Each export lands in `shipreel-output/exports/`, with an `index.html` upload checklist that says
which file goes where.

**More from the same video.**

| Flag | Does |
|---|---|
| `--cutdown 6,15` | 6- and 15-second cuts that keep the hook and the payoff. |
| `--stories` | Splits it into segments of 15 seconds or less that each end on a settled frame. |
| `--carousel` | 1080x1350 slides for Instagram, and a PDF for a LinkedIn document post. |
| `--images` | Launch images from the video: a link preview (1200x630), an X image (1600x900), a GitHub social preview and README hero (1280x640), a Product Hunt gallery (1270x760), and a LinkedIn carousel with its PDF (1080x1350). Every one is checked for size, file budget, legibility, contrast and claims. |
| `--kit` | Bundles every video, the covers, Product Hunt gallery images, an X thread, a LinkedIn post, embed snippets and credits into `launch-kit/`, plus a zip. |
| `--embed` | Writes a patch that puts the video on your own landing page or README (Next.js, Astro, SvelteKit, Vite, Vue, plain HTML). It is applied only when you say so. |

shipreel never posts anything. It writes files and stops.

---

### A whole campaign: `max`

```
/shipreel max
```

or, without an agent, `shipreel max ~/code/my-app`. You get a campaign, not one video:

1. **A brief you edit.** shipreel reads the project and pre-fills `shipreel-output/brief.md`: who it is
   for, what hurts today, what they do instead, what changes, the proof, the doubts and their answers,
   the one thing to do next, the tone, the angles, and the hashtags your audience follows. Change
   anything; your words win every time you run it again. With an agent, it fills in what the code alone
   cannot say and asks you to approve the brief before making anything. `shipreel max --brief-only`
   stops after the brief.
2. **3 to 5 pieces per platform**, each a different angle (a pain hook, a before and after, a demo, a
   myth-buster, the proof, the build story, a how-to, a hot take), in the formats each platform rewards:
   TikTok and YouTube Shorts videos, Instagram reels with a carousel and story frames, a LinkedIn post,
   carousel and video, an X thread and video.
3. **Everything to post each one** in `shipreel-output/campaign/<platform>/<NN-angle>/`: the video or
   images, `caption.txt` (or `thread.txt`), `hashtags.txt`, `alt.txt`, and `post.json` with the title,
   link, posting window and the platform's limits. `--videos` renders the videos too.
4. **A two-week calendar** (`campaign/calendar.md`) and an **upload page** (`campaign/index.html`) with
   every caption and a copy button.

Every piece is checked: platform limits, hashtag counts, alt text, every number cited to your repo,
and nothing deceptive (no invented numbers, testimonials, deadlines or scarcity). `shipreel
campaign-check` runs that check on its own. It is persuasive, never fake; nothing is posted for you.

## 6. Changing what you got

Ask in plain words ("make the third scene funnier", "the hook is too slow"), or use:

| Flag | Does |
|---|---|
| `--reroll <scene>` | Rebuilds one scene, by name or number. |
| `--retone <preset>` | The same video in another tone. |
| `--shorter` | About 20% shorter. |
| `--resume` | Continues a run that was interrupted. |

Every version is kept in `shipreel-output/versions/` with a contact sheet, so you can compare a
new cut with the last one side by side.

For notes on a whole video, open **Shipreel Studio**: every format side by side, a storyboard that
follows the video, the share copy, and a note box per scene. Notes are saved to `feedback.json`,
and the next run reads them.

```bash
npx @irvinosazee/shipreel studio serve shipreel-output
```

---

## 7. Your brand, every time

If you make videos for the same project often, put a brand kit at `.shipreel/config.json` in its
root. Every run reads it:

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

Every field is optional. A `url` turns the QR end card on. `bannedWords` never appear on screen.
Caption styles are `word-pop`, `karaoke` and `lower-third`.

---

## 8. Without an agent

The standalone CLI makes a video with no coding agent and no AI model. It fills a clean template
from your package metadata, README, git history and a capture of your running site. The skill
writes a video made for your project; the CLI fills in a good one.

```bash
npm i -g @irvinosazee/shipreel     # or prefix each line with npx @irvinosazee/

shipreel make ~/code/my-app --format vertical
shipreel images ~/code/my-app       # launch images from that video, checked
shipreel kit shipreel-output        # covers, captions, embeds in one folder
shipreel --help                     # every command
```

`shipreel make` options: `--format landscape|vertical|square`, `--out <dir>`,
`--screenshot <file.png>` to use your own image, and `--no-capture` to skip starting the project.

`shipreel images` options: `--out <dir>` (default `shipreel-output`) and `--only og,x,github,producthunt,linkedin`.
It prints every image with ✓ or the problem to fix, and exits non-zero when one fails.
`shipreel verify-images` and `shipreel copy-check` run the two checks on their own.

---

## 9. Release and pull-request videos

**A video for every release.** Built from a git tag and its release notes (or the commits since
the last tag), with the real numbers:

```bash
shipreel release ~/code/my-app --tag v1.2.0
```

**A before-and-after clip for every pull request.** It works out which pages a PR changes,
captures them on production and on the preview deploy, and scores the difference.

Both run in GitHub Actions with nothing but the workflow token:

```bash
shipreel github install release        # attaches release.mp4 to each GitHub release
shipreel github install pr-preview     # comments a clip on each pull request
```

Commit the workflow file it writes. The PR preview needs one repository variable,
`SHIPREEL_PRODUCTION_URL`, set to your live site.

---

## 10. Updating

```bash
npx @irvinosazee/shipreel@latest skill install   # the skill
npm i -g @irvinosazee/shipreel@latest            # the CLI, if you installed it
/plugin marketplace update shipreel              # if you used the plugin marketplace
```

Restart your agent afterwards. To hear about releases, go to
[the repo](https://github.com/irvinosazee/shipreel) and choose **Watch → Custom → Releases**;
each release comes with a video of what changed.

---

## 11. When something goes wrong

Start with the doctor. It says what is missing and what a run will skip:

```bash
npx @irvinosazee/shipreel doctor
```

| You see | Do |
|---|---|
| `Node.js 22+ is required` | Install Node 22 or newer (`nvm install 22`). |
| `FFmpeg and ffprobe must be on PATH` | `brew install ffmpeg` or `sudo apt install ffmpeg`. |
| `Hyperframes CLI is unavailable` | `npx hyperframes doctor`, and follow what it says. |
| `/shipreel` does nothing in your agent | Restart the agent. Check `shipreel skill where` points where your agent looks. |
| `command not found: shipreel` | You used `npx`, which does not install the command. Prefix with `npx @irvinosazee/`, or `npm i -g @irvinosazee/shipreel`. |
| A video with no music | `doctor` will say the bundled tracks are missing. Reinstall the skill. |
| A check failed in `review.md` | Ask the agent to fix it ("fix what failed in review.md"), or `--reroll` that scene. |
| Renders are very slow | Rendering is CPU and memory heavy. Close other heavy apps; a 20-second video should take a few minutes. |
| `--capture` shows a blank page | The project did not start. Run its dev server yourself, check it loads, and try again, or pass a screenshot. |

Still stuck? [Open an issue](https://github.com/irvinosazee/shipreel/issues) with the output of
`shipreel doctor` and what you ran.

---

## 12. What you may do with the videos

They are yours: post them, sell with them, use them commercially. No royalty and no required credit
to shipreel.

The bundled music is by **Sascha Ende** under **CC BY 4.0**, so a video that uses it must credit
him: `Music by Sascha Ende (ende.app), CC BY 4.0`. Every launch kit writes that line into
`credits.txt` for you. Never register a video containing that music with YouTube Content ID or any
similar system. The sound effects are by **Kenney** under **CC0**, with no conditions.

shipreel itself is MIT: read it, change it, fork it. Nothing in it sends your code anywhere; it
renders on your machine. Hyperframes, which it uses to render, reports anonymous usage of its own,
and `--metrics` calls GitHub or npm because you asked it to.

---

Made by [Irvin Osazee](https://www.irvinosazee.me). [GitHub](https://github.com/irvinosazee) ·
[LinkedIn](https://www.linkedin.com/in/irvin-osazee) · [Medium](https://medium.com/@uyiosazeeirvin).
Forked from [/brag](https://github.com/latent-spaces/brag) by Shunit Haviv Hakimi.
