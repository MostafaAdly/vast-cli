# `vast pending`: design

Date: 2026-09-24. Status: approved in chat by Mostafa. Target release: 2.5.0.

## Why

Nobody can answer "what goes in the next release?" or "did that production hotfix
ever reach staging?" without clicking through GitHub. Comparing branches by commit
is useless here: on VastPayPwaV2 (2026-09-24) staging had 100 commits production
lacked and production had 69 staging lacked, almost all noise from merges, bumps
and cherry-picks. Compared by PR number the picture is clean: 30 PRs on staging
only, six of them already inside the open hotfix PR #334, and a handful of PRs
(#270, #325, #332, two cashback patches) that went straight to production.

## Command

```
vast pending [repositories...] [--to production|staging] [--parity]
             [--all | --frontend | --backend] [--by-ticket] [--short]
             [--markdown] [--slack] [--json] [--dir <path>]
```

| Pair | `--to` | Source → target |
|---|---|---|
| Release queue | `production` (default) | `origin/staging` → `origin/production` |
| Promotion queue | `staging` | `origin/<promoteFrom.staging>` (develop) → `origin/staging` |

- Default output: what is on the source and not on the target.
- `--parity`: also what is on the target and not on the source, so both
  differences are listed.
- Repos: names (any casing, resolved like every other command), `--all`,
  `--frontend`, `--backend`, selected exactly as `vast release` selects them.
- A repo with `promoteFrom.staging === null` (the two `*-BackEnd` repos) under
  `--to staging` gets a `no develop branch` line and is skipped, not failed.
- Read-only. It fetches, never checks out, merges, pushes or writes config.

## What each list means

| Direction | Meaning |
|---|---|
| staging, not production | the release queue |
| production, not staging | fixes that went straight to production; possibly never ported back |
| develop, not staging | what the next `vast promote` would carry |
| staging, not develop | hotfixes or direct staging commits that never reached develop |

Only the staging → production direction has an **In flight** section: PRs carried
by an open PR into `production` whose head is `release/*` or `hotfix/*`.
`--to staging` has none, because promote pushes to staging directly.

## Matching

Implemented in `src/utils/parity.ts`, git only, no network.

1. **Read both ranges.** `git log target..source` and `git log source..target`,
   every commit (not `--merges`), with hash, subject, committer date, and
   parent count.
2. **Classify each commit.**
   - A subject matching `Merge pull request #N from <owner>/<branch>` is a **PR
     unit**, whether it is a real merge or a cherry-picked merge (one parent,
     same subject). This is the same regex as `src/utils/shipped.ts`; it is
     moved into a shared helper rather than copied.
   - **Vehicles are dropped:** head branches `release/*`, `hotfix/*` and the
     existing `bump-(stage|prod)-*` rule. They carry other PRs; they are not work.
   - **Noise is dropped:** version bumps (`chore: bump version…`, the CI's
     `align`/bump subjects already filtered by `describe` in
     `src/utils/release-message.ts`, shared rather than copied) and commits that
     only touch `Helm/values-*.yaml` or `package.json`'s version line.
   - A non-merge commit that is not inside a PR unit on its side is a **direct
     commit**. Commits reachable only through a PR merge's second parent belong
     to that PR and are not listed separately.
   - Other merge commits (`Merge branch …`, `Merge remote-tracking branch …`)
     are dropped; their content surfaces through the commits they bring.
3. **Match PRs by number.** A PR number present on both sides is shared and
   listed on neither side.
4. **Check the rest by code content.** For each unmatched PR unit and direct
   commit, compute a stable patch-id (`git patch-id --stable`):
   - real merge `M`: the diff `M^1..M`;
   - cherry-picked merge or direct commit `C`: the diff `C^..C`.

   If an item's patch-id equals any unit's or direct commit's patch-id on the
   other side, it is **ported (same code)** and shown with that marker instead
   of as missing.
5. **Age.** Days since the item's commit landed on its side, from the
   committer date of the merge (or the commit) in that range. Over 14 days is
   **stale**.

**Stated limit:** a port-back that needed conflict fixes has different code and
a different patch-id. It is reported as `not found on <target>`, never as a
definite "missing", and the docs say why.

```ts
// src/utils/parity.ts
export interface PrUnit { number: number; branch: string; sha: string; landedAt: Date; patchId: string | null }
export interface DirectCommit { sha: string; subject: string; landedAt: Date; patchId: string | null }
export interface Side { prs: PrUnit[]; direct: DirectCommit[]; ported: Set<string> /* shas */ }
export interface Parity { source: string; target: string; onlySource: Side; onlyTarget: Side; sharedPrs: number[] }
export function compareBranches(dir: string, source: string, target: string): Parity;
```

## Enrichment

Done in `src/commands/pending.ts`, all injectable for tests.

- **PR details:** `shippedPrs` from `src/utils/shipped.ts` (title, url, branch,
  contributors with the existing exclusions), concurrently. A PR `gh` cannot
  read still appears with its number and the branch from its merge subject,
  marked `details unavailable`.
- **Tickets:** `extractTickets` from `src/utils/release-message.ts` over branch
  and title, so `VA-####` and `CU-…` link exactly as in the release announcement.
- **In flight** (`--to production` only): `gh pr list --repo <org>/<repo>
  --base production --state open --json number,headRefName,url`, heads
  `release/*` or `hotfix/*`; fetch each head and take `prNumbersInRange(dir,
  'origin/production', 'origin/<head>')`. Those PRs move from Waiting to In
  flight under the release PR's name.
- **Descriptions:** default is phrase plus title, `guest token reuse — Reuse
  guest tokens without overriding customer sessions`, phrases from
  `summarizePrs` in `src/utils/pr-summary.ts`, one model call per repo.
  `--short` shows only the tidied title and makes no model call. When `claude`
  is unavailable the report shows the title only rather than the rule-based
  phrase. `summarizePrs` gains a way to report that it fell back.
  `--slack` always uses the phrase, as the release announcement does.
- **Fetch:** every selected repo's source and target (plus open release heads)
  fetched concurrently, as `vast status` does. A repo that is not cloned or
  fails to fetch gets its own error line; the sweep continues.

## Output

Renderers in `src/utils/pending-report.ts` are pure: a report model in, a
string (or `{ text, blocks }`) out.

### Terminal (always)

```
  Pending
  VastPayPwaV2 | staging → production

  In flight · hotfix/2.1.15 (#334, open)
    #301  ELM single charge, Apple Pay layout — One create-charge per sheet, and stop Apple Pay covering the card CTA
          Mostafa Adly · 13d
    #313  guest token reuse — Reuse guest tokens without overriding customer sessions
          Osama Elshimy · VA-13091 · 9d

  Waiting (24)
    #298  … — …
          Osama Elshimy · 21d  ⚠ stale

  Direct commits (3)
    46d26d9  fix(pwa): preserve disabled plugin lifecycle · 3d

  30 PRs · 7 tickets · oldest 21 days
```

With `--parity`, after the above:

```
  On production, not on staging (5)
    #270  Include guest token in send-OTP request   ported (same code)
    #332  Raise pwa-v2 memory request               ⚠ not found on staging
```

- Items sort by PR number ascending, direct commits by date.
- `--by-ticket` regroups each section by ticket: one line per ticket with its
  PRs beneath, then an `Untracked` group for PRs without a ticket.
- A sweep (`--all`, `--frontend`, `--backend`, or several names) opens with a
  summary table (repo, waiting, in flight, target-only, oldest), then one
  section per repo. Repos with nothing pending collapse to `in sync`.

### `--markdown`

Printed after the terminal report, between clear start/end rules, ready to
paste into ClickUp docs or a PR. `##` per repo, `###` per section, list items
with the PR linked to GitHub and tickets linked to ClickUp.

### `--slack`

One message to the configured channel, same style as the release announcement:
one real `rich_text_list` bullet per repo, built on the same element helpers as
`src/utils/release-message.ts` (moved to a shared module, not copied):

`• <compare link|Vastpay Pwa V2 - staging → production> - phrase, phrase (@person, @person) (TICKET, TICKET)`

- The link is GitHub's compare view `target...source`.
- Only the source-not-target direction is posted; `--parity` does not add the
  reverse to Slack.
- Mentions resolve through `resolveMentions`; unconfigured Slack prints the
  message and `Slack not configured — run vast slack setup` and exits 1.
- A failed post prints the report, the message and the error, and exits 1:
  unlike promote, posting is the thing that was asked for.
- The release announcement's message contract is untouched.

### `--json`

The report model as JSON on stdout, with nothing else printed, for the
`/release` skill and scripts. Dates are ISO strings. `--json` replaces the
terminal and markdown output; combined with `--slack` it still posts, and any
Slack error goes to stderr so stdout stays valid JSON.

## Errors

| Case | Behaviour |
|---|---|
| Repo not cloned | `not cloned — vast clone` line, sweep continues, exit 1 at the end |
| Fetch fails | per-repo error line, sweep continues, exit 1 at the end |
| `--to staging` on a repo with no develop | `no develop branch`, skipped, exit 0 |
| `gh pr view` fails for one PR | PR shown with number and branch, `details unavailable` |
| `gh pr list` fails | report without In flight, one warning line |
| `claude` missing or answer rejected | titles only |
| Slack not configured or post fails | report still printed, exit 1 |

## Testing

node:test only, no network.

- `parity.ts` against real fixture repos (`git init`, a local bare origin):
  real `--no-ff` merges; a cherry-picked merge (`cherry-pick -m 1`) on the
  target; direct commits on each side; bump and Helm-only noise; a clean
  port-back (same patch-id) reported as ported; a conflict-resolved port-back
  reported as not found; release/hotfix vehicles dropped; a PR on both sides
  shared; ages from committer dates.
- `pending-report.ts`: exact terminal, markdown, Slack text and blocks, and
  JSON output for a fixed model, including `--by-ticket`, `--short`, the sweep
  table, `in sync`, and `details unavailable`.
- `pending.ts`: injected `gh`, summarizer, Slack and fetch fakes, covering
  repo selection, `--to staging` skipping BackEnd, in-flight regrouping, exit
  codes, and that `--json` prints only JSON.
- Config I/O under `VAST_CLI_HOME`, as everywhere.

## Docs

Same PR, verified against `node bin/vast.js pending --help`:

- `README.md`: new `vast pending` section with both pairs, `--parity`, outputs,
  and the conflict-resolved port-back limit.
- `skills/release/SKILL.md`: use `vast pending --json` to answer "what's
  waiting?" and before cutting a production PR; relay "not found on staging"
  items as needing a human check, not as confirmed missing.
- `CLAUDE.md`: a short `vast pending` section — PR-number matching, vehicles
  and noise filtered, patch-id as the second check, and its limit.

## Out of scope

Scheduling or automatic weekly posts, ClickUp status changes, and filtering by
author or date. Each can follow once the report proves useful.
