# Vast Bar: design

Date: 2026-10-11. Status: approved in chat by Mostafa, section by section.

## Intent

An always-visible macOS menu bar **release cockpit** for the nine releasable
repos. It tells Mostafa when something needs attention, and makes the safe next
step one click, always behind a preview. It is not a GUI re-implementation of
the CLI: `vast` stays the only place release logic lives.

- **Who:** Mostafa first. Nothing in it may depend on something only his
  machine has, so the team can install it later. Signing, notarization and an
  installer are a later phase, outside this spec.
- **Success:** he stops running `vast status` / `vast doctor` by hand to learn
  the state of things; problems that used to surface mid-release (version
  behind production, expired ArgoCD token, outdated CLI, failed doctor check)
  show on the icon first; a staging release or a production release PR starts
  from the menu bar with the same safety as the terminal.
- **v1 actions:** release to staging (one repo or a train) and promote to a
  production release/hotfix PR. Nothing else.

## Out of scope (v1)

The `vast pending` panel; one-click fix-it actions; any production deploy
button (production deploys stay blocked by `PRODUCTION_PIPELINE_READY`); logging
in to ArgoCD or Slack from the app; anything that writes CLI config; signing,
notarization, an installer, auto-update.

## Shape

Two parts, one brain.

| Part | Where | Job |
|---|---|---|
| CLI `--json` output | this repo, `src/` | machine-readable snapshots and a live event stream |
| Vast Bar app | this repo, `apps/menubar/` (Swift package) | run `vast`, read its JSON, draw it |

The app never decides anything a release depends on: versions, guards, what to
promote, whether to post. It shows what the CLI says and runs what the user
confirms.

## Phase 1: CLI machine-readable output

### Snapshots

One JSON document on stdout, nothing else; every other line (update hint,
spinners, warnings) goes to stderr. Exit codes unchanged.

**`vast status --json`** (`--all`, a repo name, `--no-fetch` as today):

```json
{
  "generatedAt": "2026-10-11T09:00:00.000Z",
  "repos": [
    {
      "repo": "VastPayPwaV2",
      "displayName": "Vastpay Pwa V2",
      "releaseTeam": "frontend",
      "staging": { "tag": "2.1.4-rc1", "problem": null },
      "production": { "tag": "2.1.17", "problem": null },
      "drift": { "text": "develop +10", "ahead": 10, "problem": null }
    }
  ]
}
```

A cell that cannot be read carries `tag: null` and `problem` with the same
wording the table prints (`not migrated`, `n/a`, `?`); drift's problem is
`not cloned`, `fetch failed`, `no develop` or `?`. The JSON is built from the
same `readTags` / `inspect` results the table uses.

**`vast doctor --json`**: the `Check[]` doctor already builds, as
`{ "generatedAt", "checks": [{ "group", "label", "status": "ok|warn|fail", "detail" }] }`.
Exit code as today.

**`vast pending --all --short --json`** already exists and is unchanged; the
app reads it only to count waiting PRs per repo.

### Event stream

`vast release … --json` and `vast promote --to production … --json` print one
JSON object per line (NDJSON), flushed as each happens. Every event carries
`"type"`, `"at"` (ISO time) and, where it applies, `"repo"`.

| `type` | Fields | Emitted when |
|---|---|---|
| `start` | `command`, `args`, `dryRun`, `repos` | once, first |
| `plan` | `repo`, `version`, `commits` (count), `promote` (`will merge` / `nothing to promote` / `no develop`), `notice` (guard notice or null), `ok`, `detail` | a repo's preparation finished (dry run and real run) |
| `promoted` | `repo`, `commits` | develop merged into staging |
| `dispatched` | `repo`, `version`, `runId`, `runUrl` | workflow started |
| `run` | `repo`, `status`, `conclusion`, `elapsedMs` | build status changed |
| `rollout` | `repo`, `state` (`waiting` / `<sync>/<health>` / `not confirmed`), `reason`, `elapsedMs` | ArgoCD state changed, or confirmation skipped (`disabled`, no token, sign-in wall) |
| `pr` | `repo`, `branch`, `url`, `version`, `slack` (`{ text, posted, error }` or null) | promote opened its PR (dry run: `url` null, `slack.posted` false) |
| `done` | `repo`, `version`, `status` (`released` / `skipped` / `failed`), `detail` | a repo finished; the same `DeployOutcome` the summary prints |
| `end` | `exitCode` | once, last |

Rules:

- **One source of truth.** Events are emitted from the same call sites that
  update the status board and print the summary, through an `EventSink`
  injected beside the board. In `--json` mode the board is a no-op and the
  sink writes NDJSON; otherwise the sink is a no-op. Text and JSON cannot
  disagree because they come from the same calls.
- `--json` never prompts. Anything that would ask the user (none today in
  release/promote; any added later) instead emits `done` with status `failed`
  and a detail naming the input it needed, and the CLI exits 1; the app then
  offers "Open in Terminal".
- The terminal bell is already TTY-only, so a file or pipe never gets it. The
  desktop notification from `done-notify` still fires: the CLI owns it, so a
  release still announces itself if the app quit.
- `--dry-run --json` is the preview: `start`, a `plan` per repo (and for
  promote, a `pr` with `url: null` and the Slack text), `end`.

### Tests (CLI)

node:test with the existing injected fakes and `VAST_CLI_HOME` sandbox:
exact JSON shape for `status --json` (including every problem cell) and
`doctor --json`; a fake release that emits
`start → plan → promoted → dispatched → run… → rollout… → done → end` in order;
a failed build, a guard refusal and an ArgoCD-disabled run each produce the
right `done`; a promote dry run produces `plan` + `pr` with the Slack preview
and posts nothing; stdout parses as pure JSON (NDJSON line by line) with an
update hint pending.

### Docs

README (each `--json`, the event table), SKILL.md (the skill may use
`status --json` / `doctor --json`), CLAUDE.md (the EventSink rule). Released as
a minor version; that version is the app's minimum.

## Phase 2: the app, read-only

### Project

- `apps/menubar/`, a Swift package: `VastBarCore` (library: models, parsing,
  state, process runner) and `VastBar` (SwiftUI app target). Apple frameworks
  only, no third-party packages; Swift 6, macOS 13+ (`MenuBarExtra`).
- `apps/menubar/build.sh` builds release, assembles `Vast Bar.app` with an
  `Info.plist` setting `LSUIElement` (no Dock icon), and copies it to
  `/Applications`. Ad-hoc signed for local use.
- The CLI's own build, tests and release are untouched; the app has its own
  `swift test`.

### Running `vast`

- GUI apps do not inherit the shell's PATH, so every command runs through the
  user's login shell: `/bin/zsh -lc 'vast … --json'`. That finds `vast`,
  `node`, `gh` and its auth exactly as the terminal does.
- On launch the app runs `vast --version`. Missing, or older than the minimum:
  the popover shows one card saying so, with "Copy `vast upgrade`".
- Arguments are passed as a fixed list built by the app (repo names come only
  from `status --json`), never interpolated from free text.

### What it shows

- **Icon:** the Vast mark with a state dot.
  - green: everything ok;
  - blue (animated): a release or promote is running;
  - amber: something needs attention — any repo whose next staging version is
    not above production, any doctor `warn`, a newer CLI, a cell that read `?`;
  - red: a doctor `fail` or a run whose last `done` was `failed`.
- **Popover:** a header with the overall state and last refresh; one card per
  repo (display name, staging → production versions, drift, waiting PR count,
  any problem in plain words); train buttons "Release frontend" / "Release
  backend"; a footer with doctor's warnings and fails, each with its detail.
- **Refresh:** on popover open and every 5 minutes: `status --json --all`,
  `doctor --json`, `pending --all --short --json`, run concurrently. A refresh
  that fails keeps the last good data and marks it stale.
- In Phase 2, release and promote buttons open Terminal with the exact
  command (`vast release VastPayPwa`), so the read-only app is useful on day
  one.

### State rules (tested in `VastBarCore`)

Icon state from (status, doctor, pending, running runs); per-repo badge;
"behind production" from doctor's per-repo version check; stale-data marking.

## Phase 3: the app's actions

### Release to staging

1. Click **Release** on a card (or a train button).
2. The app runs `vast release <repo|--frontend|--backend> --dry-run --json` and
   shows a sheet from the `plan` events: version, commits to promote, guard
   notice. A refused repo (`ok: false`) shows its detail and cannot be started;
   when the detail offers `--fix-version`, the sheet offers a toggle for it,
   which re-runs the dry run with the flag.
3. **Release** in the sheet runs the same command without `--dry-run`.

### Promote to production PR

1. **Promote…** on a card opens a sheet: release or hotfix (`--as`), and
   "Post to Slack" (off by default).
2. The app runs `vast promote <repo> --to production [--as hotfix] [--slack] --dry-run --json`
   and shows the `plan` and `pr` events: branch, version, and the exact Slack
   message.
3. **Open PR** runs it for real; the `pr` event's URL becomes a link on the
   card. The PR is never merged by the app, and nothing deploys production.

### Running and following a run

- The app starts the command as a detached process writing NDJSON to
  `~/Library/Application Support/Vast Bar/runs/<id>.ndjson` (stderr to
  `<id>.log`) and tails that file. Quitting the app does not stop the run.
- On launch the app reads unfinished run files (no `end` event, process still
  alive) and resumes showing them; finished ones older than 7 days are deleted.
- While a repo has a running run its Release and Promote buttons are disabled,
  and its card shows a progress row: promoting → building (elapsed) → rolling
  out → done, from `promoted` / `dispatched` / `run` / `rollout` / `done`.
- `end` with `exitCode ≠ 0` and no `done` means the CLI itself failed: the card
  shows the last stderr lines with "Copy command" and "Open in Terminal".

### Safety

The CLI's guards apply unchanged (dirty tree, conflicts, version guard,
`NEVER_PUSH`, production pipeline block, lock). Credentials never pass through
the app: ArgoCD login and Slack setup stay `vast argocd login` / `vast slack
setup` in a terminal; the app only says when they are needed. Every action is
preview-then-confirm; nothing runs on a single click.

### Tests (app)

`swift test` on `VastBarCore` with recorded JSON fixtures, never the real
`vast`: parsing every snapshot and event (and an unknown event type, which is
ignored); icon and card state; button disabling while a repo runs; resuming a
run from a partial NDJSON file; the "CLI failed" path. Views stay thin
(render computed state only) and are checked by building, launching and
screenshots.

### Live check before shipping

Phase 1: `status --json`, `doctor --json` against real repos; a release
`--dry-run --json` and promote `--dry-run --json` preview (no PR, no Slack).
Phase 3: the app's previews; one real staging release of a single repo
Mostafa picks; a promote preview only — no real PR or Slack post unless he
asks.

## Phases

1. CLI `--json` snapshots and event stream — released as a CLI minor version.
2. App, read-only — icon, cards, refresh, "Open in Terminal" actions.
3. App actions — release and promote with preview and live progress.

Each phase ships on its own.
