# Localization (`--lang es,ja,pt`)

Build and review the video in its source language first. Then, for each language:

## 1. Mark what must not be translated

In the source composition, add `data-i18n-skip` to elements whose text is technical: commands and code, URLs, handles, product and brand names that stay in English, and format labels ("9:16 · 1080P"). Runs with no letters at all (`$`, `●`, timers) are skipped automatically.

## 2. Extract, translate, validate

```bash
node <skill-root>/scripts/i18n.mjs extract <output-dir>/composition --out <output-dir>/strings.json
```

Write `<output-dir>/strings.<lang>.json` — `{ "t0": "...", "t1": "..." }` — translating each `text`:

- Translate meaning and tone, not word for word; keep the joke working in that language. `context` shows which element each run belongs to (a headline, a label, a highlighted word).
- Keep line breaks natural: a headline split across several runs (`t5`, `t6`, `t7`) must still read as one sentence in order.
- Keep URLs, `/commands`, `@handles`, and numbers exactly as they are.
- Aim for similar length; very long translations are the main cause of overflow.

```bash
node <skill-root>/scripts/i18n.mjs validate <output-dir>/strings.json <output-dir>/strings.<lang>.json
```

Fix every error (missing or empty keys, a dropped URL, command, handle, or number). Warnings name strings that grew more than 40% — shorten them if the checks below complain.

## 3. Apply and check

```bash
node <skill-root>/scripts/i18n.mjs apply <output-dir>/composition --lang <lang> --strings <output-dir>/strings.<lang>.json
```

This writes `composition-<lang>/` with the translated text and `<html lang>`. Run `npx hyperframes check`, `text_audit.mjs`, and a snapshot of every settled moment in it, and look at the frames: a translation can pass the checks and still wrap awkwardly. Fix by shortening the translation first; only adjust the source layout if every language needs it.

Text that lives in scripts — kit props, timeline code — is not extracted; translate those strings in a per-language copy of the script values and note it in the plan.

## 4. Voice and share copy

With `--voice`, find the Kokoro voice for the language:

```bash
node <skill-root>/scripts/i18n.mjs voice <lang>
```

It returns `{ voice, ttsLang, listed }`. Use `npx hyperframes tts "<script>" --voice <voice> --lang <ttsLang>`. `listed: false` means the voice is not in `npx hyperframes tts --list` — run that list first and pick an available voice if it is missing. `null` means Kokoro has no voice for that language: ship captions and on-screen text without narration and tell the user.

Write `share-copy.<lang>.txt` in the same language, and render to `shipreel-<lang>.mp4`.
