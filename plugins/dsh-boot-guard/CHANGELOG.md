# Changelog

All notable changes to this project are recorded here.

## [1.1.2] - 2026-08-15

### Fixed

- Prevent the rescue console from appearing in healthy conversations merely because chat history quotes `Failed to load plugins`
- Require an exact loader-failure heading, loader-specific error details, and the absence of the normal DSH navigation/input shell before mounting
- Add browser-client regression coverage for healthy chats, real loader failures, and title-only false positives
- Add complete Chinese and English rescue-console copy that follows the language selected in DSH settings

## [1.1.1] - 2026-08-15

Safety and reliability fixes for configuration recovery.

### Fixed

- Normalize empty files, `[]`, and comment-plus-`[]` profiles before adding a skip so `cordis.patch.yml` remains one top-level YAML array
- Apply the same top-level-array validation to the local Windows installer and restore quoted guard IDs in the uninstaller
- Restore CRLF/BOM files and quoted plugin IDs correctly
- Fail closed into read-only mode when the active `dsh.profile` package cannot be located
- Replace permanent 500 ms DOM polling with a debounced `MutationObserver` bounded to the first 30 seconds
- Restrict mutation routes to loopback clients unless `DSH_BOOT_GUARD_ALLOW_REMOTE_MUTATION=1` is explicitly set
- Detect external patch changes immediately before atomic replacement and retry against the latest content

### Tests

- Added file-level mutation coverage for empty and existing arrays, existing disables, restore, concurrency, external writes, invalid YAML, invalid IDs, CRLF, and BOM

## [1.1.0] - 2026-08-15

First public-ready release.

### Added

- Loader-independent recovery console for the DSH failure page
- Automatic suspect detection from plugin loader errors
- Search and focused views for suspected, user, skipped, and all plugins
- Batch skip, per-plugin restore, confirmed restore-all, and diagnostic copy
- Read-only dark and light self-check pages plus a health endpoint
- Responsive layout, keyboard focus states, live status feedback, and reduced-motion support

### Changed

- Deduplicated repeated loader entry IDs before presenting them in the UI
- Separated Boot Guard-managed skips from entries disabled by normal configuration
- Limited each mutation request to 64 entries
- Made the Windows installer stage local dependencies beside the DSH profile to avoid cross-drive junction failures

### Safety

- Same-origin JSON-only mutation routes
- Validated body size and entry IDs
- Serialized, atomic patch writes
- Self-protection: Boot Guard refuses to disable itself
- Restore removes only blocks carrying a Boot Guard marker
