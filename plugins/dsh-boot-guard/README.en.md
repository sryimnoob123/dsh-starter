# dsh-boot-guard

[简体中文](README.md) · English

[![Check](https://github.com/SaiSenBox/dsh-boot-guard/actions/workflows/check.yml/badge.svg)](https://github.com/SaiSenBox/dsh-boot-guard/actions/workflows/check.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

> What do you do when a plugin breaks the page you normally use to disable plugins?

`dsh-boot-guard` is a small safety net for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI. It stays out of the way during a healthy boot. If plugin loading fails and the page stops at `Failed to load plugins`, Boot Guard adds a recovery console that can identify the likely culprit, skip it temporarily, and get the workspace running again.

![Boot Guard recovery console](assets/boot-guard-preview.png)

_The screenshot shows read-only self-check mode. It demonstrates the UI without changing configuration._

## Why this exists

This started with an awkward little failure: I was working on a DSH appearance plugin, refreshed the page, and the entire Web UI stopped loading.

Normally I would disable the broken plugin from the plugin settings. Unfortunately, those settings live inside the UI that had just failed. It was the software equivalent of locking the keys in the car.

Boot Guard breaks that loop. Its rescue client is injected directly by the host and does not depend on the normal browser plugin loader, so it can still show up when another plugin prevents the regular interface from starting.

## What it does

- Detects likely failed plugins from the loader error and selects them automatically
- Searches by package name or loader entry ID, with focused filters for user and skipped plugins
- Temporarily skips one or several plugins and reloads the page
- Restores a single plugin or all Boot Guard-managed skips with confirmation
- Keeps existing disabled configuration separate from Boot Guard's temporary changes
- Copies a small diagnostic report for bug reports
- Shows the complete rescue UI in Chinese or English, following the language selected in DSH settings
- Includes read-only dark, light, and narrow-screen self-check views

Skipping does not uninstall a plugin or delete its data. Boot Guard writes a marked `disabled: true` array item to the active profile's `cordis.patch.yml`; before writing, it handles empty files, `[]`, and existing arrays, and restoration removes only blocks carrying its marker.

## Install

Install and run [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) first.

### From GitHub

```sh
dsh plugin --profile web add github:SaiSenBox/dsh-boot-guard
```

Restart `dsh web` after installation.

### From npm

Once the package is published to npm:

```sh
dsh plugin --profile web add dsh-boot-guard
```

### Local development install on Windows

```powershell
git clone https://github.com/SaiSenBox/dsh-boot-guard.git
cd dsh-boot-guard
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

The local installer stages the dependency beside the DSH profile to avoid malformed cross-drive `file:` junctions on Windows.

## Usage

1. When `Failed to load plugins` appears, the recovery console mounts below the loader error.
2. Check the suggested plugin, or search for and select a different entry.
3. Choose **Skip selected and reload**. The page retries immediately; the DSH process does not need to restart.
4. After fixing the plugin, restore it from the **Skipped by rescue** filter.

The bulk restore action requires a second click to prevent accidents. A single request is capped at 64 entries.

## Self-check

With DSH Web running, open:

- Dark: `http://127.0.0.1:3080/boot-guard/preview`
- Light: `http://127.0.0.1:3080/boot-guard/preview?theme=light`
- Health: `http://127.0.0.1:3080/boot-guard/health`

The preview is read-only. Search, filters, selections, and action feedback work, but no configuration is written.

## Safety boundaries

- Mutation routes accept same-origin JSON `POST` requests and are loopback-only by default
- Body size, entry count, and IDs are validated
- Boot Guard refuses to disable itself
- Profile discovery fails closed unless a parent package explicitly declares `dsh.profile`
- Writes require a top-level YAML array; empty files and `[]` are normalized safely, while other structures are rejected
- Mutations are serialized, committed with a same-directory atomic rename, and rebased if the file changes before commit
- Restore removes only Boot Guard-marked blocks
- No telemetry and no external transmission of loader errors

To allow mutation requests from a non-loopback address, explicitly set `DSH_BOOT_GUARD_ALLOW_REMOTE_MUTATION=1` before starting DSH. This removes Boot Guard's local-only safeguard and is not recommended without a separate authentication layer.

## Compatibility

Version 1.1.2 has been verified with DSH `0.1.0-rc.6`, Node.js `24.5.0`, and Windows. The package follows DSH's Node.js requirement: `^22.19.0 || >=24.0.0`.

DSH is still a developer preview and plugin APIs may change. If a new release breaks the recovery path, please open an issue with the DSH version and the copied Boot Guard diagnostics.

## Development

```sh
npm run check
npm test
npm run pack:check
```

The rescue client intentionally has no runtime dependencies. A recovery tool is most useful when it can still start after everything around it has not.

## License

[MIT](LICENSE) © 2026 SaiSenBox
