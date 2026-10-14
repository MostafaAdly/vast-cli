# vast bar install: design

Date: 2026-10-14. Status: approved in chat by Mostafa.

## Intent

An engineer who installed the CLI can get Vast Bar with one command, without
Xcode, a clone of this repo, or an Apple Developer account — and keep it in step
with the CLI without thinking about it.

- **Who:** any Vast engineer on macOS who already runs `vast`.
- **Success:** `vast bar install` puts a working Vast Bar in Applications and
  opens it; `vast upgrade` keeps the app at the CLI's version; nobody sees a
  Gatekeeper warning.
- **Today:** the app is built from a clone with `apps/menubar/build.sh` and
  needs Xcode 16+. That path stays for development.

## Out of scope

Notarization, a Developer ID signature, a `.dmg`, Homebrew, auto-update from
inside the app, Windows/Linux (the command refuses there), a doctor check for
the app.

## The command

`vast bar` is a command group. macOS only: on any other platform each
subcommand exits 1 with "Vast Bar is a macOS app."

| Command | Does |
|---|---|
| `vast bar` | Reports: `Vast Bar <v> installed in <dir> · CLI <v>`; `not installed — run vast bar install`; or `Vast Bar <a> is older than the CLI (<b>) — run vast bar install`. Exit 0. |
| `vast bar install [--version <tag>]` | Installs, or replaces an installed copy with, the app matching the CLI's version, then opens it. |
| `vast bar uninstall [--purge]` | Quits the app and deletes it. `--purge` also deletes `~/Library/Application Support/Vast Bar/`. |

`vast bar install --if-installed` exists for `vast upgrade` (below): it does
nothing when the app is not installed, and reopens the app only if it was
running. It is listed in `--help` like any other option.

## Where the app comes from

The release workflow (`.github/workflows/release.yml`) becomes three jobs:

1. **cli** (`ubuntu-latest`, today's steps): tests, typecheck, bundle, verify the
   bundle runs, check the tag matches `package.json`. Uploads `vast.mjs` as a
   workflow artifact.
2. **app** (`macos-15`): `swift --version` (logged), `cd apps/menubar && swift
   test`, then `apps/menubar/build.sh --no-install --universal`, then
   `ditto -c -k --keepParent "apps/menubar/build/Vast Bar.app" VastBar.zip`.
   Verifies before uploading: `codesign --verify --deep --strict` passes,
   `lipo -archs` lists `x86_64 arm64`, and the bundle's
   `CFBundleShortVersionString` equals the tag without its `v`. Uploads
   `VastBar.zip` as a workflow artifact.
3. **publish** (`needs: [cli, app]`): downloads both artifacts and creates the
   release with `vast.mjs` and `VastBar.zip` (`fail_on_unmatched_files: true`).

A failure in either build job means no release, as today. The asset name
`VastBar.zip` is fixed like `vast.mjs`: never renamed in the workflow, the CLI,
or the docs.

### build.sh changes

- The app's `CFBundleShortVersionString` and `CFBundleVersion` come from the
  repo's `package.json` (`node -p "require('../../package.json').version"`), so
  app X.Y.Z always pairs with CLI X.Y.Z. A local dev build carries the same
  number.
- `--universal` builds `--arch arm64 --arch x86_64` (CI uses it; a local build
  stays native and fast).
- The app icon is already bundled (`Resources/AppIcon.icns`).

## What `vast bar install` does

1. **Version.** The CLI's own `VERSION`, or `--version <tag>` (with or without
   `v`). A version with a prerelease suffix (a local `2.9.0-dev`) has no release:
   exit 1 with "This CLI is a development build, so there is no released Vast Bar
   for it. Build it from the repo: apps/menubar/build.sh".
2. **Download** `https://github.com/MostafaAdly/vast-cli/releases/download/v<ver>/VastBar.zip`
   with `curl -fsSL` into a fresh temp directory (the installer's way; no auth
   needed, the repo is public). A 404 means that release predates the app: exit 1
   with "Release v<ver> has no Vast Bar (it shipped from 2.9.0). Run vast upgrade
   first."
3. **Unpack** with `ditto -x -k`, then **verify**: `Vast Bar.app/Contents/Info.plist`
   has `CFBundleIdentifier` `com.vastgroup.vastbar` and version `<ver>`, and
   `codesign --verify --deep --strict` passes. Anything else: exit 1, nothing
   touched.
4. **Where.** If the app is already installed (`/Applications/Vast Bar.app`, else
   `~/Applications/Vast Bar.app`), replace it there. Otherwise `/Applications` if
   writable, else `~/Applications` (created). Never `sudo`.
5. **Quit** a running copy: `osascript -e 'quit app id "com.vastgroup.vastbar"'`,
   then wait up to 5 s for the process to go.
6. **Replace** without a gap: move the old bundle into the temp dir, move the new
   one into place, then delete the old one. If the move-in fails, move the old
   one back.
7. **Clear** `com.apple.quarantine` recursively (`xattr -dr`), defensively.
8. **Open** it with `open`, except under `--if-installed` when it was not running.
   Print `Vast Bar <ver> installed in <dir>`.

All file and process steps go through an injected `BarDeps` (download, unpack,
plist read, codesign, exists, move, remove, quit, isRunning, open, platform,
writable), so the flow is unit-tested without touching the machine.

### Why there is no Gatekeeper warning

Gatekeeper only assesses files carrying `com.apple.quarantine`, which browsers
and other download-aware apps add. `curl` does not, and neither does `ditto`, so
an ad-hoc-signed universal app runs without a Developer ID. Install also clears
the attribute in case something added it. Risk: an org security tool (MDM, an
allow-list agent) can still block unsigned apps; that is outside the CLI's
control and the README says so.

## Keeping in step

- **`vast upgrade`:** after the installer succeeds, it runs the **new** CLI —
  `node <install home>/vast.mjs bar install --if-installed`, where the install home
  is `$VAST_CLI_HOME` or `~/.vast-cli` as in `install.sh` — so the app is fetched
  by the version that matches it. A failure there is printed as a warning and
  never fails the upgrade (the CLI is already updated).
- **Open at login:** the app's header power button becomes a `…` menu with
  "Open at login" (a checkmark, `SMAppService.mainApp` register/unregister,
  macOS 13+) and "Quit Vast Bar". The menu reads the current status each time it
  opens, so a change made in System Settings shows.

## Docs (same PR)

- README Install: after the CLI line, "On macOS, `vast bar install` adds the menu
  bar app." The Vast Bar "Setting it up" section leads with `vast bar install`;
  building from source moves to a "Building it yourself" note.
- README command table: a `vast bar` row.
- `skills/release/SKILL.md`: one line — `vast bar` exists and is never part of a
  release the skill runs.
- CLAUDE.md: the release workflow now has three jobs and two assets; `VastBar.zip`
  is never renamed; `--if-installed` is how upgrade keeps the app in step.
- Every documented command and flag checked against `node bin/vast.js bar --help`.

## Tests

- `tests/vast-bar.test.ts` (node:test, injected `BarDeps`, `VAST_CLI_HOME`
  sandbox): status lines (not installed / same / older); install happy path in
  order (download → unpack → verify → quit → move → clear → open); existing
  install replaced in its own directory; `~/Applications` fallback when
  `/Applications` is not writable; dev version refused before any download; 404
  message; wrong bundle id or version refused with nothing moved; failed move-in
  restores the old app; `--if-installed` no-op when absent and no reopen when it
  was not running; non-macOS refusal; uninstall with and without `--purge`.
- `tests/upgrade.test.ts`: upgrade calls the new CLI's `bar install
  --if-installed` after the installer, and a failure there is a warning with
  exit 0.
- App: none new beyond building; the login menu is checked by launching it.
- Live check before shipping: on this machine, uninstall the locally built app,
  run `vast bar install --version` against a test release (or a locally served
  zip via an env override `VAST_BAR_URL`, test-only and documented as such),
  confirm it opens with no Gatekeeper prompt and `xattr` shows no quarantine.

## Release

Ships with Phase 1 and the app as **2.9.0**: this work stacks on PR #45, so the
first release that contains the app also contains the way to install it.
