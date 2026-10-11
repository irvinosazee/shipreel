# Using /shipreel with other AI coding agents

Agents like **Cursor**, **Aider**, or any LLM with custom instructions don't have native `SKILL.md` discovery. Use one of these methods:

## Option 1: Paste into custom instructions

Open your agent's custom instructions or system prompt settings and paste the full contents of [`skills/shipreel/SKILL.md`](../skills/shipreel/SKILL.md).

## Option 2: Reference as a file path

If your agent supports loading instructions from a file, point it at:

```
path/to/skills/shipreel/SKILL.md
```

## Option 3: Copy the skill folder

For Claude Code, Codex and opencode, the CLI does this for you:

```bash
shipreel skill install                          # ~/.claude/skills/shipreel
shipreel skill install --project . --agent all  # all three, in one project
shipreel skill where                            # print the paths, change nothing
```

For anything else, copy `skills/shipreel/` into wherever your agent looks for skill files:

```bash
cp -r skills/shipreel/ ~/.your-agent/skills/shipreel/
```

## Prerequisites

Regardless of method, the environment needs:
- **Node.js 22+**
- **FFmpeg** on `PATH`
- **Hyperframes CLI** — `npx hyperframes doctor` to verify
- **The skill folder accessible** for its assets (music, SFX, reference docs)
- **A licence** — `shipreel licence install <token>`, or `SHIPREEL_LICENCE` in the environment

Verify with `shipreel doctor`, which reports all of the above including the licence.
