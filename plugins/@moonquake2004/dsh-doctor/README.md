# dsh-doctor

> [中文版 README](README.zh.md) · English

Offline diagnostic for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — run it **before** boot or before installing plugins, and it tells you which of the failure classes this community has been reporting will bite.

Zero npm dependencies. One file. Runs anywhere `node` exists (`zstd` needed only for `.zstd` session logs; E1 checks for it).

## Why

dsh's plugin tree is "fragile by install": a dangling reference, a broken `file:` link, a duplicate entry id, or a corrupted session log can brick the profile at boot or stall the whole web server — and `--dump-config` never mounts the loader, so it passes on broken setups. This class of failure was consolidated in [dsh discussion #1496](https://github.com/deepseek-ai/deepseek-harness/discussions/1496) (Advisory: plugin-install path needs guardrails). `dsh-doctor` is the offline check that advisory calls for — 28 built-in checks (env/profile/session) mapped to 18 community reports, each verified with synthetic negative fixtures, plus a self-updating remote catalog of 5 declarative pattern checks.

## Usage

```bash
node dsh-doctor.mjs                      # everything (env + profile + session)
node dsh-doctor.mjs --profile web        # profile checks only
node dsh-doctor.mjs --session <path>     # session checks (default: latest session)
node dsh-doctor.mjs --env                # env checks
node dsh-doctor.mjs --json               # machine-readable output
node dsh-doctor.mjs --no-catalog         # skip remote catalog fetch (bundled copy only)
node dsh-doctor.mjs --json --envelope    # v1 doctor-contract envelope (lowercase status, exit 0/1/2)
```

Exit codes (default mode): `0` = all pass · `1` = problems found (built-in checks + catalog `severity: error`) · warn-level catalog failures don't flip the exit code.

With `--envelope` (doctor-contract mode): `0` = all pass · `1` = any WARN · `2` = any FAIL. The envelope follows the shared `dsh-doctor/v1` schema (`{ schema, generatedAt, profile, exitCode, summary, ok, checks:[{name,status,detail}] }`) so implementations are interchangeable for CI/marketplace use. Installed via npm, the CLI is also available as the `dsh-doctor` bin.

## Checks (28 built-in + 5 catalog = 33)

### env
| ID | Checks | Discussion |
|---|---|---|
| E1 | `node`/`pnpm`/`zstd` on PATH | [#1270](https://github.com/deepseek-ai/deepseek-harness/discussions/1270) |
| E2 | `.env` is a file, not a directory | [#71](https://github.com/deepseek-ai/deepseek-harness/discussions/71) |
| E3 | node version / `--expose-internals` reachability | [#113](https://github.com/deepseek-ai/deepseek-harness/discussions/113), [#1313](https://github.com/deepseek-ai/deepseek-harness/discussions/1313) |
| E4 | node-pty native binary present (`prebuilds/<platform>-<arch>/pty.node`) | [#1219](https://github.com/deepseek-ai/deepseek-harness/discussions/1219) |
| E5 | storage JSON files valid (strict UTF-8 + parse) | [#1357](https://github.com/deepseek-ai/deepseek-harness/discussions/1357) |
| E6 | anchor tripwire: our S6/S7/S10 contracts still in installed `dsh-session` | [anti-rot idea](https://github.com/deepseek-ai/deepseek-harness/discussions/1534) |
| E10 | web port 3080 availability before launch (dsh web itself = OK; other process = FAIL; `DSH_DOCTOR_PORT` override) | [#1719](https://github.com/deepseek-ai/deepseek-harness/discussions/1719) |

### profile
| ID | Checks | Discussion |
|---|---|---|
| P2 | bundle-layer vs user-patch insert id collisions (boot crash) | [#1404](https://github.com/deepseek-ai/deepseek-harness/discussions/1404) |
| P3 | user-patch insert `name:` resolvable from the profile anchor | [#1197](https://github.com/deepseek-ai/deepseek-harness/discussions/1197), [#880](https://github.com/deepseek-ai/deepseek-harness/discussions/880) |
| P4 | `file:` dependencies intact | [#1197](https://github.com/deepseek-ai/deepseek-harness/discussions/1197) |
| P5 | no top-level `@deepseek-ai/*` duplication (dual module instances) | [#1486](https://github.com/deepseek-ai/deepseek-harness/discussions/1486), [#1697](https://github.com/deepseek-ai/deepseek-harness/discussions/1697) |
| P7 | `cordis.patch.yml` structural lint (`~ insert:` null-literal typo, tab indentation, missing colon → UI won't boot) | [#1724](https://github.com/deepseek-ai/deepseek-harness/discussions/1724) |
| P12 | profile-installed bundle version vs running CLI (emits vocabulary name `installed_bundle`, #1719 v1.1: skip when unlisted / warn on manifest-lies or divergence / pass when equal; the web "Doctor" panel / `/dsh-doctor/run` API run the bundle) | [#1719](https://github.com/deepseek-ai/deepseek-harness/discussions/1719) |
| P13 | client-half `provide` service name clashes with core client services (`chatFileMentions` etc. from `@deepseek-ai/dsh-client-*`, warn) or cross-bundle same-name grabs (browser-side "service already registered" → UI white screen, server logs see nothing) | [#2752](https://github.com/deepseek-ai/deepseek-harness/discussions/2752) |
| P14 | declared `bin` executability (target file present + shebang required for text `bin`; exec-bit alone does not identify the interpreter → ENOEXEC on direct run, #1846) | [#1846](https://github.com/deepseek-ai/deepseek-harness/discussions/1846) |

### session
| ID | Checks | Discussion |
|---|---|---|
| S1 | orphan `tool_call` (no matching tool result) | [#1363](https://github.com/deepseek-ai/deepseek-harness/discussions/1363), [#1544](https://github.com/deepseek-ai/deepseek-harness/discussions/1544) |
| S2 | unclosed turns (session stuck "running") | [#466](https://github.com/deepseek-ai/deepseek-harness/discussions/466), [#1265](https://github.com/deepseek-ai/deepseek-harness/discussions/1265) |
| S6 | `seq == index` contiguity (official semantics, chunk rows expanded like `expandRow`) | [#1333](https://github.com/deepseek-ai/deepseek-harness/discussions/1333), [#1452](https://github.com/deepseek-ai/deepseek-harness/discussions/1452), [#1469](https://github.com/deepseek-ai/deepseek-harness/discussions/1469) |
| S7 | post-`end-seed` replay (replayed committed tail) | [#1497](https://github.com/deepseek-ai/deepseek-harness/discussions/1497) |
| S8 | unknown event types without `ignorable` (wholesale refusal) | [#1538](https://github.com/deepseek-ai/deepseek-harness/discussions/1538) |
| S9 | zstd container frame count (single-frame logs → `session.list` 500) | [#1043](https://github.com/deepseek-ai/deepseek-harness/discussions/1043) |
| S10 | `sourceEventSeqs` referencing non-earlier events | [#1469](https://github.com/deepseek-ai/deepseek-harness/discussions/1469) |
| S11 | whole-session scan: corrupt → quarantine suggestion; oversized / workspace estimated-heap (max(events×600B, bytes×6), default 1GiB, `DSH_DOCTOR_HEAP_MB`) → cold-start stall risk | [#1550](https://github.com/deepseek-ai/deepseek-harness/discussions/1550) |

## Notes

- The S-class checks replicate the harness's own validation (e.g. `SessionLogScanner`'s `seq == events.length` with `expandRow` chunk expansion), so offline verdicts match what boot/resume would do.
- `$DSH_HOME` is honored (default `~/.dsh`), so you can dry-run against a temp home without touching your real data.
- In-flight tool calls in the current active turn are reported as warnings, not errors, so scanning a live session never false-positives.
- Sibling implementation with the same scope: [boyin111-1/dsh-doctor](https://github.com/boyin111-1/dsh-doctor) — the two tools cross-verified against the same broken fixtures.

## Related community tools

> **dsh-doctor/v1 vocabulary r5 compatible, v1.1 `installed_bundle` pending** — drafted by [@ciceroyang](https://github.com/ciceroyang) (ciceroyang/dsh-doctor), reviewed by [@sjh9714](https://github.com/sjh9714) (dsh-win32) and [@moonquake2004](https://github.com/moonquake2004) ([#1719](https://github.com/deepseek-ai/deepseek-harness/discussions/1719)). Our `node`/`pnpm` checks emit the vocabulary names with r5 semantics (pass/warn/fail/skip; `summary.skip` always present); P12 emits the v1.1 vocabulary name `installed_bundle` (skip/warn/pass/warn four-state, r6 sheet pending).

- [zoahdev/dsh-plugin-doctor](https://github.com/zoahdev/dsh-plugin-doctor) — pre-publish plugin bundle health checks (manifest/patch/entry/files/build/pack+fresh-profile install) plus a `profile-shadow` tripwire for host-shadowing (author/CI side). Complementary to this tool's user-side profile/session/env diagnostics; its `profile-shadow` and our P5 flag the same host-shadowing precondition from two sides.
- [boyin111-1/dsh-doctor](https://github.com/boyin111-1/dsh-doctor) — sibling offline diagnostic, cross-verified against the same broken fixtures.



## Symptom → check quick-start (dsh-diagnose alignment)

If you're coming from a symptom (rather than from the machine), these are the checks to run first. Coverage is honest: ✅ = direct offline coverage, ⚠️ = partial (we see the log/profile effects, not the runtime internals), ❌ = gap (runtime-only, no offline probe today).

| Symptom family | dsh-doctor checks | What they catch |
|---|---|---|
| session log corruption / can't resume | S1, S2, S6, S7, S8, S9, S10 | orphan tool calls, unclosed turns, seq gaps, end-seed replay, unknown event types, zstd single-frame, sourceEventSeqs drift |
| oversized / cold-start stall | S11 | estimated materialization heap, corrupt-session quarantine |
| boot failure (UI won't open) | P1–P10, E10 | dangling bundles, id collisions, patch syntax, host shadowing, adapter conflicts, client-service injects, port 3080 |
| tool registry gaps (tools missing) | P1, P2, P8, P10, P9 | unresolved/conflicting/duplicated tool registrations, client-only service injects |
| compaction / history unavailable | S10, S6, S8 | sourceEventSeqs not remapped after compaction |
| agent-loop lifecycle (session stuck "running") | S2, S1, S6 | unclosed turns, orphan tool calls, broken seq |
| llm retry storms | S6, S11, S2 | retry traffic effects on log integrity/size |
| token metering off | S11, S1, S2 | metering derives from the event stream |
| workflow script failures | P7, S6, S8, S1 | patch syntax (boot), workflow event integrity |
| approval policy pending | S2, S1 | open turns / orphan calls from pending or rejected approvals |
| credentials resolution | E2, E5, P4 | `.env` shape, storage JSON, `file:` links |
| web internals | E10, P10, E5 | port, client half, workspace storage |
| subagent depth | S11, S8 | session size, subagent event types |
| sandbox denials | E4 | node-pty binary (infra only) — ❌ runtime policy not offline-checkable |
| approval internals | S2 | ⚠️ runtime policy; only the turn-level effect |
| credentials internals | E2, E5 | ⚠️ file-level only |

The `dsh-doctor/v1` envelope (`--json --envelope`) is the machine-readable form of any of these runs, so a symptom tool can consume the verdict directly.

## Self-update check (v0.2.1, Layer B)

The tool also watches its own npm version: each run compares the installed version against `dist-tags.latest` (same 6h TTL cache + offline fallback as the catalog). When a newer release exists it prints a notice and reports `update: { current, latest, available }` in JSON — it never touches your install without being asked.

- `--update` — apply the update now: runs `pnpm install` in the profile that hosts the plugin (or `DSH_DOCTOR_UPDATE_CMD` to override), then tells you to restart `dsh web`.
- `DSH_DOCTOR_AUTO_UPDATE=1` — apply updates automatically when one is available.
- Honest boundary: cordis loads plugins at boot, so the new engine only activates after a restart — Layer B replaces files and reminds you to restart, it doesn't hot-swap the running plugin.
- `--no-catalog` also disables the update check (pure offline mode).

## Remote check catalog (v0.2.0)

The built-in 26 checks are compiled into the tool. The **catalog** is a second, self-updating layer: `plugin/checks.json` in this repo holds declarative rules (data, not code), and every installed instance picks up new rules automatically — no reinstall needed.

- **How it works**: each run tries to fetch `plugin/checks.json` from GitHub (3s timeout) → on success it's cached to `$DSH_HOME/.cache/dsh-doctor/checks.json` (TTL 6h) → on failure it falls back to the last-known-good cache, then to the bundled copy. New checks therefore arrive within ≤6h of being committed upstream.
- **Safety**: rules are **read-only probes** executed by the built-in engine (`command-exists`, `path-*`, `json-valid`, `text-contains` / `text-not-contains`, `file-size-above`, `glob-count`). The remote payload can never run code — it can only add pattern checks.
- **Severity**: `error` (default, flips exit code) or `warn` (reported, exit code unaffected). Disable remote fetch with `--no-catalog`.
- **Adding a check** (that's the whole point — no plugin release needed): append an entry to `plugin/checks.json` and commit. Catalog checks shipped so far:

| ID | Probe | Checks | Discussion |
|---|---|---|---|
| E7 | `command-exists` | `dsh` on PATH | [#1270](https://github.com/deepseek-ai/deepseek-harness/discussions/1270) family |
| E8 | `text-contains` (warn) | `ignore-workspace-root-check=true` present in profile `.npmrc` | [dsh-market #20](https://github.com/dsh-market/dsh-market/issues/20) |
| E9 | `json-valid` | `config/workspace.json` parses | [#1357](https://github.com/deepseek-ai/deepseek-harness/discussions/1357) family |
| P6 | `text-not-contains` | patch insert `name:` with spaces (Windows spawn lint) | [#1420](https://github.com/deepseek-ai/deepseek-harness/discussions/1420) |

Catalog check results are marked `src: "catalog"` in JSON output and `[目录]` in CLI output.

## LLM observer (v0.3.0, Layer C)

The third layer closes the loop between field signals and the catalog: **semi-automatic candidate-check proposals** from a diagnostics run, with a human certification gate. Design + details in [`docs/layer-c-observer.md`](docs/layer-c-observer.md).

- `dsh-doctor --observe run.json` — cluster the fail/warn signals of a diagnostics run (a `--json` / `--envelope` output, or a directory of JSON files), then draft candidate checks in the catalog schema (deterministic, default `severity: warn`).
- `--observe-llm "<cmd>"` (or `DSH_DOCTOR_LLM_CMD`) — enrich drafts with an LLM: `cmd` reads the prompt on stdin and writes a JSON reply on stdout. Replies are constrained to the closed probe vocabulary; any parse/schema violation silently falls back to the draft.
- `--observe-apply proposals.json` — merge **validated** proposals into the local overlay `plugin/checks.local.json` (idempotent). The overlay runs in diagnostics until you certify the check, but is never distributed — certified checks belong in `plugin/checks.json`.

Safety invariants: closed probe vocabulary (LLM output is data, never code), proposals default to `warn`, nothing auto-ships, and no external service is required (no `--observe-llm` = deterministic mode).

## Also installable as a dsh plugin

The tool ships as a proper dsh bundle (`plugin/`), so you can run the same checks (28 built-in + 5 catalog rules) from inside the web UI:

```bash
# install into a profile (works from a checkout or a published path)
dsh plugin --profile web add file:/path/to/dsh-doctor/plugin
```

What you get:
- **Settings → Doctor** panel: one click runs all checks and renders results grouped by env / profile / session, with per-check fixes and quarantine suggestions (suggestions are shown, never auto-executed);
- **HTTP API**: `GET /dsh-doctor/run` returns the same checks as JSON (optional `?profile=` / `?session=` to narrow scope).

Architecture: the plugin's server route shells out to the bundled `plugin/dsh-doctor.mjs --json` — the same single source of truth as the CLI (the checks are offline/filesystem-based by design, so they don't need harness internals). The repo-root `dsh-doctor.mjs` is a thin wrapper for `node dsh-doctor.mjs` compatibility.

## License

MIT
