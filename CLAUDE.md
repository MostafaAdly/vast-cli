# CLAUDE.md

Guidance for Claude Code when working in this repository.

vast-cli is release tooling for Vast Group: TypeScript (strict, NodeNext ESM),
Commander, Node ≥ 18. It shells out to `git` and `gh` for everything — nothing
works without an authenticated `gh`.

## Hard rules

- **Docs ship with the change.** Any change to commands, flags, install or
  uninstall, config paths, or the release process updates `README.md` and
  `skills/release/SKILL.md` **in the same PR** — never as a follow-up. Before
  committing, verify every documented command and flag against the running CLI
  (`node bin/vast.js <cmd> --help`); do not document from memory. This repo's
  README drifted badly twice by skipping that check.
- **`dist/` is committed on purpose** — `bin/vast.js` loads from it so the CLI
  runs straight from a clone. Run `npm run build` before manually testing or
  you are testing stale code, and commit the rebuilt `dist/` with source changes.
  The `version` lifecycle hook rebuilds `dist/` too, so a tag never ships a
  stale dist.
- **`src/version.ts` is generated** from `package.json` by
  `scripts/sync-version.mjs`. Never hand-edit it; `npm version <level>`
  regenerates it, rebuilds `dist/`, and stages both via the `version` lifecycle
  hook.
- **The release bundle ships as `vast.mjs`, never `.js`.** Node 18 and 20 cannot
  detect ESM in a `.js` file and fail with "Cannot use import statement outside
  a module". Do not rename it anywhere: bundle script, workflow, installer.
- **No AI attribution in commit messages.** No `Co-Authored-By`, no
  "Generated with" lines.
- Relative imports carry a `.js` extension even though sources are `.ts`
  (NodeNext resolution).
- No new runtime dependencies without explicit approval from Mostafa.

## Commands

```bash
npm test           # node:test suite — must be green before every commit
npm run typecheck  # tsc --noEmit — same
npm run build      # regenerate src/version.ts, then tsc -> dist/
npm run bundle     # single-file build/vast.mjs, the release artifact
npm run dev        # run TypeScript directly via tsx
```

## Testing conventions

- All config I/O is sandboxed through `VAST_CLI_HOME`, set **before** importing
  the module under test — see `tests/production-lock.test.ts` for the pattern.
  A test must never touch the real `~/.vast-cli`; a crashed test could
  otherwise leave the real production lock lifted.
- Git behaviour is tested against real fixture repos built with `git init`
  (and a local bare repo when a real `origin` is needed) — not mocks.
- `vast init` tests run against an empty `HOME` (see `runInit` in
  `tests/init.test.ts`): every scan sweeps the default roots, so fixtures using
  real Vast origins would otherwise collide with genuine checkouts on the
  developer's machine.
- `git log --merges` matches on parent count, not subject text — fixtures that
  need merge commits must create real ones (`git merge --no-ff`), not
  `--allow-empty` commits that merely look like merges.
- A bare number is a PR number by design, so a test that shortens a fixture SHA
  must cut it where it still contains a letter (see `shortShaWithLetter` in
  `tests/picks.test.ts`). An 8-char prefix is all digits about once in forty
  runs, and that was the suite's one flake until 2.2.2.

## Releasing this CLI

```bash
npm version <patch|minor|major> && git push --follow-tags
```

CI then runs the suite and typecheck, verifies the bundle executes, refuses if
the tag and `package.json` disagree, and attaches `vast.mjs` and `VastBar.zip`
to a new release. The workflow has three jobs: `cli` (Ubuntu), `app` (macOS 15)
and `publish`, which needs both. `VastBar.zip` is never renamed, like `vast.mjs`.
The app's version comes from `package.json`, so a tag/plist mismatch fails the
`app` job.

- GitHub's releases API caches "latest" for ~60 seconds — `vast upgrade`
  immediately after publishing may install the previous version. Wait it out.
- `install.sh` is served from `main`, not from a release: installer fixes take
  effect without a version bump once the raw CDN cache expires.
- When watching a release run, select it by tag
  (`gh run list --json headBranch` filtered to the tag) — `--limit 1` races the
  trigger and returns the previous run.

## The /release skill

`skills/release/` is the source of truth. Users install it by downloading raw
files, so installed copies under `~/.claude/skills/` are snapshots — edit the
repo copy, and users re-download to update. Its helper's tests live in
`tests/notes.test.ts`. The skill must never reference private paths
(`vast-routines`, personal tokens); it once did and was unusable by anyone else.

## The deploy pipeline (staging is GitOps)

Nothing reads Helm values out of the app repos any more. The deployed tag lives
in `Vast-deployments`:

- Staging: `deployments/helm/staging/<app>/stage.yaml`; production:
  `deployments/helm/production/<app>/prod.yaml`. Both read at `main` through
  `gh api .../contents/<path>`. DevOps created every production file on
  2026-09-23 and the pipelines have committed production tags since 2026-09-28,
  so production's tag is read from Vast-deployments too — only the production
  DEPLOY is still blocked (`PRODUCTION_PIPELINE_READY`).
- The tag is `deployment.containers[0].image.tag` — the first `tag:` line in the
  file. `extractTag` in `src/utils/helm.ts` still parses it; the reader is
  `src/utils/deployments.ts`.
- **Nothing reads an app repo's `Helm/` directory.** Its values stopped moving
  when the pipelines took over (on 2026-10-01 VastMenuPwaV2's said 2.0.11 while
  Vast-deployments said 2.0.19). The last reader, a production fallback to
  `Helm/values-prod.yaml` on `origin/production`, was removed in 2.8.1 at
  Mostafa's request: a missing production file now reads `not migrated` in
  `status` and is an error everywhere else. Do not bring a Helm reader back.
- The folder basename is also the ArgoCD application name, and it does **not**
  match the repo name: `VastPayPwa → vastpay-pwa`, `VastMenuPwa → pwa`,
  `VastMenuPwaV2 → pwav2`, `VastPay-DashBoard → vastpay-dasaboard` (their typo,
  upstream — never "fix" it). Production's folders mostly match staging's, but
  two do not: `VastPay-DashBoard → vastpay-dashboard` (spelled right there) and
  `VastMenuPwaV2 → pwa-v2`. They are listed per repo in `src/config/repos.ts`.
- Each repo dispatches its own `<Repo> Pipeline` workflow, one `version` input, on
  the env branch. It is dispatched **by file**, `build-deploy.yml`: DevOps
  renamed every workflow from `build-deploy` to `<Repo> Pipeline` on 2026-09-24
  and the old name stopped resolving, which broke every deploy until 2.6.1.
  Never dispatch by display name. It builds the image and commits the tag to `Vast-deployments`;
  ArgoCD syncs from there. The CLI asks ArgoCD to refresh the app as soon as the run is green, so the usual ~3 minute git poll is skipped and the wait is the rollout itself. There are no bump PRs.
- The concurrent sweep is proven, not theoretical: a full six-repo
  `vast release --frontend` on 2026-09-17 (2.0.1) shipped every repo through
  `build-deploy` and ArgoCD with no lost tag commit. The private update-helm
  action still pushes to Vast-deployments `main` with no visible retry, so two
  builds finishing together *could* race; it has not happened yet, and the CLI
  reports it as `failed committing the tag — image may already be built` if it
  does (re-run that repo with the same version).
- A deploy is not done when the workflow goes green — that only means the tag was
  committed. It is done when ArgoCD reports `Synced/Healthy` on an image carrying
  the tag. Ceiling 15 minutes (a VastPayPwa rollout took 10m20s on 2026-09-17). Without a stored token the deploy is **not**
  refused: it dispatches, skips the ArgoCD wait, and reports `tag committed —
  rollout not confirmed`. An *expired* token still stops it in front of the build,
  because the pre-dispatch read fails.
- **From 2026-09-21 to 2026-10-01 the staging ArgoCD host sat behind an ALB
  Google sign-in that also covered `/api/*`.** It is gone: `vast argocd login` is
  username and password only. 2.1–2.7 bridged it with a pasted
  `AWSELBAuthSessionCookie`; 2.8.0 removed that bridge entirely (no prompt, no
  stored cookie, no `VAST_ARGOCD_ALB_COOKIE_<ENV>`), and a fresh login rewrites
  old token files without the cookie. **Do not bring a cookie bridge back, never
  read a browser's cookie jar, and never automate a Google flow.** What stays is
  the detector: `argoRequest` treats a redirect or an HTML answer as
  `ArgoSsoWallError`, and `deployOne` degrades exactly like the no-token case —
  dispatch, tag committed, wait skipped, `tag committed — rollout not confirmed
  (ArgoCD API behind a sign-in)` — so a returning wall can never turn a good
  build into a false failure. The fix for a returning wall is DevOps', keeping
  `/api/*` outside the rule.
- `vast argocd disable [--to env]` writes `~/.vast-cli/argocd/<env>.disabled`, and
  `deployOne` then makes no ArgoCD call at all (no snapshot, refresh or wait) and
  reports `rollout not confirmed (ArgoCD disabled)`. It is a separate marker, not a
  field in the token file, so `logout` cannot silently re-enable it. `enable`
  removes it.
- `vast argocd login` stores a session token in `~/.vast-cli/argocd/<env>.json`,
  mode 0600, never a password. `VAST_ARGOCD_TOKEN_<ENV>` overrides it. Tests must
  keep this under `VAST_CLI_HOME` like every other config path.

## vast pending

- Read-only report of what one branch has that the next lacks: `--to production`
  (default) is staging vs production, `--to staging` is develop vs staging;
  `--parity` adds the reverse. The two `*-BackEnd` repos have no develop and are
  skipped under `--to staging`.
- Compared **by PR number** from `Merge pull request #N` subjects on every commit
  (`src/utils/parity.ts`), never by commit: a `--pick` hotfix carries PRs as
  cherry-picked merges. Vehicles (`release/*`, `hotfix/*`, `bump-stage-*`/
  `bump-prod-*`, and branch syncs whose head is exactly `develop`/`staging`/
  `production`/`main`/`master`) and bookkeeping (version bumps, Helm-values-only
  and package.json-version-only commits) are dropped. The rules live in
  `src/utils/pr-subject.ts`, shared with the release announcement.
- Items left on one side get three code checks, all reading `ported (same
  code)`: patch-id against the other side's leftovers; patch-id against the
  other branch's history (only commits sharing an author time, which
  cherry-picks keep; `--binary` like the item patch-ids); and containment (the
  item's diff reverse-applies with `git apply --cached --check -R` to a temp
  index of the other branch's tip). Containment is what catches a multi-commit
  PR ported commit by commit. Limits, in the wording on purpose: a history match
  proves the change was applied once, not that it survives (a later revert still
  reads ported); a conflict-resolved port, or a change the other branch modified
  further, reads `not found on <branch>`, never "missing".
- PRs inside an open release/hotfix PR are **In flight** and never `stale`. A
  forward direct commit whose change an open release/hotfix branch carries (the
  same containment test against `origin/<head>`) is marked `in flight ·
  <branch> (#N)` instead of stale. A PR or commit in several open release PRs is
  claimed by the newest.
- Source and target are fetched strictly (both or the repo errors); open release
  heads are best effort, and a head that fails only drops out of In flight.
- Speed matters here: PR details come from one `gh api graphql` call per 50 PRs
  (`ghPrLookupMany`, same contributor rules as `parseGhPrView`), and the model
  runs async, 40 PRs per call, with `MAX_THINKING_TOKENS=0`. Do not reintroduce a
  per-PR `gh pr view`, or a synchronous gh/claude call, in this path.
- `--slack` posts the forward direction only, one bullet per repo in the
  announcement's shape (`src/utils/slack-rich-text.ts`), and exits 1 if it
  cannot post. Never run it live while developing: `~/.vast-cli/slack.json`
  exists and it would post to the team channel.

## Several repos in one release

- `vast release` with several repos is all or nothing (`releaseMany`): every repo is
  checked first (version guard, plus a trial promotion when more than one repo is
  named), and one refusal stops the run before anything is promoted or deployed. A
  sweep's not-cloned skip is not a refusal. Once deploys start, each repo stands alone.
  Mostafa chose this on 2026-10-14 after a three-repo release quietly shipped two.
- Tests of `releaseMany` must pass both `check` and `promote` fakes: a missing one
  falls through to the real `checkOne`/`promoteOne`, which read Vast-deployments and
  can merge and push in a real checkout.

## Machine-readable output (--json)

- `status --json` and `doctor --json` print one JSON document; `release --json` and
  `promote --json` stream NDJSON events (`src/utils/events.ts`) for the Vast Bar menu
  bar app (`docs/superpowers/specs/2026-10-11-vast-bar-design.md`). Stdout carries only
  JSON: `routeHumanOutputToStderr()` (`src/utils/json-mode.ts`) moves every human line
  to stderr at the command boundary, the board writes to stderr, and so do the update
  hint, `--verbose`'s banner and the done bell.
- Events come from the same call sites that update the board and build outcomes,
  through an `EventSink` (a no-op without --json; `guardedSink` so a broken stdout never
  costs a release). Never add a second code path that reconstructs events from text,
  and never write to stdout from command code except through the sink.
- Every repo in a stream gets a `plan` and a `done`, including one refused before
  deploying or one whose preparation throws; `streamToEnd` makes `end` (with the exit
  code) the last line even on a throw. Vast Bar relies on both to tell "finished" from
  "still running". The promote stream reads `plan.ok`/`done` from the `PromotionReport`,
  not from promote's boolean — a dry run that would conflict exits 0 but reports
  `ok: false`.
- Exit codes are the same with and without `--json`. `--json` never prompts; anything
  added later that would ask must instead fail that repo with a detail naming the input.

## Vast Bar (apps/menubar)

- A Swift package, Apple frameworks only, macOS 13+. `VastBarCore` holds every rule
  (parsing, run summaries, icon/card state, command building, quoting, the run store) and
  is tested with `cd apps/menubar && swift test` against **synthetic** fixtures — never
  paste real CLI output into them (it carries real names and emails; the repo is public).
  `VastBar` is thin SwiftUI that renders Core's state. `apps/menubar/build.sh` builds,
  ad-hoc signs and installs to /Applications (`--no-install` to only build).
- `vast bar install` (`src/commands/bar.ts`, `src/utils/vast-bar.ts`) downloads the
  release's `VastBar.zip` with curl (so it is not quarantined), verifies bundle id,
  version and signature before touching anything, and swaps it in place; the old copy
  comes back if the swap fails. The new app is staged inside the install folder
  (`.Vast Bar.new.app`) so the swap is same-folder renames, never a copy; an unwritable
  folder is refused before the app is quit, and an app that will not quit is never
  swapped or removed. A failed restore keeps `.Vast Bar.previous.app` and names it.
  Whether to restore is decided by a `movedAside` flag this run sets, never by
  `exists(previous)`: a leftover previous copy is removed before anything is quit, and
  one that cannot be removed refuses the install. Removing it after a good swap, and the
  temp-dir cleanup, are best effort (a leftover is a printed warning, never a failure).
  A lone `.Vast Bar.previous.app` (an interrupted swap) is the user's only copy: it shows
  in `vast bar`, and the next install renames it back to `Vast Bar.app` before anything
  else (refusing if it can't), so it is never deleted. `vast upgrade` runs the new CLI's `bar install --if-installed`
  only when an app exists in /Applications or ~/Applications; that is a no-op when the
  app is already at the version, and a failure there only warns. `VAST_BAR_URL`
  overrides the download URL for live checks only — never document it for users.
- The app never decides anything a release depends on: it runs `vast … --json` through
  `/bin/zsh -lc` and shows what the CLI says. Every command line comes from `Commands`
  (quoted with `shellQuote`); repo names come only from `status --json`.
- Safety it must keep: every action is preview-then-confirm, and the confirm runs
  `preview.command.withoutDryRun` — never a command rebuilt from the toggles. A repo with
  a running (or unclear, pid `-1`) run cannot be started again. "Open dry run in Terminal"
  uses `safeTerminalLine` (dry run, never `--slack`). No production deploy, no merge, no
  credentials in the app.
- The app's minimum CLI is 2.9.0 (`CLICompat.minimum`); the event shapes it decodes are
  `src/utils/events.ts` — change both together.
- Staging health is the one thing the app checks itself: plain GETs to the two backends'
  `/health` (hosts from Vast-deployments' staging `stage.yaml`), listed once in
  `StagingHealth.endpoints`. A down backend is amber, never red.
- The look has one rule Mostafa asked for: surfaces stay neutral, colour only as accents
  and same-hue tints, one filled button per screen. Colours live in `Theme.swift` only.
  Any scrollable area uses `CappedScroll` — a bare `ScrollView` collapses to zero height
  in the menu bar window (it shipped blank once).
- The app icon and the menu bar mark are one drawing, `VastMark.swift`, traced from the
  brand logo (vastgroup-web-v2 `public/vastgroup-logo-white.svg`). `Resources/AppIcon.icns`
  is generated and committed; change the mark, then run `apps/menubar/scripts/make-icon.sh`.

## Slack announcements

- `vast promote --to production --slack` posts one message after the release PR
  opens. Staging never posts, and without `--slack` nothing is posted.
- The bot token and channel live in `~/.vast-cli/slack.json`, mode 0600, written
  by `vast slack setup`; `VAST_SLACK_TOKEN` and `VAST_SLACK_CHANNEL` override it.
  Keep it under `VAST_CLI_HOME` in tests like every other config path. Never ask
  for or log the token.
- Scopes the Slack app needs: `chat:write`, `users:read`, `users:read.email`,
  `channels:read`, `groups:read`, `channels:join`, plus `im:read`/`im:write` only for a
  direct-message target (a `D…` id). The bot must be in the channel;
  setup joins public ones itself and cannot join a private one.
- The ClickUp workspace id is a constant — tickets link to
  `https://app.clickup.com/t/90121402342/<id>`. Do not inline it a second time.
- **The message shape is a contract with the team's channel**, not a formatting
  detail: it is Mostafa's own hand-written post,
  `• <PR link|Display Name - branch> - summary, summary (@person, @person) (TICKET, TICKET)`,
  posted as a real Slack `rich_text_list` bullet (with a mrkdwn `text` fallback),
  summaries and tickets in ascending PR number order. Its builder
  (`src/utils/release-message.ts`) is pure — PRs, summaries and resolved mentions
  in, `{ text, blocks }` out, no network — and tested against that exact post.
  Change the shape only with Mostafa, and change it in the tests first.
- People named are PR authors plus commit authors, merged per person. The people
  never named live in `EXCLUDED_CONTRIBUTORS` in `src/utils/contributors.ts`,
  beside its bot rules — nowhere else.
- Per-PR summaries come from the local `claude` CLI, summarize-style
  (`src/utils/pr-summary.ts`), screened like `--summarize` output, with a
  deterministic rule-based fallback when `claude` is missing or its answer fails
  screening. The announcement never depends on a model being available.
- A Slack failure never fails the promote: the PR is already open, so the message
  and the error are printed and the exit code stays 0.
- Repo display names come from the config (`displayName`) — Vastmenu Dashboard,
  Vastmenu Pwa V2, Vastpay Pwa — not from the repo name, and not from the ArgoCD
  app name either. That is a third naming axis; do not derive one from another.

## Gotchas

- VastPayPwa's seed tag in `Vast-deployments` is `5.0.1`, left by a DevOps test
  deploy, while its real series was `1.5.6-rc7`. Version derivation will happily
  continue from `5.0.1`. That is a human decision, not something to paper over in
  code — ask Mostafa before releasing that repo.

## Safety invariants — do not weaken

- The CLI never pushes to `production`, `prod`, `main`, or `master`
  (`NEVER_PUSH` in `src/utils/git.ts`), independent of any other setting.
- Production deploys are hard-blocked by `PRODUCTION_PIPELINE_READY` in
  `src/config/production-lock.ts` until DevOps migrates production; do not flip
  it without verifying the production workflow inputs and the production folder
  names with DevOps. `vast production enable` refuses while it is false.
- Production deploys are locked by default (`src/config/production-lock.ts`).
  Preparing a release/hotfix PR is deliberately never gated by the lock, nor by
  the pipeline block.
- `promote` refuses on dirty working trees and real conflicts. The single
  auto-resolved conflict is `package.json`'s version line, which CI rewrites
  per-branch on every deploy; anything else refuses.
- `--pick` only accepts commits already reachable from `origin/staging` —
  production never receives changes QC could not have seen. The single, loudly
  warned exception: a branch pick whose branch was cut from production (a true
  emergency fix) is genuinely merged, and the user is reminded to port it back.
- The deploy gate requires `release/<v>` or `hotfix/<v>` to be an ancestor of
  `origin/production`: a human must have merged this version's PR.
