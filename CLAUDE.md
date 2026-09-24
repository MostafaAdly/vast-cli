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
the tag and `package.json` disagree, and attaches `vast.mjs` to a new release.

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

- Staging: `deployments/helm/staging/<app>/stage.yaml`, read at `main` through
  `gh api .../contents/<path>`. Production (not migrated yet):
  `deployments/helm/production/<RepoName>/prod.yaml`.
- The tag is `deployment.containers[0].image.tag` — the first `tag:` line in the
  file. `extractTag` in `src/utils/helm.ts` still parses it; the reader is
  `src/utils/deployments.ts`.
- **One pre-migration exception, and it is temporary.** `readTagAtRef` and
  `PRE_MIGRATION_PRODUCTION_HELM` in `src/utils/helm.ts`, and the `productionTag`
  fallback in `src/utils/deployments.ts`, read production's tag out of the app
  repo's `Helm/values-prod.yaml` on `origin/production` when Vast-deployments has
  no production file yet. They exist only because production is unmigrated:
  delete all three when `PRODUCTION_PIPELINE_READY` flips. Once Vast-deployments
  is authoritative, reading a local checkout instead is a quiet lie.
- The folder basename is also the ArgoCD application name, and it does **not**
  match the repo name: `VastPayPwa → vastpay-pwa`, `VastMenuPwa → pwa`,
  `VastMenuPwaV2 → pwav2`, `VastPay-DashBoard → vastpay-dasaboard` (their typo,
  upstream — never "fix" it).
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
- **Since 2026-09-21 the staging ArgoCD host sits behind an ALB Google sign-in
  (`authenticate-oidc`, vastgroupsa.com) that also covers `/api/*`**, so without a
  way past the wall the CLI cannot reach ArgoCD's API at all. The CLI detects it
  (`ArgoSsoWallError`) and degrades exactly like the no-token case: dispatch, tag
  committed, wait skipped, `tag committed — rollout not confirmed (ArgoCD API
  behind SSO)`.
- **The way past the wall is a cookie the user pastes, and nothing more.**
  `vast argocd login` asks for the ALB session cookie the user copies out of a
  signed-in browser; only `AWSELBAuthSessionCookie*` pairs are kept from what they
  paste, it is stored 0600 beside the token, sent on every ArgoCD request, and
  overridable with `VAST_ARGOCD_ALB_COOKIE_<ENV>`. It never goes through argv and
  is never logged. **Never read a browser's cookie jar and never automate the
  Google flow.** The cookie lasts about a week; when it expires the CLI hits the
  wall again and says `ArgoCD session cookie expired — run vast argocd login
  again`. The permanent fix is still DevOps exempting `/api/*` from the sign-in
  rule (ArgoCD's own login still protects it).
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
