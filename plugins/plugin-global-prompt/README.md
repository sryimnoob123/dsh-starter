# @dsh-desktop/plugin-global-prompt

Native DSH 0.1.1+ settings plugin for global and project AGENTS.md, identity/persona injection, runtime-context suppression, input validation, and result notifications. MIT licensed; works in DSH Web and the dsh-desktop Electron shell.

## Features

- **Global instructions** — edit `$DSH_HOME/AGENTS.md` from the settings panel; saved atomically and hot-reloaded.
- **Project instructions** — per-workspace `AGENTS.md` editor (paths resolved server-side from the DSH workspace registry; no arbitrary path writes).
- **Identity injection** — optional `harness:identity` prompt section.
- **Persona injection** — optional `deployment:persona` override; `{{model}}` / `{{cwd}}` placeholders are expanded by DSH at render time.
- **One-click default prompt** — fills identity + persona with the DSH web baseline template.
- **Runtime context switch** — when off, suppresses the official runtime-context snapshot (the pre-migration shell baseline; DSH 0.1.1 default is on).
- **Validation** — persona ≤ 20,000 chars, instruction text ≤ 1 MiB UTF-8; oversized writes are rejected with HTTP 400 instead of silently failing.
- **Result notifications** — config flag read by the desktop shell's Electron notifications; plain Web falls back to browser notifications.
- **agent-instructions enabled** — the bundle patch re-enables `dsh-agent-instructions` (the web-app bundle disables it by default), so the managed AGENTS.md files are actually injected.

## Install

Standalone (independent publishable plugin):

```
dsh plugin add @dsh-desktop/plugin-global-prompt
```

Or bundled inside the dsh-desktop installer (enabled by default, toggleable in plugin management).
