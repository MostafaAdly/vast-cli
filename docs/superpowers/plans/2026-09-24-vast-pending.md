# `vast pending` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only `vast pending` command that lists, by PR, what one branch has that the next lacks (staging vs production by default, develop vs staging with `--to staging`), optionally both ways, rendered to the terminal, markdown, Slack, or JSON.

**Architecture:** `src/utils/parity.ts` compares two refs with local git only (PR numbers read from commit subjects, vehicles and noise dropped, patch-id as a second check). `src/utils/pending-report.ts` turns a comparison plus PR details into a report model and renders it; `src/utils/pending-slack.ts` builds the Slack message on helpers extracted from the release announcement. `src/commands/pending.ts` gathers everything with injectable deps and returns an exit code.

**Tech Stack:** TypeScript strict, NodeNext ESM (relative imports end in `.js`), Commander, node:test via `node --import tsx --test`, `git` and `gh` subprocesses, Node ≥ 18 global `fetch`.

**Spec:** `docs/superpowers/specs/2026-09-24-vast-pending-design.md`

## Global Constraints

- No new runtime dependencies.
- Relative imports carry a `.js` extension.
- `npm test` and `npm run typecheck` green before every commit.
- Commit messages: no `Co-Authored-By`, no "Generated with" lines, no AI attribution of any kind.
- Tests never touch the real `~/.vast-cli`: set `VAST_CLI_HOME` to a temp dir **before** importing any module that reads config.
- Git behaviour is tested against real fixture repos (`git init`, real `git merge --no-ff`), never mocks.
- `--slack` is never run live during development: `~/.vast-cli/slack.json` exists on this machine and would post to the team channel. Slack is exercised only through injected fakes.
- The release announcement's output (`buildReleaseMessage`) must stay byte-identical; `tests/release-message.test.ts` is the guard and must pass unmodified.
- Stale threshold: **more than 14 days**. Default `--to`: **production**.
- Work happens on branch `feat/vast-pending` (already created; the spec is committed there).

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/utils/pr-subject.ts` | create | Parse `Merge pull request #N from owner/branch`; vehicle, bump and pipeline-noise rules. Shared by announcement and pending. |
| `src/utils/shipped.ts` | modify | Use `pr-subject.ts` instead of its private regexes. |
| `src/utils/changelog.ts` | modify | Use the shared `isPipelineNoise`. |
| `src/utils/parity.ts` | create | `compareBranches(dir, source, target)`: git-only comparison. |
| `src/utils/pr-summary.ts` | modify | Add `modelPhrases` (model output only, no fallback); `summarizePrs` built on it. |
| `src/utils/slack-rich-text.ts` | create | The team's bullet shape (`bullet`, `bulletBlocks`), mrkdwn escaping, `Person`. |
| `src/utils/release-message.ts` | modify | Build on `slack-rich-text.ts`; export `namedPeople`; shared noise rule. |
| `src/utils/pending-report.ts` | create | Report model, `buildDirection`, terminal/markdown/JSON renderers. |
| `src/utils/pending-slack.ts` | create | `buildPendingSlack`, `pendingContributors`. |
| `src/commands/pending.ts` | create | Command wiring, `runPending`, `registerPendingCommand`. |
| `src/cli.ts`, `src/utils/help.ts` | modify | Register the command; list it in root help. |
| `tests/pr-subject.test.ts`, `tests/parity.test.ts`, `tests/slack-rich-text.test.ts`, `tests/pending-report.test.ts`, `tests/pending-slack.test.ts`, `tests/pending.test.ts` | create | Tests per unit. |
| `tests/pr-summary.test.ts`, `tests/help.test.ts` | modify | New cases. |
| `README.md`, `skills/release/SKILL.md`, `CLAUDE.md` | modify | Docs in the same PR. |
| `dist/` | rebuild | Committed build output. |

---

### Task 1: Shared PR-subject rules

**Files:**
- Create: `src/utils/pr-subject.ts`
- Modify: `src/utils/shipped.ts` (lines 47-60: `MERGE_SUBJECT`, `BUMP_BRANCH`, `prNumberOfSubject`)
- Modify: `src/utils/changelog.ts` (lines 30-40: private `isPipelineNoise`)
- Modify: `src/utils/release-message.ts` (lines 62-73: private `isPipelineNoise`)
- Test: `tests/pr-subject.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export interface PrSubject { number: number; branch: string } // branch without owner
  export function parsePrSubject(subject: string): PrSubject | null;
  export function isBumpBranch(branch: string): boolean;
  export function isVehicleBranch(branch: string): boolean;
  export function isPipelineNoise(subject: string): boolean;
  ```

- [ ] **Step 1: Write the failing test** — create `tests/pr-subject.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBumpBranch, isPipelineNoise, isVehicleBranch, parsePrSubject } from '../src/utils/pr-subject.js';

test('a PR merge subject gives the number and the branch without its owner', () => {
  assert.deepEqual(parsePrSubject('Merge pull request #328 from Vast-Menu/refactor/rely-on-code'), {
    number: 328,
    branch: 'refactor/rely-on-code',
  });
});

test('a subject with no owner keeps the whole branch', () => {
  assert.deepEqual(parsePrSubject('Merge pull request #5 from feature'), { number: 5, branch: 'feature' });
});

test('anything that is not a PR merge subject is not a PR', () => {
  assert.equal(parsePrSubject('fix: detect cancelled orders'), null);
  assert.equal(parsePrSubject("Merge branch 'develop' into staging"), null);
});

test('the CI bump branches are bumps', () => {
  assert.equal(isBumpBranch('bump-stage-1.0.0-rc1'), true);
  assert.equal(isBumpBranch('bump-prod-2.1.14'), true);
  assert.equal(isBumpBranch('fix/bump-stage-typo'), false);
});

test('release, hotfix and bump PRs are vehicles; work branches are not', () => {
  assert.equal(isVehicleBranch('release/2.1.10'), true);
  assert.equal(isVehicleBranch('hotfix/2.1.15'), true);
  assert.equal(isVehicleBranch('bump-prod-2.1.14'), true);
  assert.equal(isVehicleBranch('feat/x'), false);
  assert.equal(isVehicleBranch('fix/release-notes'), false);
});

test('CI bookkeeping and merge subjects are pipeline noise', () => {
  assert.equal(isPipelineNoise('chore: bump version to 2.1.14'), true);
  assert.equal(isPipelineNoise('chore: align package.json version'), true);
  assert.equal(isPipelineNoise("Merge branch 'develop' into staging"), true);
  assert.equal(isPipelineNoise("Merge remote-tracking branch 'origin/develop'"), true);
  assert.equal(isPipelineNoise('Merge pull request #1 from Vast-Menu/x'), true);
  assert.equal(isPipelineNoise('fix(pwa): preserve disabled plugin lifecycle'), false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import tsx --test tests/pr-subject.test.ts`
Expected: FAIL, cannot find module `../src/utils/pr-subject.js`.

- [ ] **Step 3: Implement** — create `src/utils/pr-subject.ts`:

```ts
/**
 * What a commit subject says about the PR it came from.
 *
 * GitHub writes "Merge pull request #N from owner/branch" on every PR merge,
 * and a `--pick` hotfix keeps that subject on its cherry-picked copy, so the
 * subject is the one handle a PR keeps on every branch it reaches. The release
 * announcement and `vast pending` both read it here, so they can never
 * disagree on what counts as a PR or as pipeline noise.
 */

const MERGE_SUBJECT = /^Merge pull request #(\d+) from (\S+)/;

export interface PrSubject {
  number: number;
  /** The head branch without its owner: "feat/x", not "Vast-Menu/feat/x". */
  branch: string;
}

export function parsePrSubject(subject: string): PrSubject | null {
  const m = MERGE_SUBJECT.exec(subject.trim());
  if (!m) return null;
  const slash = m[2].indexOf('/');
  return { number: Number(m[1]), branch: slash === -1 ? m[2] : m[2].slice(slash + 1) };
}

/**
 * The CI opens its own PRs to rewrite package.json's version on each branch.
 * They describe the pipeline, not the product.
 */
export function isBumpBranch(branch: string): boolean {
  return /^bump-(stage|prod)-/.test(branch);
}

/**
 * PRs that carry other PRs rather than work of their own: release and hotfix
 * PRs into production, and the CI's bumps. Listing them would count every
 * change twice.
 */
export function isVehicleBranch(branch: string): boolean {
  return isBumpBranch(branch) || /^(release|hotfix)\//.test(branch);
}

/**
 * Deploy bookkeeping the CI writes on every release, and merge subjects, which
 * describe how changes moved rather than what they are.
 */
export function isPipelineNoise(subject: string): boolean {
  const s = subject.trim();
  return (
    /^chore:\s*bump version to /i.test(s) ||
    /^chore:\s*align package\.json version/i.test(s) ||
    /^Merge (branch|remote-tracking branch|pull request)/i.test(s)
  );
}
```

- [ ] **Step 4: Point the three existing users at it**

In `src/utils/shipped.ts`, delete the `MERGE_SUBJECT` and `BUMP_BRANCH` constants with their comments, add the import, and replace `prNumberOfSubject`:

```ts
import { isBumpBranch, parsePrSubject } from './pr-subject.js';

function prNumberOfSubject(subject: string): number | null {
  const pr = parsePrSubject(subject);
  // The CI's own bump PRs describe the pipeline, not the product — the same
  // exclusion notes.sh makes.
  if (!pr || isBumpBranch(pr.branch)) return null;
  return pr.number;
}
```

In `src/utils/changelog.ts`, delete the private `isPipelineNoise` function and its comment, and add `import { isPipelineNoise } from './pr-subject.js';`.

In `src/utils/release-message.ts`, delete the private `isPipelineNoise` function and its comment, and add `import { isPipelineNoise } from './pr-subject.js';`.

Run: `grep -n "MERGE_SUBJECT\|BUMP_BRANCH\|function isPipelineNoise" src -r`
Expected: only `src/utils/pr-subject.ts` lines.

- [ ] **Step 5: Run the whole suite and typecheck**

Run: `npm test 2>&1 | grep -E "^# (pass|fail)" && npm run typecheck`
Expected: `# fail 0`, typecheck clean. (`tests/shipped.test.ts`, `tests/changelog*.test.ts` and `tests/release-message.test.ts` prove behaviour is unchanged.)

- [ ] **Step 6: Commit**

```bash
git add src/utils/pr-subject.ts src/utils/shipped.ts src/utils/changelog.ts src/utils/release-message.ts tests/pr-subject.test.ts
git commit -m "refactor: share PR-subject, vehicle and noise rules"
```

---

### Task 2: Branch comparison (`parity.ts`)

**Files:**
- Create: `src/utils/parity.ts`
- Test: `tests/parity.test.ts`

**Interfaces:**
- Consumes: `parsePrSubject`, `isVehicleBranch`, `isPipelineNoise` from Task 1.
- Produces:
  ```ts
  export interface PrUnit { number: number; branch: string; sha: string; landedAt: Date; patchId: string | null }
  export interface DirectCommit { sha: string; subject: string; landedAt: Date; patchId: string | null }
  export interface Side { prs: PrUnit[]; direct: DirectCommit[]; ported: Set<string> }
  export interface Parity { source: string; target: string; onlySource: Side; onlyTarget: Side; sharedPrs: number[] }
  export function compareBranches(dir: string, source: string, target: string): Parity; // throws on a bad ref
  ```

- [ ] **Step 1: Write the failing tests** — create `tests/parity.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareBranches } from '../src/utils/parity.js';

/**
 * Real repos with real merges: PR membership, cherry-picked merges and
 * patch-ids are all properties of the commit graph, so a mock would test
 * nothing.
 */
function repo(): { dir: string; git: (...args: string[]) => string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'vast-parity-'));
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: 'pipe' }).trim();
  git('init', '-q', '-b', 'production');
  git('config', 'user.email', 't@e.com');
  git('config', 'user.name', 'T');
  writeFileSync(join(dir, 'f.txt'), 'base\n');
  writeFileSync(join(dir, 'package.json'), '{\n  "name": "x",\n  "version": "1.0.0"\n}\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  return { dir, git, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function write(dir: string, file: string, content: string): void {
  mkdirSync(join(dir, file, '..'), { recursive: true });
  writeFileSync(join(dir, file), content);
}

/** Commit one file on a new branch off `onto`, merge it back --no-ff; returns the branch tip. */
function mergePr(
  r: ReturnType<typeof repo>,
  onto: string,
  number: number,
  branch: string,
  file: string,
  content = `${file}\n`,
): string {
  r.git('checkout', '-q', onto);
  r.git('checkout', '-qb', branch);
  write(r.dir, file, content);
  r.git('add', '.');
  r.git('commit', '-qm', `feat: ${file}`);
  const tip = r.git('rev-parse', 'HEAD');
  r.git('checkout', '-q', onto);
  r.git('merge', '-q', '--no-ff', '-m', `Merge pull request #${number} from Vast-Menu/${branch}`, branch);
  return tip;
}

function commit(r: ReturnType<typeof repo>, on: string, file: string, content: string, subject: string): void {
  r.git('checkout', '-q', on);
  write(r.dir, file, content);
  r.git('add', '.');
  r.git('commit', '-qm', subject);
}

const numbers = (prs: { number: number }[]): number[] => prs.map((p) => p.number);
const subjects = (cs: { subject: string }[]): string[] => cs.map((c) => c.subject).sort();

test('staging vs production: PRs by number, vehicles and noise dropped, ports found by code', () => {
  const r = repo();
  try {
    r.git('checkout', '-qb', 'staging');
    mergePr(r, 'staging', 10, 'feat/a', 'a.txt');
    mergePr(r, 'staging', 11, 'fix/b', 'b.txt');
    const pr11 = r.git('rev-parse', 'staging');
    commit(r, 'staging', 'd.txt', 'd\n', 'fix: direct on staging');
    commit(r, 'staging', 'package.json', '{\n  "name": "x",\n  "version": "1.0.1-rc2"\n}\n', 'ci: version 1.0.1-rc2');
    commit(r, 'staging', 'Helm/values-stage.yaml', 'tag: x\n', 'Update values-stage.yaml');

    // Production: #11 arrives as a cherry-picked merge, as a --pick hotfix carries it.
    r.git('checkout', '-q', 'production');
    r.git('cherry-pick', '-m', '1', pr11);
    // A hotfix vehicle carrying a version bump and one fix made on the hotfix branch itself.
    r.git('checkout', '-qb', 'hotfix/1.0.1');
    write(r.dir, 'package.json', '{\n  "name": "x",\n  "version": "1.0.1"\n}\n');
    r.git('commit', '-qam', 'ci: version 1.0.1');
    write(r.dir, 'h.txt', 'h\n');
    r.git('add', '.');
    r.git('commit', '-qm', 'fix: hotfix-only change');
    r.git('checkout', '-q', 'production');
    r.git('merge', '-q', '--no-ff', '-m', 'Merge pull request #20 from Vast-Menu/hotfix/1.0.1', 'hotfix/1.0.1');
    const cTip = mergePr(r, 'production', 30, 'fix/c', 'c.txt');
    mergePr(r, 'production', 31, 'fix/e', 'e.txt', 'e1\n');

    // Ported back to staging: #30 cleanly (same code), #31 by hand with different code.
    r.git('checkout', '-q', 'staging');
    r.git('cherry-pick', cTip);
    commit(r, 'staging', 'e.txt', 'e2\n', 'fix: port e by hand');

    const p = compareBranches(r.dir, 'staging', 'production');

    assert.deepEqual(p.sharedPrs, [11]);
    assert.deepEqual(numbers(p.onlySource.prs), [10]);
    assert.deepEqual(subjects(p.onlySource.direct), ['feat: c.txt', 'fix: direct on staging', 'fix: port e by hand']);
    assert.deepEqual(numbers(p.onlyTarget.prs), [30, 31]);
    assert.deepEqual(subjects(p.onlyTarget.direct), ['fix: hotfix-only change']);

    const portC = p.onlySource.direct.find((c) => c.subject === 'feat: c.txt')!;
    const portE = p.onlySource.direct.find((c) => c.subject === 'fix: port e by hand')!;
    const pr30 = p.onlyTarget.prs.find((u) => u.number === 30)!;
    const pr31 = p.onlyTarget.prs.find((u) => u.number === 31)!;
    assert.equal(p.onlySource.ported.has(portC.sha), true);
    assert.equal(p.onlyTarget.ported.has(pr30.sha), true);
    assert.equal(p.onlySource.ported.has(portE.sha), false);
    assert.equal(p.onlyTarget.ported.has(pr31.sha), false);
  } finally {
    r.cleanup();
  }
});

test('develop vs staging: a promote merge carries PRs, and their commits are not direct commits', () => {
  const r = repo();
  try {
    r.git('checkout', '-qb', 'staging');
    r.git('checkout', '-qb', 'develop');
    mergePr(r, 'develop', 40, 'feat/p', 'p.txt');
    r.git('checkout', '-q', 'staging');
    r.git('merge', '-q', '--no-ff', '-m', "Merge branch 'develop' into staging", 'develop');
    mergePr(r, 'develop', 41, 'feat/q', 'q.txt');
    commit(r, 'staging', 's.txt', 's\n', 'fix: hotfix on staging');

    const promote = compareBranches(r.dir, 'develop', 'staging');
    assert.deepEqual(numbers(promote.onlySource.prs), [41]);
    assert.deepEqual(promote.onlySource.direct, []);
    assert.deepEqual(numbers(promote.onlyTarget.prs), []);
    assert.deepEqual(subjects(promote.onlyTarget.direct), ['fix: hotfix on staging']);

    const release = compareBranches(r.dir, 'staging', 'production');
    assert.deepEqual(numbers(release.onlySource.prs), [40]);
    assert.deepEqual(subjects(release.onlySource.direct), ['fix: hotfix on staging']);
  } finally {
    r.cleanup();
  }
});

test('a PR lands when its merge was committed', () => {
  const r = repo();
  try {
    r.git('checkout', '-qb', 'staging');
    r.git('checkout', '-qb', 'feat/t');
    write(r.dir, 't.txt', 't\n');
    r.git('add', '.');
    r.git('commit', '-qm', 'feat: t');
    r.git('checkout', '-q', 'staging');
    execFileSync('git', ['merge', '-q', '--no-ff', '-m', 'Merge pull request #50 from Vast-Menu/feat/t', 'feat/t'], {
      cwd: r.dir,
      stdio: 'pipe',
      env: { ...process.env, GIT_COMMITTER_DATE: '2026-09-01T00:00:00Z' },
    });
    const p = compareBranches(r.dir, 'staging', 'production');
    assert.equal(p.onlySource.prs[0].landedAt.toISOString(), '2026-09-01T00:00:00.000Z');
  } finally {
    r.cleanup();
  }
});

test('identical branches compare empty', () => {
  const r = repo();
  try {
    r.git('checkout', '-qb', 'staging');
    const p = compareBranches(r.dir, 'staging', 'production');
    assert.deepEqual(p.onlySource.prs, []);
    assert.deepEqual(p.onlySource.direct, []);
    assert.deepEqual(p.onlyTarget.prs, []);
    assert.deepEqual(p.sharedPrs, []);
  } finally {
    r.cleanup();
  }
});

test('an unknown ref throws rather than reporting an empty difference', () => {
  const r = repo();
  try {
    assert.throws(() => compareBranches(r.dir, 'origin/nope', 'production'));
  } finally {
    r.cleanup();
  }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --import tsx --test tests/parity.test.ts`
Expected: FAIL, cannot find module `../src/utils/parity.js`.

- [ ] **Step 3: Implement** — create `src/utils/parity.ts`:

```ts
/**
 * What one branch has that another lacks, by PR rather than by commit.
 *
 * Comparing commits is useless across these branches: merges, CI bumps and
 * cherry-picked hotfixes make staging and production differ by a hundred
 * commits that say nothing. A PR keeps its "Merge pull request #N" subject on
 * every branch it reaches, including as a cherry-picked copy, so PR numbers
 * are compared first. Whatever is left on one side is then checked by code
 * content (patch-id), which catches a fix ported back under a new commit.
 *
 * Git only: no network, nothing written.
 */

import { execFileSync } from 'child_process';
import { isPipelineNoise, isVehicleBranch, parsePrSubject } from './pr-subject.js';

export interface PrUnit {
  number: number;
  branch: string;
  /** The merge commit, or the cherry-picked copy of it, on this side. */
  sha: string;
  landedAt: Date;
  patchId: string | null;
}

export interface DirectCommit {
  sha: string;
  subject: string;
  landedAt: Date;
  patchId: string | null;
}

export interface Side {
  prs: PrUnit[];
  direct: DirectCommit[];
  /** SHAs of items whose code is already on the other side under another commit. */
  ported: Set<string>;
}

export interface Parity {
  source: string;
  target: string;
  onlySource: Side;
  onlyTarget: Side;
  sharedPrs: number[];
}

interface RawCommit {
  sha: string;
  parents: string[];
  landedAt: Date;
  subject: string;
}

const FIELD = '\x1f';
const RECORD = '\x1e';
const HELM_VALUES = /^Helm\/values-[^/]+\.ya?ml$/;

function git(dir: string, args: string[], input?: string): string {
  return execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    input,
    maxBuffer: 256 * 1024 * 1024,
  });
}

function commitsIn(dir: string, base: string, head: string): RawCommit[] {
  const out = git(dir, ['log', `${base}..${head}`, `--format=%H${FIELD}%P${FIELD}%ct${FIELD}%s`]);
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, parents, ct, ...rest] = line.split(FIELD);
      return {
        sha,
        parents: parents ? parents.split(' ') : [],
        landedAt: new Date(Number(ct) * 1000),
        subject: rest.join(FIELD),
      };
    });
}

/** Files each non-merge commit touched, in one git call rather than one per commit. */
function filesByCommit(dir: string, base: string, head: string): Map<string, string[]> {
  const out = git(dir, ['log', '--no-merges', `--format=${RECORD}%H`, '--name-only', `${base}..${head}`]);
  const map = new Map<string, string[]>();
  for (const chunk of out.split(RECORD)) {
    const [sha, ...files] = chunk.split('\n').map((s) => s.trim()).filter(Boolean);
    if (sha) map.set(sha, files);
  }
  return map;
}

/** Patch-ids of every non-merge commit in the range, in one pipe. */
function patchIdsOfCommits(dir: string, base: string, head: string): Map<string, string> {
  const map = new Map<string, string>();
  const log = git(dir, ['log', '-p', '--no-merges', '--no-color', `${base}..${head}`]);
  if (!log.trim()) return map;
  for (const line of git(dir, ['patch-id', '--stable'], log).split('\n')) {
    const [patchId, sha] = line.trim().split(/\s+/);
    if (patchId && sha) map.set(sha, patchId);
  }
  return map;
}

/** A merge's patch-id is that of its whole change against the branch it landed on. */
function patchIdOfMerge(dir: string, merge: RawCommit): string | null {
  const diff = git(dir, ['diff', '--no-color', merge.parents[0], merge.sha]);
  if (!diff.trim()) return null;
  return git(dir, ['patch-id', '--stable'], diff).trim().split(/\s+/)[0] || null;
}

/**
 * Version bumps and deploy-tag edits that carry no product change: commits
 * touching only Helm values files, or only package.json's version line.
 */
function isBookkeeping(dir: string, sha: string, files: string[]): boolean {
  if (files.length === 0) return false;
  if (files.every((f) => HELM_VALUES.test(f))) return true;
  if (files.every((f) => f === 'package.json' || f === 'package-lock.json') && files.includes('package.json')) {
    const diff = git(dir, ['diff-tree', '--no-commit-id', '-p', '-U0', sha, '--', 'package.json']);
    const changed = diff.split('\n').filter((l) => /^[+-](?![+-])/.test(l));
    return changed.length > 0 && changed.every((l) => /"version"\s*:/.test(l));
  }
  return false;
}

function readSide(dir: string, base: string, head: string): Omit<Side, 'ported'> {
  const commits = commitsIn(dir, base, head);
  const files = filesByCommit(dir, base, head);
  const patchIds = patchIdsOfCommits(dir, base, head);

  // Commits a PR merge brought in belong to that PR, not to the direct list.
  // Vehicles own nothing: a hotfix's picks are PRs in their own right, and a
  // fix typed straight onto the hotfix branch is genuine direct work.
  const owned = new Set<string>();
  const prs = new Map<number, PrUnit>();
  for (const c of commits) {
    const pr = parsePrSubject(c.subject);
    if (!pr || isVehicleBranch(pr.branch)) continue;
    const isMerge = c.parents.length >= 2;
    if (isMerge) {
      for (const sha of git(dir, ['rev-list', `${c.parents[0]}..${c.parents[1]}`]).split('\n')) {
        if (sha) owned.add(sha);
      }
    }
    const unit: PrUnit = {
      number: pr.number,
      branch: pr.branch,
      sha: c.sha,
      landedAt: c.landedAt,
      patchId: isMerge ? patchIdOfMerge(dir, c) : (patchIds.get(c.sha) ?? null),
    };
    // A PR merged and later cherry-picked onto the same branch is one PR,
    // landed when it first arrived.
    const seen = prs.get(pr.number);
    if (!seen || unit.landedAt < seen.landedAt) prs.set(pr.number, unit);
  }

  const direct: DirectCommit[] = [];
  for (const c of commits) {
    if (c.parents.length >= 2) continue; // PR merges handled above; other merges carry no work of their own
    if (parsePrSubject(c.subject)) continue; // cherry-picked PR merges, vehicles included
    if (owned.has(c.sha)) continue;
    if (isPipelineNoise(c.subject) || isBookkeeping(dir, c.sha, files.get(c.sha) ?? [])) continue;
    direct.push({ sha: c.sha, subject: c.subject, landedAt: c.landedAt, patchId: patchIds.get(c.sha) ?? null });
  }

  return {
    prs: [...prs.values()].sort((a, b) => a.number - b.number),
    direct: direct.sort((a, b) => a.landedAt.getTime() - b.landedAt.getTime()),
  };
}

function withPorted(side: Omit<Side, 'ported'>, other: Omit<Side, 'ported'>): Side {
  const otherIds = new Set(
    [...other.prs, ...other.direct].map((i) => i.patchId).filter((p): p is string => p !== null),
  );
  const ported = new Set(
    [...side.prs, ...side.direct].filter((i) => i.patchId !== null && otherIds.has(i.patchId)).map((i) => i.sha),
  );
  return { ...side, ported };
}

export function compareBranches(dir: string, source: string, target: string): Parity {
  const src = readSide(dir, target, source);
  const tgt = readSide(dir, source, target);
  const inTarget = new Set(tgt.prs.map((p) => p.number));
  const inSource = new Set(src.prs.map((p) => p.number));
  const onlySrc = { prs: src.prs.filter((p) => !inTarget.has(p.number)), direct: src.direct };
  const onlyTgt = { prs: tgt.prs.filter((p) => !inSource.has(p.number)), direct: tgt.direct };
  return {
    source,
    target,
    onlySource: withPorted(onlySrc, onlyTgt),
    onlyTarget: withPorted(onlyTgt, onlySrc),
    sharedPrs: src.prs.filter((p) => inTarget.has(p.number)).map((p) => p.number),
  };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --import tsx --test tests/parity.test.ts`
Expected: `# pass 5`, `# fail 0`. If the first test's `feat: c.txt` port is not marked ported, check that `patchIdOfMerge` diffs `parents[0]..sha` (not `sha^..sha` with `--first-parent` omitted).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/utils/parity.ts tests/parity.test.ts
git commit -m "feat(pending): compare two branches by PR, with patch-id as a second check"
```

---

### Task 3: Model phrases without fallback

**Files:**
- Modify: `src/utils/pr-summary.ts` (`interface PrForSummary` line 25; `summarizePrs` lines 253-273)
- Test: `tests/pr-summary.test.ts` (append)

**Interfaces:**
- Consumes: existing `SummaryDeps`, `buildSummaryPrompt`, `screenSummary`, `heuristicSummary` in the same file.
- Produces:
  ```ts
  export interface PrForSummary { number: number; title: string; branch: string }
  export async function modelPhrases(prs: PrForSummary[], deps?: SummaryDeps): Promise<Record<number, string>>;
  // summarizePrs keeps its signature and behaviour.
  ```

- [ ] **Step 1: Write the failing tests** — append to `tests/pr-summary.test.ts` (add `modelPhrases` to its existing import from `../src/utils/pr-summary.js`):

```ts
test('modelPhrases returns only the screened model phrases, no fallback', async () => {
  const phrases = await modelPhrases(
    [
      { number: 1, title: 'fix: reuse guest tokens', branch: 'a' },
      { number: 2, title: 'feat: order dialog', branch: 'b' },
    ],
    { available: () => true, run: () => '{"1": "guest token reuse", "2": "see https://example.com"}' },
  );
  assert.deepEqual(phrases, { 1: 'guest token reuse' });
});

test('modelPhrases is empty when no model is available', async () => {
  const phrases = await modelPhrases([{ number: 1, title: 'fix: x', branch: 'a' }], {
    available: () => false,
    run: () => {
      throw new Error('must not be called');
    },
  });
  assert.deepEqual(phrases, {});
});

test('modelPhrases is empty when the model call throws', async () => {
  const phrases = await modelPhrases([{ number: 1, title: 'fix: x', branch: 'a' }], {
    available: () => true,
    run: () => {
      throw new Error('timeout');
    },
  });
  assert.deepEqual(phrases, {});
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --import tsx --test tests/pr-summary.test.ts`
Expected: FAIL, `modelPhrases` is not exported.

- [ ] **Step 3: Implement** — in `src/utils/pr-summary.ts`, change `interface PrForSummary` to `export interface PrForSummary`, then replace `summarizePrs` with:

```ts
/**
 * The model's phrases alone, screened, with no fallback. A PR the model
 * skipped or answered badly is absent, and an empty result means no model
 * answered at all — which is how `vast pending` knows to show titles instead
 * of the weaker rule-based phrase.
 */
export async function modelPhrases(
  prs: PrForSummary[],
  deps: SummaryDeps = defaultDeps,
): Promise<Record<number, string>> {
  const out: Record<number, string> = {};
  if (prs.length === 0) return out;

  let answer: Record<string, unknown> | null = null;
  try {
    if (deps.available()) answer = parseAnswer(deps.run(buildSummaryPrompt(prs)));
  } catch {
    // No model, a timeout, a crash: no phrases, and the caller decides.
    answer = null;
  }

  for (const pr of prs) {
    const phrase = answer?.[String(pr.number)];
    const screened = typeof phrase === 'string' ? screenSummary(phrase) : null;
    if (screened) out[pr.number] = screened;
  }
  return out;
}

export async function summarizePrs(
  prs: PrForSummary[],
  deps: SummaryDeps = defaultDeps,
): Promise<Record<number, string>> {
  const phrases = await modelPhrases(prs, deps);
  const out: Record<number, string> = {};
  for (const pr of prs) out[pr.number] = phrases[pr.number] ?? heuristicSummary(pr.title);
  return out;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --import tsx --test tests/pr-summary.test.ts`
Expected: `# fail 0` (the 19 existing `summarizePrs` tests still pass).

- [ ] **Step 5: Commit**

```bash
npm run typecheck
git add src/utils/pr-summary.ts tests/pr-summary.test.ts
git commit -m "feat(summary): expose model phrases without the rule-based fallback"
```

---

### Task 4: Shared Slack bullet (`slack-rich-text.ts`)

**Files:**
- Create: `src/utils/slack-rich-text.ts`
- Modify: `src/utils/release-message.ts` (remove `escape`, `Element`, `commaSeparated`, `Person`; `people` becomes exported `namedPeople`; `buildReleaseMessage` body)
- Test: `tests/slack-rich-text.test.ts`

**Interfaces:**
- Consumes: `clickupTaskUrl` from `src/config/slack.ts`.
- Produces:
  ```ts
  export type RichElement = { type: 'link'; url: string; text: string } | { type: 'text'; text: string } | { type: 'user'; user_id: string };
  export type Person = { userId: string } | { plain: string };
  export interface Bullet { text: string; elements: RichElement[] }
  export function escapeMrkdwn(text: string): string;
  export function bullet(input: { url: string; label: string; description: string; people: Person[]; tickets: string[] }): Bullet;
  export function bulletBlocks(bullets: Bullet[], heading?: string): unknown[];
  // release-message.ts additionally exports:
  export function namedPeople(prs: ShippedPr[], mentions: Record<string, string | null>): Person[];
  ```

- [ ] **Step 1: Write the failing test** — create `tests/slack-rich-text.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bullet, bulletBlocks, escapeMrkdwn } from '../src/utils/slack-rich-text.js';

const clickup = (id: string): string => `https://app.clickup.com/t/90121402342/${id}`;

test('a bullet carries the link, description, people and tickets as text and elements', () => {
  const b = bullet({
    url: 'https://example.com/pr/1',
    label: 'App - hotfix/1.0.1',
    description: 'Guest token reuse',
    people: [{ userId: 'U1' }, { plain: '@Osama Elshimy' }],
    tickets: ['VA-1'],
  });
  assert.equal(
    b.text,
    `• <https://example.com/pr/1|App - hotfix/1.0.1> - Guest token reuse (<@U1>, @Osama Elshimy) (<${clickup('VA-1')}|VA-1>)`,
  );
  assert.deepEqual(b.elements, [
    { type: 'link', url: 'https://example.com/pr/1', text: 'App - hotfix/1.0.1' },
    { type: 'text', text: ' - Guest token reuse (' },
    { type: 'user', user_id: 'U1' },
    { type: 'text', text: ', ' },
    { type: 'text', text: '@Osama Elshimy' },
    { type: 'text', text: ') (' },
    { type: 'link', url: clickup('VA-1'), text: 'VA-1' },
    { type: 'text', text: ')' },
  ]);
});

test('bulletBlocks puts every bullet in one list, under an optional bold heading', () => {
  const a = bullet({ url: 'u1', label: 'A', description: 'x', people: [], tickets: [] });
  const b = bullet({ url: 'u2', label: 'B', description: 'y', people: [], tickets: [] });
  assert.deepEqual(bulletBlocks([a, b]), [
    {
      type: 'rich_text',
      elements: [
        {
          type: 'rich_text_list',
          style: 'bullet',
          elements: [
            { type: 'rich_text_section', elements: a.elements },
            { type: 'rich_text_section', elements: b.elements },
          ],
        },
      ],
    },
  ]);
  const withHeading = bulletBlocks([a], 'Pending for production') as Array<{ elements: unknown[] }>;
  assert.deepEqual(withHeading[0].elements[0], {
    type: 'rich_text_section',
    elements: [{ type: 'text', text: 'Pending for production', style: { bold: true } }],
  });
});

test('mrkdwn escaping covers exactly & < >', () => {
  assert.equal(escapeMrkdwn('a & <b> c'), 'a &amp; &lt;b&gt; c');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test tests/slack-rich-text.test.ts`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Implement** — create `src/utils/slack-rich-text.ts`:

```ts
/**
 * The team's Slack bullet: `• <link|label> - description (people) (tickets)`.
 *
 * Produced twice, as the release announcement does: `text`, the mrkdwn line
 * Slack shows in notifications and clients that cannot draw blocks, and
 * `elements`, one rich_text section so the channel sees a real bullet with
 * real mentions. Shared by the release announcement and `vast pending` so the
 * two posts cannot drift apart.
 */

import { clickupTaskUrl } from '../config/slack.js';

export type RichElement =
  | { type: 'link'; url: string; text: string }
  | { type: 'text'; text: string }
  | { type: 'user'; user_id: string };

/** A resolved Slack id becomes a mention; anyone unmatched is named in plain text. */
export type Person = { userId: string } | { plain: string };

export interface Bullet {
  text: string;
  elements: RichElement[];
}

/**
 * Slack's mrkdwn reserves exactly three characters — `&` first, or the escapes
 * would escape each other. Free text in `text` only; blocks are JSON.
 */
export function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** `items` with a ", " text element between each pair, as the list is typed by hand. */
function commaSeparated(items: RichElement[]): RichElement[] {
  return items.flatMap((item, i) => (i === 0 ? [item] : [{ type: 'text', text: ', ' } as RichElement, item]));
}

export function bullet(input: {
  url: string;
  label: string;
  description: string;
  people: Person[];
  tickets: string[];
}): Bullet {
  const { url, label, description, people: named, tickets: ids } = input;

  const parts = [`• <${url}|${escapeMrkdwn(label)}> - ${escapeMrkdwn(description)}`];
  if (named.length > 0) {
    parts.push(`(${named.map((p) => ('userId' in p ? `<@${p.userId}>` : escapeMrkdwn(p.plain))).join(', ')})`);
  }
  if (ids.length > 0) {
    parts.push(`(${ids.map((id) => `<${clickupTaskUrl(id)}|${id}>`).join(', ')})`);
  }

  const elements: RichElement[] = [
    { type: 'link', url, text: label },
    { type: 'text', text: ` - ${description}${named.length > 0 ? ' (' : ''}` },
  ];
  if (named.length > 0) {
    elements.push(
      ...commaSeparated(
        named.map((p): RichElement => ('userId' in p ? { type: 'user', user_id: p.userId } : { type: 'text', text: p.plain })),
      ),
    );
    elements.push({ type: 'text', text: ids.length > 0 ? ') (' : ')' });
  } else if (ids.length > 0) {
    elements.push({ type: 'text', text: ' (' });
  }
  if (ids.length > 0) {
    elements.push(...commaSeparated(ids.map((id): RichElement => ({ type: 'link', url: clickupTaskUrl(id), text: id }))));
    elements.push({ type: 'text', text: ')' });
  }

  return { text: parts.join(' '), elements };
}

export function bulletBlocks(bullets: Bullet[], heading?: string): unknown[] {
  const list = {
    type: 'rich_text_list',
    style: 'bullet',
    elements: bullets.map((b) => ({ type: 'rich_text_section', elements: b.elements })),
  };
  const elements = heading
    ? [{ type: 'rich_text_section', elements: [{ type: 'text', text: heading, style: { bold: true } }] }, list]
    : [list];
  return [{ type: 'rich_text', elements }];
}
```

- [ ] **Step 4: Rebuild the announcement on it** — in `src/utils/release-message.ts`:

1. Delete `function escape`, the `type Element` union, `function commaSeparated`, and the local `type Person` (with their comments).
2. Add `import { bullet, bulletBlocks, type Person } from './slack-rich-text.js';`.
3. Rename `function people(` to `export function namedPeople(` (keep its body and comment) and update its one call site.
4. Replace the body of `buildReleaseMessage` with:

```ts
export function buildReleaseMessage(input: ReleaseMessageInput): ReleaseMessage {
  const b = bullet({
    url: input.prUrl,
    label: `${input.displayName} - ${input.branch}`,
    description: describe(input.prs, input.summaries, input.fallbackSubjects),
    people: namedPeople(input.prs, input.mentions),
    tickets: tickets(input.prs, input.fallbackSubjects),
  });
  return { text: b.text, blocks: bulletBlocks([b]) };
}
```

5. Remove the now-unused `clickupTaskUrl` import if nothing else in the file uses it (`grep -n clickupTaskUrl src/utils/release-message.ts`).

- [ ] **Step 5: Run the new test and the announcement guard**

Run: `node --import tsx --test tests/slack-rich-text.test.ts tests/release-message.test.ts tests/promote-slack.test.ts`
Expected: `# fail 0` with `tests/release-message.test.ts` **unmodified** (`git diff --stat tests/release-message.test.ts` prints nothing).

- [ ] **Step 6: Commit**

```bash
npm run typecheck
git add src/utils/slack-rich-text.ts src/utils/release-message.ts tests/slack-rich-text.test.ts
git commit -m "refactor(slack): share the team's bullet between announcement and pending"
```

---

### Task 5: Report model and terminal renderer

**Files:**
- Create: `src/utils/pending-report.ts`
- Test: `tests/pending-report.test.ts`

**Interfaces:**
- Consumes: `Side` (Task 2); `extractTickets` from `release-message.ts`; `parseSubject`, `tidy` from `changelog.ts`; `Contributor` from `contributors.ts`.
- Produces:
  ```ts
  export type PendingTo = 'production' | 'staging';
  export interface PendingPr { number: number; title: string; url: string; branch: string; contributors: Contributor[]; tickets: string[]; phrase: string | null; landedAt: Date; ported: boolean; detailsUnavailable: boolean }
  export interface PendingCommit { sha: string; subject: string; landedAt: Date; ported: boolean }
  export interface InFlightGroup { number: number; url: string; branch: string; prs: PendingPr[] }
  export interface PendingDirection { source: string; target: string; inFlight: InFlightGroup[]; waiting: PendingPr[]; direct: PendingCommit[] }
  export interface RepoProblem { kind: 'skipped' | 'error'; message: string }
  export interface RepoPending { repo: string; displayName: string; compareUrl: string; forward: PendingDirection | null; reverse: PendingDirection | null; problem: RepoProblem | null; notes: string[] }
  export interface PendingReport { to: PendingTo; generatedAt: Date; parity: boolean; repos: RepoPending[] }
  export interface PrDetails { title: string; url: string; branch: string; contributors: Contributor[] }
  export interface OpenReleasePr { number: number; url: string; branch: string; prNumbers: number[] }
  export interface RenderOptions { now: Date; byTicket: boolean; short: boolean }
  export const STALE_DAYS = 14;
  export function ageDays(landedAt: Date, now: Date): number;
  export function prsOf(d: PendingDirection): PendingPr[];
  export function groupByTicket(prs: PendingPr[]): Array<{ ticket: string | null; prs: PendingPr[] }>;
  export function buildDirection(input: { source: string; target: string; side: Side; details: Map<number, PrDetails>; phrases: Record<number, string>; openReleases: OpenReleasePr[]; repoUrl: string }): PendingDirection;
  export function renderTerminal(report: PendingReport, o: RenderOptions): string;
  ```
  (Task 6 adds `renderMarkdown` and `renderJson` to this file.)

- [ ] **Step 1: Write the failing tests** — create `tests/pending-report.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDirection,
  renderTerminal,
  type PendingPr,
  type PendingReport,
  type RepoPending,
} from '../src/utils/pending-report.js';
import type { Contributor } from '../src/utils/contributors.js';

export const NOW = new Date('2026-09-24T12:00:00Z');
export const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * 86_400_000);
const REPO_URL = 'https://github.com/Vast-menu/VastPayPwaV2';
export const OSAMA: Contributor = { name: 'Osama Elshimy', login: null, emails: ['o@e.com'] };
export const MOSTAFA: Contributor = { name: 'Mostafa Adly', login: 'MostafaAdly', emails: ['m@e.com'] };

export function pr(number: number, over: Partial<PendingPr> = {}): PendingPr {
  return {
    number,
    title: `Change ${number}`,
    url: `${REPO_URL}/pull/${number}`,
    branch: `fix/change-${number}`,
    contributors: [OSAMA],
    tickets: [],
    phrase: null,
    landedAt: daysAgo(3),
    ported: false,
    detailsUnavailable: false,
    ...over,
  };
}

export function fixtureRepo(): RepoPending {
  return {
    repo: 'VastPayPwaV2',
    displayName: 'Vastpay Pwa V2',
    compareUrl: `${REPO_URL}/compare/production...staging`,
    problem: null,
    notes: [],
    forward: {
      source: 'staging',
      target: 'production',
      inFlight: [
        {
          number: 334,
          url: `${REPO_URL}/pull/334`,
          branch: 'hotfix/2.1.15',
          prs: [pr(301, { title: 'One create-charge per sheet', phrase: 'ELM single charge', contributors: [MOSTAFA], landedAt: daysAgo(13) })],
        },
      ],
      waiting: [
        pr(298, { title: 'Old change', landedAt: daysAgo(21) }),
        pr(313, {
          title: 'Reuse guest tokens without overriding customer sessions',
          phrase: 'guest token reuse',
          tickets: ['VA-13091'],
          landedAt: daysAgo(9),
        }),
      ],
      direct: [
        { sha: '46d26d9' + 'a'.repeat(33), subject: 'fix(pwa): preserve disabled plugin lifecycle', landedAt: daysAgo(3), ported: false },
      ],
    },
    reverse: {
      source: 'production',
      target: 'staging',
      inFlight: [],
      waiting: [
        pr(270, { title: 'Include guest token in send-OTP request', ported: true, landedAt: daysAgo(30) }),
        pr(332, { title: 'Raise pwa-v2 memory request', landedAt: daysAgo(5) }),
      ],
      direct: [],
    },
  };
}

export function fixtureReport(repos: RepoPending[] = [fixtureRepo()], parity = true): PendingReport {
  return { to: 'production', generatedAt: NOW, parity, repos };
}

const OPTS = { now: NOW, byTicket: false, short: false };

test('buildDirection turns a comparison into PRs, moving those in an open release PR to In flight', () => {
  const d = buildDirection({
    source: 'staging',
    target: 'production',
    side: {
      prs: [
        { number: 313, branch: 'Osama/VA-13091', sha: 's313', landedAt: daysAgo(9), patchId: null },
        { number: 301, branch: 'fix/elm', sha: 's301', landedAt: daysAgo(13), patchId: 'p' },
        { number: 400, branch: 'fix/unknown', sha: 's400', landedAt: daysAgo(1), patchId: null },
      ],
      direct: [{ sha: 'd1', subject: 'fix: direct', landedAt: daysAgo(2), patchId: null }],
      ported: new Set(['s301']),
    },
    details: new Map([
      [301, { title: 'fix(elm): one create-charge per sheet', url: `${REPO_URL}/pull/301`, branch: 'fix/elm', contributors: [MOSTAFA] }],
      [313, { title: 'fix: reuse guest tokens', url: `${REPO_URL}/pull/313`, branch: 'Osama/VA-13091', contributors: [OSAMA] }],
    ]),
    phrases: { 313: 'guest token reuse' },
    openReleases: [{ number: 334, url: `${REPO_URL}/pull/334`, branch: 'hotfix/2.1.15', prNumbers: [301] }],
    repoUrl: REPO_URL,
  });

  assert.deepEqual(d.inFlight.map((g) => [g.number, g.prs.map((p) => p.number)]), [[334, [301]]]);
  assert.deepEqual(d.waiting.map((p) => p.number), [313, 400]);
  const [p313, p400] = d.waiting;
  assert.equal(p313.title, 'Reuse guest tokens');
  assert.equal(p313.phrase, 'guest token reuse');
  assert.deepEqual(p313.tickets, ['VA-13091']);
  assert.equal(d.inFlight[0].prs[0].ported, true);
  assert.equal(d.inFlight[0].prs[0].title, 'One create-charge per sheet');
  assert.equal(p400.detailsUnavailable, true);
  assert.equal(p400.title, 'fix/unknown');
  assert.equal(p400.url, `${REPO_URL}/pull/400`);
  assert.deepEqual(d.direct.map((c) => c.subject), ['fix: direct']);
});

test('terminal: one repo with both directions', () => {
  assert.equal(
    renderTerminal(fixtureReport(), OPTS),
    [
      '  VastPayPwaV2 | staging → production',
      '',
      '  In flight · hotfix/2.1.15 (#334, open)',
      '    #301  ELM single charge — One create-charge per sheet',
      '          Mostafa Adly · 13d',
      '',
      '  Waiting (2)',
      '    #298  Old change',
      '          Osama Elshimy · 21d  ⚠ stale',
      '    #313  guest token reuse — Reuse guest tokens without overriding customer sessions',
      '          Osama Elshimy · VA-13091 · 9d',
      '',
      '  Direct commits (1)',
      '    46d26d9  fix(pwa): preserve disabled plugin lifecycle · 3d',
      '',
      '  3 PRs · 1 direct commit · 1 ticket · oldest 21 days',
      '',
      '  On production, not on staging (2)',
      '    #270  Include guest token in send-OTP request',
      '          Osama Elshimy · 30d  ported (same code)',
      '    #332  Raise pwa-v2 memory request',
      '          Osama Elshimy · 5d  ⚠ not found on staging',
    ].join('\n'),
  );
});

test('terminal --short shows titles only', () => {
  const out = renderTerminal(fixtureReport(), { ...OPTS, short: true });
  assert.match(out, /^ {4}#313 {2}Reuse guest tokens without overriding customer sessions$/m);
  assert.doesNotMatch(out, /guest token reuse/);
});

test('terminal --by-ticket groups PRs under their tickets, untracked last', () => {
  const out = renderTerminal(fixtureReport(), { ...OPTS, byTicket: true });
  assert.match(
    out,
    /  Waiting \(2\)\n {4}VA-13091\n {6}#313 {2}guest token reuse — [^\n]+\n[^\n]+\n {4}Untracked\n {6}#298 {2}Old change/,
  );
});

test('terminal: a repo with nothing either way collapses to in sync', () => {
  const repo = fixtureRepo();
  repo.forward = { ...repo.forward!, inFlight: [], waiting: [], direct: [] };
  repo.reverse = { ...repo.reverse!, waiting: [] };
  assert.equal(renderTerminal(fixtureReport([repo]), OPTS), '  VastPayPwaV2 | staging → production · in sync');
});

test('terminal: nothing forward but something back says so', () => {
  const repo = fixtureRepo();
  repo.forward = { ...repo.forward!, inFlight: [], waiting: [], direct: [] };
  const out = renderTerminal(fixtureReport([repo]), OPTS);
  assert.match(out, /  Nothing on staging that production lacks\./);
  assert.match(out, /  On production, not on staging \(2\)/);
});

test('terminal: a repo with a problem is one line', () => {
  const repo: RepoPending = {
    ...fixtureRepo(),
    repo: 'VastPay-BackEnd',
    forward: null,
    reverse: null,
    problem: { kind: 'skipped', message: 'no develop branch' },
  };
  assert.equal(renderTerminal(fixtureReport([repo]), OPTS), '  VastPay-BackEnd  no develop branch');
});

test('terminal: a PR gh could not read is flagged', () => {
  const repo = fixtureRepo();
  repo.forward!.waiting = [pr(400, { title: 'fix/unknown', contributors: [], detailsUnavailable: true, landedAt: daysAgo(1) })];
  assert.match(renderTerminal(fixtureReport([repo], false), OPTS), /#400 {2}fix\/unknown\n {10}1d {2}details unavailable/);
});

test('terminal: a sweep opens with a summary table', () => {
  const skipped: RepoPending = {
    ...fixtureRepo(),
    repo: 'VastPay-BackEnd',
    forward: null,
    reverse: null,
    problem: { kind: 'skipped', message: 'no develop branch' },
  };
  const out = renderTerminal(fixtureReport([fixtureRepo(), skipped]), OPTS);
  const table = out.split('\n\n')[0].split('\n');
  assert.match(table[0], /^ {2}REPO +WAITING +IN FLIGHT +PRODUCTION ONLY +OLDEST$/);
  assert.match(table[1], /^ {2}VastPayPwaV2 +3 +1 +2 +21d$/);
  assert.match(table[2], /^ {2}VastPay-BackEnd +no develop branch$/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --import tsx --test tests/pending-report.test.ts`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Implement** — create `src/utils/pending-report.ts`:

```ts
/**
 * `vast pending`: the report model and its renderers.
 *
 * Everything here is pure — a model in, text out — so the exact output of
 * every mode is pinned in tests. Gathering the model (git, gh, the model
 * call) lives in src/commands/pending.ts.
 */

import { parseSubject, tidy } from './changelog.js';
import { extractTickets } from './release-message.js';
import type { Contributor } from './contributors.js';
import type { Side } from './parity.js';

export type PendingTo = 'production' | 'staging';

export interface PendingPr {
  number: number;
  /** Tidied PR title, or the branch when gh could not read the PR. */
  title: string;
  url: string;
  branch: string;
  contributors: Contributor[];
  tickets: string[];
  /** The model's 2-3 word phrase, or null when none came back. */
  phrase: string | null;
  landedAt: Date;
  /** Its code is already on the other side under another commit. */
  ported: boolean;
  detailsUnavailable: boolean;
}

export interface PendingCommit {
  sha: string;
  subject: string;
  landedAt: Date;
  ported: boolean;
}

export interface InFlightGroup {
  number: number;
  url: string;
  branch: string;
  prs: PendingPr[];
}

export interface PendingDirection {
  source: string;
  target: string;
  inFlight: InFlightGroup[];
  waiting: PendingPr[];
  direct: PendingCommit[];
}

export interface RepoProblem {
  kind: 'skipped' | 'error';
  message: string;
}

export interface RepoPending {
  repo: string;
  displayName: string;
  /** GitHub's compare view, target...source. */
  compareUrl: string;
  forward: PendingDirection | null;
  /** Only with --parity. */
  reverse: PendingDirection | null;
  problem: RepoProblem | null;
  /** Things that degraded the report without failing it. */
  notes: string[];
}

export interface PendingReport {
  to: PendingTo;
  generatedAt: Date;
  parity: boolean;
  repos: RepoPending[];
}

export interface PrDetails {
  title: string;
  url: string;
  branch: string;
  contributors: Contributor[];
}

export interface OpenReleasePr {
  number: number;
  url: string;
  branch: string;
  prNumbers: number[];
}

export interface RenderOptions {
  now: Date;
  byTicket: boolean;
  short: boolean;
}

/** Over two weeks on staging without reaching production is worth a nudge. */
export const STALE_DAYS = 14;
const DAY_MS = 86_400_000;

export function ageDays(landedAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - landedAt.getTime()) / DAY_MS));
}

export function prsOf(d: PendingDirection): PendingPr[] {
  return [...d.inFlight.flatMap((g) => g.prs), ...d.waiting];
}

function itemCount(d: PendingDirection): number {
  return prsOf(d).length + d.direct.length;
}

function oldestDays(d: PendingDirection, now: Date): number | null {
  const ages = [...prsOf(d), ...d.direct].map((i) => ageDays(i.landedAt, now));
  return ages.length > 0 ? Math.max(...ages) : null;
}

function personName(c: Contributor): string {
  return c.name.trim() || c.login || '?';
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function buildDirection(input: {
  source: string;
  target: string;
  side: Side;
  details: Map<number, PrDetails>;
  phrases: Record<number, string>;
  openReleases: OpenReleasePr[];
  repoUrl: string;
}): PendingDirection {
  const prs: PendingPr[] = input.side.prs
    .map((unit) => {
      const d = input.details.get(unit.number);
      const branch = d?.branch ?? unit.branch;
      return {
        number: unit.number,
        title: d ? tidy(parseSubject(d.title).text) : branch,
        url: d?.url ?? `${input.repoUrl}/pull/${unit.number}`,
        branch,
        contributors: d?.contributors ?? [],
        tickets: extractTickets([branch, d?.title ?? '']),
        phrase: input.phrases[unit.number] ?? null,
        landedAt: unit.landedAt,
        ported: input.side.ported.has(unit.sha),
        detailsUnavailable: !d,
      };
    })
    .sort((a, b) => a.number - b.number);

  // A PR already inside an open release/hotfix PR is on its way; listing it
  // as merely waiting would invite someone to pick it twice.
  const claimed = new Set<number>();
  const inFlight: InFlightGroup[] = [];
  for (const release of [...input.openReleases].sort((a, b) => a.number - b.number)) {
    const carried = prs.filter((p) => release.prNumbers.includes(p.number) && !claimed.has(p.number));
    for (const p of carried) claimed.add(p.number);
    if (carried.length > 0) inFlight.push({ number: release.number, url: release.url, branch: release.branch, prs: carried });
  }

  return {
    source: input.source,
    target: input.target,
    inFlight,
    waiting: prs.filter((p) => !claimed.has(p.number)),
    direct: input.side.direct.map((c) => ({
      sha: c.sha,
      subject: c.subject,
      landedAt: c.landedAt,
      ported: input.side.ported.has(c.sha),
    })),
  };
}

/** Tickets in first-seen order, then an Untracked group; a PR with two tickets appears under both. */
export function groupByTicket(prs: PendingPr[]): Array<{ ticket: string | null; prs: PendingPr[] }> {
  const groups = new Map<string | null, PendingPr[]>();
  for (const p of prs) {
    for (const key of p.tickets.length > 0 ? p.tickets : [null]) {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }
  }
  const out = [...groups.entries()].filter(([k]) => k !== null).map(([ticket, list]) => ({ ticket, prs: list }));
  const untracked = groups.get(null);
  if (untracked) out.push({ ticket: null, prs: untracked });
  return out;
}

type Role = { role: 'forward' | 'reverse'; other: string };

function markers(item: PendingPr | PendingCommit, age: number, r: Role): string[] {
  const out: string[] = [];
  if (item.ported) out.push('ported (same code)');
  // Not proof of absence: a port-back that needed conflict fixes has
  // different code, so the wording stays "not found".
  else if (r.role === 'reverse') out.push(`⚠ not found on ${r.other}`);
  else if (age > STALE_DAYS) out.push('⚠ stale');
  if ('detailsUnavailable' in item && item.detailsUnavailable) out.push('details unavailable');
  return out;
}

function prText(p: PendingPr, short: boolean): string {
  return !short && p.phrase ? `${p.phrase} — ${p.title}` : p.title;
}

function terminalPr(p: PendingPr, o: RenderOptions, r: Role, indent: string): string[] {
  const age = ageDays(p.landedAt, o.now);
  const meta = [p.contributors.map(personName).join(', '), p.tickets.join(', '), `${age}d`].filter(Boolean).join(' · ');
  const flags = markers(p, age, r).map((m) => `  ${m}`).join('');
  return [`${indent}#${p.number}  ${prText(p, o.short)}`, `${indent}      ${meta}${flags}`];
}

function terminalCommit(c: PendingCommit, o: RenderOptions, r: Role): string {
  const age = ageDays(c.landedAt, o.now);
  return `    ${c.sha.slice(0, 7)}  ${c.subject} · ${age}d${markers(c, age, r).map((m) => `  ${m}`).join('')}`;
}

function terminalPrList(prs: PendingPr[], o: RenderOptions, r: Role): string[] {
  if (!o.byTicket) return prs.flatMap((p) => terminalPr(p, o, r, '    '));
  return groupByTicket(prs).flatMap((g) => [
    `    ${g.ticket ?? 'Untracked'}`,
    ...g.prs.flatMap((p) => terminalPr(p, o, r, '      ')),
  ]);
}

function footer(d: PendingDirection, now: Date): string {
  const prs = prsOf(d);
  const tickets = new Set(prs.flatMap((p) => p.tickets)).size;
  const parts = [plural(prs.length, 'PR')];
  if (d.direct.length > 0) parts.push(plural(d.direct.length, 'direct commit'));
  if (tickets > 0) parts.push(plural(tickets, 'ticket'));
  const oldest = oldestDays(d, now);
  if (oldest !== null) parts.push(`oldest ${plural(oldest, 'day')}`);
  return parts.join(' · ');
}

function terminalRepo(r: RepoPending, o: RenderOptions): string[] {
  if (r.problem || !r.forward) return [`  ${r.repo}  ${r.problem?.message ?? ''}`.trimEnd()];
  const f = r.forward;
  const rv = r.reverse;
  const head = `  ${r.repo} | ${f.source} → ${f.target}`;
  if (itemCount(f) === 0 && (!rv || itemCount(rv) === 0)) return [`${head} · in sync`];

  const lines = [head];
  const section = (title: string, body: string[]): void => {
    if (body.length > 0) lines.push('', `  ${title}`, ...body);
  };
  const fwd: Role = { role: 'forward', other: f.target };
  for (const g of f.inFlight) section(`In flight · ${g.branch} (#${g.number}, open)`, terminalPrList(g.prs, o, fwd));
  section(`Waiting (${f.waiting.length})`, terminalPrList(f.waiting, o, fwd));
  section(`Direct commits (${f.direct.length})`, f.direct.map((c) => terminalCommit(c, o, fwd)));
  lines.push('', itemCount(f) > 0 ? `  ${footer(f, o.now)}` : `  Nothing on ${f.source} that ${f.target} lacks.`);

  if (rv) {
    const back: Role = { role: 'reverse', other: rv.target };
    if (itemCount(rv) === 0) lines.push('', `  Nothing on ${rv.source} that ${rv.target} lacks.`);
    else
      section(`On ${rv.source}, not on ${rv.target} (${itemCount(rv)})`, [
        ...terminalPrList(prsOf(rv), o, back),
        ...rv.direct.map((c) => terminalCommit(c, o, back)),
      ]);
  }
  return lines;
}

/** WAITING counts PRs and direct commits alike: both are work the target lacks. */
function sweepTable(report: PendingReport, o: RenderOptions): string[] {
  const header = ['REPO', 'WAITING', 'IN FLIGHT', ...(report.parity ? [`${report.to.toUpperCase()} ONLY`] : []), 'OLDEST'];
  const rows: string[][] = report.repos.map((r) => {
    if (r.problem || !r.forward) return [r.repo, r.problem?.message ?? ''];
    const f = r.forward;
    const oldest = oldestDays(f, o.now);
    return [
      r.repo,
      String(f.waiting.length + f.direct.length),
      String(f.inFlight.reduce((n, g) => n + g.prs.length, 0)),
      ...(report.parity ? [String(r.reverse ? itemCount(r.reverse) : 0)] : []),
      oldest === null ? '—' : `${oldest}d`,
    ];
  });
  const full = rows.filter((row) => row.length === header.length);
  const widths = header.map((h, i) => Math.max(h.length, ...full.map((row) => row[i].length), ...(i === 0 ? rows.map((row) => row[0].length) : [])));
  const fmt = (row: string[]): string =>
    row.length === header.length
      ? `  ${row.map((c, i) => (i === row.length - 1 ? c : c.padEnd(widths[i]))).join('  ')}`
      : `  ${row[0].padEnd(widths[0])}  ${row[1]}`;
  return [fmt(header), ...rows.map(fmt)];
}

export function renderTerminal(report: PendingReport, o: RenderOptions): string {
  const sections = report.repos.map((r) => terminalRepo(r, o).join('\n'));
  const parts = report.repos.length > 1 ? [sweepTable(report, o).join('\n'), ...sections] : sections;
  return parts.join('\n\n');
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --import tsx --test tests/pending-report.test.ts`
Expected: `# pass 9`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
npm run typecheck
git add src/utils/pending-report.ts tests/pending-report.test.ts
git commit -m "feat(pending): report model and terminal renderer"
```

---

### Task 6: Markdown and JSON renderers

**Files:**
- Modify: `src/utils/pending-report.ts` (append)
- Test: `tests/pending-report.test.ts` (append)

**Interfaces:**
- Consumes: everything Task 5 defined in the same file; `clickupTaskUrl` from `src/config/slack.ts`.
- Produces:
  ```ts
  export function renderMarkdown(report: PendingReport, o: RenderOptions): string; // ends with "\n"
  export function renderJson(report: PendingReport): string; // Dates as ISO strings
  ```

- [ ] **Step 1: Write the failing tests** — append to `tests/pending-report.test.ts` (add `renderMarkdown, renderJson` to its import):

```ts
test('markdown: one repo with both directions', () => {
  const pull = (n: number): string => `${REPO_URL}/pull/${n}`;
  assert.equal(
    renderMarkdown(fixtureReport(), OPTS),
    [
      '## Vastpay Pwa V2 — staging → production',
      '',
      `### In flight · [hotfix/2.1.15 (#334)](${pull(334)})`,
      '',
      `- [#301](${pull(301)}) **ELM single charge** — One create-charge per sheet · Mostafa Adly · 13d`,
      '',
      '### Waiting (2)',
      '',
      `- [#298](${pull(298)}) Old change · Osama Elshimy · 21d · ⚠ stale`,
      `- [#313](${pull(313)}) **guest token reuse** — Reuse guest tokens without overriding customer sessions · Osama Elshimy · [VA-13091](https://app.clickup.com/t/90121402342/VA-13091) · 9d`,
      '',
      '### Direct commits (1)',
      '',
      '- `46d26d9` fix(pwa): preserve disabled plugin lifecycle · 3d',
      '',
      '### On production, not on staging (2)',
      '',
      `- [#270](${pull(270)}) Include guest token in send-OTP request · Osama Elshimy · 30d · ported (same code)`,
      `- [#332](${pull(332)}) Raise pwa-v2 memory request · Osama Elshimy · 5d · ⚠ not found on staging`,
      '',
    ].join('\n'),
  );
});

test('markdown: in sync and problem repos are one line each', () => {
  const synced = fixtureRepo();
  synced.forward = { ...synced.forward!, inFlight: [], waiting: [], direct: [] };
  synced.reverse = null;
  const skipped: RepoPending = {
    ...fixtureRepo(),
    displayName: 'Vastpay Backend',
    forward: null,
    reverse: null,
    problem: { kind: 'skipped', message: 'no develop branch' },
  };
  assert.equal(
    renderMarkdown(fixtureReport([synced, skipped], false), OPTS),
    '## Vastpay Pwa V2 — staging → production\n\nIn sync.\n\n## Vastpay Backend\n\n_no develop branch_\n',
  );
});

test('markdown --by-ticket nests PRs under linked tickets', () => {
  const out = renderMarkdown(fixtureReport(), { ...OPTS, byTicket: true });
  assert.match(out, /- \*\*\[VA-13091\]\(https:\/\/app\.clickup\.com\/t\/90121402342\/VA-13091\)\*\*\n {2}- \[#313\]/);
  assert.match(out, /- \*\*Untracked\*\*\n {2}- \[#298\]/);
});

test('json round-trips the model with ISO dates', () => {
  const parsed = JSON.parse(renderJson(fixtureReport()));
  assert.equal(parsed.to, 'production');
  assert.equal(parsed.generatedAt, NOW.toISOString());
  assert.equal(parsed.repos[0].forward.waiting[1].number, 313);
  assert.equal(parsed.repos[0].forward.waiting[1].landedAt, daysAgo(9).toISOString());
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --import tsx --test tests/pending-report.test.ts`
Expected: FAIL, `renderMarkdown` / `renderJson` not exported.

- [ ] **Step 3: Implement** — append to `src/utils/pending-report.ts`, and add `import { clickupTaskUrl } from '../config/slack.js';` to its imports:

```ts
function mdPr(p: PendingPr, o: RenderOptions, r: Role, indent = ''): string {
  const age = ageDays(p.landedAt, o.now);
  const text = !o.short && p.phrase ? `**${p.phrase}** — ${p.title}` : p.title;
  const parts = [`[#${p.number}](${p.url}) ${text}`];
  if (p.contributors.length > 0) parts.push(p.contributors.map(personName).join(', '));
  if (p.tickets.length > 0) parts.push(p.tickets.map((t) => `[${t}](${clickupTaskUrl(t)})`).join(', '));
  parts.push(`${age}d`, ...markers(p, age, r));
  return `${indent}- ${parts.join(' · ')}`;
}

function mdCommit(c: PendingCommit, o: RenderOptions, r: Role): string {
  const age = ageDays(c.landedAt, o.now);
  return `- \`${c.sha.slice(0, 7)}\` ${c.subject} · ${[`${age}d`, ...markers(c, age, r)].join(' · ')}`;
}

function mdPrList(prs: PendingPr[], o: RenderOptions, r: Role): string[] {
  if (!o.byTicket) return prs.map((p) => mdPr(p, o, r));
  return groupByTicket(prs).flatMap((g) => [
    `- **${g.ticket ? `[${g.ticket}](${clickupTaskUrl(g.ticket)})` : 'Untracked'}**`,
    ...g.prs.map((p) => mdPr(p, o, r, '  ')),
  ]);
}

function mdRepo(r: RepoPending, o: RenderOptions): string[] {
  const title = r.forward ? `## ${r.displayName} — ${r.forward.source} → ${r.forward.target}` : `## ${r.displayName}`;
  if (r.problem || !r.forward) return [title, '', `_${r.problem?.message ?? ''}_`];
  const f = r.forward;
  const rv = r.reverse;
  if (itemCount(f) === 0 && (!rv || itemCount(rv) === 0)) return [title, '', 'In sync.'];

  const lines = [title];
  const section = (heading: string, body: string[]): void => {
    if (body.length > 0) lines.push('', `### ${heading}`, '', ...body);
  };
  const fwd: Role = { role: 'forward', other: f.target };
  for (const g of f.inFlight) section(`In flight · [${g.branch} (#${g.number})](${g.url})`, mdPrList(g.prs, o, fwd));
  section(`Waiting (${f.waiting.length})`, mdPrList(f.waiting, o, fwd));
  section(`Direct commits (${f.direct.length})`, f.direct.map((c) => mdCommit(c, o, fwd)));
  if (itemCount(f) === 0) lines.push('', `Nothing on ${f.source} that ${f.target} lacks.`);

  if (rv) {
    const back: Role = { role: 'reverse', other: rv.target };
    if (itemCount(rv) === 0) lines.push('', `Nothing on ${rv.source} that ${rv.target} lacks.`);
    else
      section(`On ${rv.source}, not on ${rv.target} (${itemCount(rv)})`, [
        ...mdPrList(prsOf(rv), o, back),
        ...rv.direct.map((c) => mdCommit(c, o, back)),
      ]);
  }
  return lines;
}

/** Ready to paste into a ClickUp doc or a PR description. */
export function renderMarkdown(report: PendingReport, o: RenderOptions): string {
  return `${report.repos.map((r) => mdRepo(r, o).join('\n')).join('\n\n')}\n`;
}

/** For the /release skill and scripts. Dates serialise as ISO strings. */
export function renderJson(report: PendingReport): string {
  return JSON.stringify(report, null, 2);
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --import tsx --test tests/pending-report.test.ts`
Expected: `# pass 13`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
npm run typecheck
git add src/utils/pending-report.ts tests/pending-report.test.ts
git commit -m "feat(pending): markdown and JSON renderers"
```

---

### Task 7: Slack message for the pending list

**Files:**
- Create: `src/utils/pending-slack.ts`
- Test: `tests/pending-slack.test.ts`

**Interfaces:**
- Consumes: `bullet`, `bulletBlocks` (Task 4); `describe`, `namedPeople`, `extractTickets` from `release-message.ts`; `PendingReport`, `PendingPr`, `prsOf` (Task 5); `ShippedPr` from `shipped.ts`; `Contributor`.
- Produces:
  ```ts
  export function pendingContributors(report: PendingReport): Contributor[];
  export function buildPendingSlack(report: PendingReport, mentions: Record<string, string | null>): { text: string; blocks: unknown[] } | null;
  ```

- [ ] **Step 1: Write the failing test** — create `tests/pending-slack.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPendingSlack, pendingContributors } from '../src/utils/pending-slack.js';
import { contributorKey } from '../src/utils/contributors.js';
import { fixtureRepo, fixtureReport, OSAMA, MOSTAFA } from './pending-report.test.js';

const COMPARE = 'https://github.com/Vast-menu/VastPayPwaV2/compare/production...staging';
const clickup = (id: string): string => `https://app.clickup.com/t/90121402342/${id}`;

test('one bullet per repo: phrases in PR order, people, tickets, compare link', () => {
  const msg = buildPendingSlack(fixtureReport(), { [contributorKey(OSAMA)]: 'U2' })!;
  assert.equal(
    msg.text,
    [
      '*Pending for production*',
      `• <${COMPARE}|Vastpay Pwa V2 - staging → production> - Old change, ELM single charge, guest token reuse (<@U2>, @Mostafa Adly) (<${clickup('VA-13091')}|VA-13091>)`,
    ].join('\n'),
  );
  const blocks = msg.blocks as Array<{ elements: Array<{ type: string; elements: Array<{ elements: unknown[] }> }> }>;
  assert.equal(blocks[0].elements[1].type, 'rich_text_list');
  assert.equal(blocks[0].elements[1].elements.length, 1);
  assert.deepEqual(blocks[0].elements[1].elements[0].elements[0], {
    type: 'link',
    url: COMPARE,
    text: 'Vastpay Pwa V2 - staging → production',
  });
});

test('the reverse direction is never posted', () => {
  const msg = buildPendingSlack(fixtureReport(), {})!;
  assert.doesNotMatch(msg.text, /send-OTP|memory request/);
});

test('repos with nothing pending are left out, and nothing at all means no message', () => {
  const empty = fixtureRepo();
  empty.forward = { ...empty.forward!, inFlight: [], waiting: [], direct: [] };
  assert.equal(buildPendingSlack(fixtureReport([empty]), {}), null);
  const msg = buildPendingSlack(fixtureReport([empty, fixtureRepo()]), {})!;
  assert.equal(msg.text.split('\n').length, 2);
});

test('contributors come from the forward direction only', () => {
  const people = pendingContributors(fixtureReport()).map((c) => c.name);
  assert.deepEqual(people.sort(), [MOSTAFA.name, OSAMA.name].sort());
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test tests/pending-slack.test.ts`
Expected: FAIL, cannot find module `../src/utils/pending-slack.js`.

- [ ] **Step 3: Implement** — create `src/utils/pending-slack.ts`:

```ts
/**
 * The pending list as one Slack message: a bold heading, then one bullet per
 * repo in the team's announcement shape, linking GitHub's compare view.
 * Only what the target still lacks is posted — the reverse direction is a
 * question for whoever runs the report, not news for the channel.
 */

import { describe, extractTickets, namedPeople } from './release-message.js';
import { bullet, bulletBlocks, type Bullet } from './slack-rich-text.js';
import { prsOf, type PendingPr, type PendingReport } from './pending-report.js';
import type { ShippedPr } from './shipped.js';
import type { Contributor } from './contributors.js';

function asShipped(p: PendingPr): ShippedPr {
  return { number: p.number, title: p.title, url: p.url, branch: p.branch, contributors: p.contributors };
}

export function pendingContributors(report: PendingReport): Contributor[] {
  return report.repos.flatMap((r) => (r.forward ? prsOf(r.forward).flatMap((p) => p.contributors) : []));
}

export function buildPendingSlack(
  report: PendingReport,
  mentions: Record<string, string | null>,
): { text: string; blocks: unknown[] } | null {
  const bullets: Bullet[] = [];
  for (const r of report.repos) {
    const f = r.forward;
    if (!f) continue;
    const prs = prsOf(f).sort((a, b) => a.number - b.number);
    if (prs.length === 0 && f.direct.length === 0) continue;
    const shipped = prs.map(asShipped);
    const phrases: Record<number, string> = {};
    for (const p of prs) if (p.phrase) phrases[p.number] = p.phrase;
    bullets.push(
      bullet({
        url: r.compareUrl,
        label: `${r.displayName} - ${f.source} → ${f.target}`,
        description: describe(shipped, phrases, f.direct.map((c) => c.subject)),
        people: namedPeople(shipped, mentions),
        tickets: extractTickets(prs.flatMap((p) => p.tickets)),
      }),
    );
  }
  if (bullets.length === 0) return null;
  const heading = `Pending for ${report.to}`;
  return { text: [`*${heading}*`, ...bullets.map((b) => b.text)].join('\n'), blocks: bulletBlocks(bullets, heading) };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --import tsx --test tests/pending-slack.test.ts`
Expected: `# pass 4`, `# fail 0`. (Importing fixtures from `pending-report.test.js` re-registers that file's tests in this run; that is expected and harmless.)

- [ ] **Step 5: Commit**

```bash
npm run typecheck
git add src/utils/pending-slack.ts tests/pending-slack.test.ts
git commit -m "feat(pending): Slack message in the team's bullet shape"
```

---

### Task 8: The command

**Files:**
- Create: `src/commands/pending.ts`
- Modify: `src/cli.ts` (import + `registerPendingCommand(this.program);` right after `registerStatusCommand`)
- Modify: `src/utils/help.ts` (`INSPECT` rows)
- Modify: `tests/help.test.ts` (command list in "help lists every command")
- Test: `tests/pending.test.ts`

**Interfaces:**
- Consumes: `compareBranches`, `Parity`, `PrUnit` (Task 2); `modelPhrases` (Task 3); `buildDirection`, `renderTerminal`, `renderMarkdown`, `renderJson`, report types (Tasks 5-6); `buildPendingSlack`, `pendingContributors` (Task 7); `sweepTargets`, `isSweep` from `src/commands/deploy.ts`; `ghPrLookup`, `prNumbersInRange`, `resolveMentions`, `PrLookup` from `shipped.ts`; `fetchBranches` from `git.ts`; `repoDir` from `config/workspace.ts`; `readSlackToken`, `readSlackChannel`, `slackUserOverride` from `config/slack.ts`; `lookupUserByEmail`, `postMessage` from `utils/slack.ts`; `ORG` from `remote.ts`; `createHeader` from `ui.ts`.
- Produces:
  ```ts
  export interface PendingOptions { to: string; parity: boolean; all: boolean; frontend: boolean; backend: boolean; byTicket: boolean; short: boolean; markdown: boolean; slack: boolean; json: boolean; dir?: string }
  export interface PendingDeps { /* see code */ }
  export const defaultPendingDeps: PendingDeps;
  export function parseOpenReleasePrs(json: string): Array<Omit<OpenReleasePr, 'prNumbers'>>;
  export async function runPending(names: string[], opts: PendingOptions, deps?: PendingDeps): Promise<number>; // exit code
  export function registerPendingCommand(program: Command): void;
  ```

- [ ] **Step 1: Write the failing tests** — create `tests/pending.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Parity, PrUnit } from '../src/utils/parity.js';

// Before any import that reads config: a test must never touch ~/.vast-cli.
process.env.VAST_CLI_HOME = mkdtempSync(join(tmpdir(), 'vast-pending-home-'));
const { runPending, parseOpenReleasePrs } = await import('../src/commands/pending.js');
type Deps = import('../src/commands/pending.js').PendingDeps;
type Opts = import('../src/commands/pending.js').PendingOptions;

const unit = (number: number): PrUnit => ({
  number,
  branch: `fix/change-${number}`,
  sha: `sha${number}`,
  landedAt: new Date('2026-09-20T00:00:00Z'),
  patchId: null,
});

const parityOf = (src: number[], tgt: number[] = []): Parity => ({
  source: 'origin/staging',
  target: 'origin/production',
  onlySource: { prs: src.map(unit), direct: [], ported: new Set() },
  onlyTarget: { prs: tgt.map(unit), direct: [], ported: new Set() },
  sharedPrs: [],
});

function fake(over: Partial<Deps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const posted: unknown[][] = [];
  const calls = { phrases: 0 };
  const deps: Deps = {
    repoDir: () => '/checkout',
    isCheckout: () => true,
    fetchBranches: async () => true,
    compareBranches: () => parityOf([301, 313]),
    prNumbersInRange: () => [301],
    lookupPr: async (_repo, n) => ({
      title: `fix: change ${n}`,
      url: `https://github.com/Vast-menu/VastPayPwaV2/pull/${n}`,
      branch: `fix/change-${n}`,
      contributors: [{ name: 'Osama Elshimy', login: null, emails: ['o@e.com'] }],
    }),
    openReleasePrs: async () => [
      { number: 334, url: 'https://github.com/Vast-menu/VastPayPwaV2/pull/334', branch: 'hotfix/2.1.15' },
    ],
    modelPhrases: async (prs) => {
      calls.phrases++;
      return Object.fromEntries(prs.map((p) => [p.number, `phrase ${p.number}`]));
    },
    readSlackToken: () => null,
    readSlackChannel: () => null,
    slackUserOverride: () => null,
    lookupUserByEmail: async () => null,
    postMessage: async (...args) => {
      posted.push(args);
      return {};
    },
    now: () => new Date('2026-09-24T00:00:00Z'),
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    ...over,
  };
  return { deps, out, err, posted, calls };
}

const OPTS: Opts = {
  to: 'production',
  parity: false,
  all: false,
  frontend: false,
  backend: false,
  byTicket: false,
  short: false,
  markdown: false,
  slack: false,
  json: true,
};

const report = (out: string[]) => JSON.parse(out[out.length - 1]);

test('PRs inside an open hotfix PR are in flight, the rest waiting', async () => {
  const f = fake();
  assert.equal(await runPending(['VastPayPwaV2'], OPTS, f.deps), 0);
  const fwd = report(f.out).repos[0].forward;
  assert.deepEqual(fwd.inFlight.map((g: { number: number }) => g.number), [334]);
  assert.deepEqual(fwd.inFlight[0].prs.map((p: { number: number }) => p.number), [301]);
  assert.deepEqual(fwd.waiting.map((p: { number: number }) => p.number), [313]);
  assert.equal(fwd.waiting[0].phrase, 'phrase 313');
});

test('--json prints nothing but the JSON', async () => {
  const f = fake();
  await runPending(['VastPayPwaV2'], OPTS, f.deps);
  assert.equal(f.out.length, 1);
  assert.doesNotThrow(() => JSON.parse(f.out[0]));
});

test('--to staging compares develop with staging and skips a repo with no develop', async () => {
  const branches: string[][] = [];
  const f = fake({ fetchBranches: async (_d, b) => (branches.push(b), true) });
  assert.equal(await runPending(['VastPayPwaV2', 'VastPay-BackEnd'], { ...OPTS, to: 'staging' }, f.deps), 0);
  const repos = report(f.out).repos;
  assert.equal(repos[0].forward.source, 'develop');
  assert.equal(repos[0].forward.target, 'staging');
  assert.deepEqual(repos[0].forward.inFlight, []);
  assert.deepEqual(repos[1].problem, { kind: 'skipped', message: 'no develop branch' });
  assert.deepEqual(branches, [['develop', 'staging']]);
});

test('a named repo that is not cloned fails the run; a swept one is skipped', async () => {
  const named = fake({ isCheckout: () => false });
  assert.equal(await runPending(['VastPayPwaV2'], OPTS, named.deps), 1);
  assert.equal(report(named.out).repos[0].problem.kind, 'error');

  const swept = fake({ isCheckout: () => false });
  assert.equal(await runPending([], { ...OPTS, frontend: true }, swept.deps), 0);
  for (const r of report(swept.out).repos) assert.equal(r.problem.kind, 'skipped');
});

test('--short makes no model call unless Slack needs the phrases', async () => {
  const short = fake();
  await runPending(['VastPayPwaV2'], { ...OPTS, short: true }, short.deps);
  assert.equal(short.calls.phrases, 0);

  const shortSlack = fake();
  await runPending(['VastPayPwaV2'], { ...OPTS, short: true, slack: true }, shortSlack.deps);
  assert.equal(shortSlack.calls.phrases, 1);
});

test('open release PRs that cannot be listed cost only the In flight section', async () => {
  const f = fake({
    openReleasePrs: async () => {
      throw new Error('gh down');
    },
  });
  assert.equal(await runPending(['VastPayPwaV2'], OPTS, f.deps), 0);
  const r = report(f.out).repos[0];
  assert.deepEqual(r.forward.inFlight, []);
  assert.deepEqual(r.forward.waiting.map((p: { number: number }) => p.number), [301, 313]);
  assert.equal(r.notes.length, 1);
});

test('a PR gh cannot read is still listed', async () => {
  const f = fake({ lookupPr: async (_r, n) => (n === 313 ? null : fake().deps.lookupPr('x', n)) });
  await runPending(['VastPayPwaV2'], OPTS, f.deps);
  const p313 = report(f.out).repos[0].forward.waiting[0];
  assert.equal(p313.detailsUnavailable, true);
  assert.equal(p313.title, 'fix/change-313');
});

test('--parity adds the reverse direction', async () => {
  const f = fake({ compareBranches: () => parityOf([313], [270]) });
  await runPending(['VastPayPwaV2'], { ...OPTS, parity: true }, f.deps);
  const r = report(f.out).repos[0];
  assert.equal(r.reverse.source, 'production');
  assert.equal(r.reverse.target, 'staging');
  assert.deepEqual(r.reverse.waiting.map((p: { number: number }) => p.number), [270]);
});

test('a failed fetch is an error for that repo only', async () => {
  const f = fake({ fetchBranches: async () => false });
  assert.equal(await runPending(['VastPayPwaV2'], OPTS, f.deps), 1);
  assert.deepEqual(report(f.out).repos[0].problem, { kind: 'error', message: 'fetch failed' });
});

test('--slack without configuration prints the message and fails', async () => {
  const f = fake();
  assert.equal(await runPending(['VastPayPwaV2'], { ...OPTS, json: false, slack: true }, f.deps), 1);
  assert.ok(f.out.some((l) => l.includes('Slack not configured — run vast slack setup')));
  assert.equal(f.posted.length, 0);
});

test('--slack posts text and blocks when configured', async () => {
  const f = fake({ readSlackToken: () => 'xoxb-test', readSlackChannel: () => 'C123' });
  assert.equal(await runPending(['VastPayPwaV2'], { ...OPTS, json: false, slack: true }, f.deps), 0);
  assert.equal(f.posted.length, 1);
  assert.equal(f.posted[0][1], 'C123');
  assert.match(String(f.posted[0][2]), /^\*Pending for production\*\n• </);
  assert.ok(Array.isArray(f.posted[0][3]));
});

test('a failed Slack post still prints the report and fails', async () => {
  const f = fake({
    readSlackToken: () => 'xoxb-test',
    readSlackChannel: () => 'C123',
    postMessage: async () => {
      throw new Error('channel_not_found');
    },
  });
  assert.equal(await runPending(['VastPayPwaV2'], { ...OPTS, json: false, slack: true }, f.deps), 1);
  assert.ok(f.out.some((l) => l.includes('Slack post failed: channel_not_found')));
});

test('nothing pending posts nothing and succeeds', async () => {
  const f = fake({
    compareBranches: () => parityOf([]),
    readSlackToken: () => 'xoxb-test',
    readSlackChannel: () => 'C123',
  });
  assert.equal(await runPending(['VastPayPwaV2'], { ...OPTS, json: false, slack: true }, f.deps), 0);
  assert.equal(f.posted.length, 0);
});

test('an unknown repository or a bad --to fails before any work', async () => {
  const f = fake();
  assert.equal(await runPending(['Nope'], OPTS, f.deps), 1);
  assert.equal(await runPending(['VastPayPwaV2'], { ...OPTS, to: 'qa' }, f.deps), 1);
  assert.equal(f.out.length, 0);
});

test('parseOpenReleasePrs keeps release and hotfix heads, by number', () => {
  const rows = parseOpenReleasePrs(
    JSON.stringify([
      { number: 340, headRefName: 'release/2.2.0', url: 'u340' },
      { number: 12, headRefName: 'feat/x', url: 'u12' },
      { number: 334, headRefName: 'hotfix/2.1.15', url: 'u334' },
    ]),
  );
  assert.deepEqual(rows, [
    { number: 334, url: 'u334', branch: 'hotfix/2.1.15' },
    { number: 340, url: 'u340', branch: 'release/2.2.0' },
  ]);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --import tsx --test tests/pending.test.ts`
Expected: FAIL, cannot find module `../src/commands/pending.js`.

- [ ] **Step 3: Implement** — create `src/commands/pending.ts`:

```ts
/**
 * Pending Command
 *
 * Read-only. Lists what one branch has that the next one lacks — staging vs
 * production by default, develop vs staging with --to staging — by PR, not
 * by commit, and with --parity both ways. The only thing it ever writes is a
 * Slack post, and only with --slack.
 */

import { Command } from 'commander';
import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import type { RepoConfig } from '../config/repos.js';
import { repoDir } from '../config/workspace.js';
import { readSlackChannel, readSlackToken, slackUserOverride } from '../config/slack.js';
import { isSweep, sweepTargets } from './deploy.js';
import { fetchBranches } from '../utils/git.js';
import { compareBranches, type Parity } from '../utils/parity.js';
import { ghPrLookup, prNumbersInRange, resolveMentions, type PrLookup } from '../utils/shipped.js';
import { modelPhrases } from '../utils/pr-summary.js';
import { lookupUserByEmail, postMessage } from '../utils/slack.js';
import { ORG } from '../utils/remote.js';
import { createHeader } from '../utils/ui.js';
import {
  buildDirection,
  renderJson,
  renderMarkdown,
  renderTerminal,
  type OpenReleasePr,
  type PendingReport,
  type PendingTo,
  type PrDetails,
  type RepoPending,
} from '../utils/pending-report.js';
import { buildPendingSlack, pendingContributors } from '../utils/pending-slack.js';

const execFileAsync = promisify(execFile);

export interface PendingOptions {
  to: string;
  parity: boolean;
  all: boolean;
  frontend: boolean;
  backend: boolean;
  byTicket: boolean;
  short: boolean;
  markdown: boolean;
  slack: boolean;
  json: boolean;
  dir?: string;
}

type ReleaseHead = Omit<OpenReleasePr, 'prNumbers'>;

/** Everything that touches the world, so the whole command runs in tests. */
export interface PendingDeps {
  repoDir: (repo: RepoConfig, override?: string) => string | null;
  isCheckout: (dir: string) => boolean;
  fetchBranches: (dir: string, branches: string[]) => Promise<boolean>;
  compareBranches: (dir: string, source: string, target: string) => Parity;
  prNumbersInRange: (dir: string, base: string, head: string) => number[];
  lookupPr: PrLookup;
  openReleasePrs: (repo: string) => Promise<ReleaseHead[]>;
  modelPhrases: (prs: Array<{ number: number; title: string; branch: string }>) => Promise<Record<number, string>>;
  readSlackToken: () => string | null;
  readSlackChannel: () => string | null;
  slackUserOverride: (login: string) => string | null;
  lookupUserByEmail: (token: string, email: string) => Promise<string | null>;
  postMessage: (token: string, channel: string, text: string, blocks: unknown[]) => Promise<unknown>;
  now: () => Date;
  out: (text: string) => void;
  err: (text: string) => void;
}

export function parseOpenReleasePrs(json: string): ReleaseHead[] {
  const rows = JSON.parse(json) as Array<{ number: number; headRefName: string; url: string }>;
  return rows
    .filter((r) => /^(release|hotfix)\//.test(r.headRefName))
    .map((r) => ({ number: r.number, url: r.url, branch: r.headRefName }))
    .sort((a, b) => a.number - b.number);
}

async function ghOpenReleasePrs(repo: string): Promise<ReleaseHead[]> {
  const { stdout } = await execFileAsync(
    'gh',
    ['pr', 'list', '--repo', `${ORG}/${repo}`, '--base', 'production', '--state', 'open', '--json', 'number,headRefName,url'],
    { encoding: 'utf-8' },
  );
  return parseOpenReleasePrs(stdout);
}

export const defaultPendingDeps: PendingDeps = {
  repoDir,
  isCheckout: (dir) => existsSync(join(dir, '.git')),
  fetchBranches,
  compareBranches,
  prNumbersInRange,
  lookupPr: ghPrLookup,
  openReleasePrs: ghOpenReleasePrs,
  modelPhrases: (prs) => modelPhrases(prs),
  readSlackToken,
  readSlackChannel,
  slackUserOverride,
  lookupUserByEmail: (token, email) => lookupUserByEmail(token, email),
  postMessage: (token, channel, text, blocks) => postMessage(token, channel, text, fetch, blocks),
  now: () => new Date(),
  out: (text) => console.log(text),
  err: (text) => console.error(text),
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function collectOne(
  repo: RepoConfig,
  to: PendingTo,
  opts: PendingOptions,
  sweep: boolean,
  deps: PendingDeps,
): Promise<RepoPending> {
  const source = to === 'production' ? 'staging' : repo.promoteFrom.staging;
  const target: string = to;
  const repoUrl = `https://github.com/${ORG}/${repo.name}`;
  const base = {
    repo: repo.name,
    displayName: repo.displayName,
    compareUrl: source ? `${repoUrl}/compare/${target}...${source}` : '',
    forward: null,
    reverse: null,
    notes: [] as string[],
  };
  const problem = (kind: 'skipped' | 'error', text: string): RepoPending => ({ ...base, problem: { kind, message: text } });

  // The backend repos have no develop at all; that is a fact, not a failure.
  if (!source) return problem('skipped', 'no develop branch');
  const dir = deps.repoDir(repo, opts.dir);
  // As `vast release` does: a repo the user named must be here; one a sweep
  // merely passed over is skipped.
  if (!dir || !deps.isCheckout(dir)) return problem(sweep ? 'skipped' : 'error', 'not cloned — run vast clone');

  let heads: ReleaseHead[] = [];
  if (to === 'production') {
    try {
      heads = await deps.openReleasePrs(repo.name);
    } catch {
      base.notes.push('could not list open release PRs — nothing shown as in flight');
    }
  }

  if (!(await deps.fetchBranches(dir, [source, target, ...heads.map((h) => h.branch)]))) {
    return problem('error', 'fetch failed');
  }

  let parity: Parity;
  try {
    parity = deps.compareBranches(dir, `origin/${source}`, `origin/${target}`);
  } catch (error) {
    return problem('error', `could not compare branches: ${message(error)}`);
  }

  const openReleases: OpenReleasePr[] = heads.map((h) => ({
    ...h,
    prNumbers: deps.prNumbersInRange(dir, `origin/${target}`, `origin/${h.branch}`),
  }));

  const units = [...parity.onlySource.prs, ...(opts.parity ? parity.onlyTarget.prs : [])];
  const details = new Map<number, PrDetails>();
  await Promise.all(
    units.map(async (u) => {
      try {
        const d = await deps.lookupPr(repo.name, u.number);
        if (d) details.set(u.number, d);
      } catch {
        // Shown as "details unavailable" rather than dropped.
      }
    }),
  );

  // --short skips the model for display, but a Slack post always carries phrases.
  const phrases =
    !opts.short || opts.slack
      ? await deps.modelPhrases(
          units.map((u) => ({
            number: u.number,
            title: details.get(u.number)?.title ?? u.branch,
            branch: details.get(u.number)?.branch ?? u.branch,
          })),
        )
      : {};

  return {
    ...base,
    problem: null,
    forward: buildDirection({ source, target, side: parity.onlySource, details, phrases, openReleases, repoUrl }),
    reverse: opts.parity
      ? buildDirection({ source: target, target: source, side: parity.onlyTarget, details, phrases, openReleases: [], repoUrl })
      : null,
  };
}

/** Post the forward list. Returns false when a post was asked for and did not happen. */
async function postPending(report: PendingReport, deps: PendingDeps, say: (t: string) => void): Promise<boolean> {
  const token = deps.readSlackToken();
  const channel = deps.readSlackChannel();
  const mentions = await resolveMentions(pendingContributors(report), {
    token,
    lookup: deps.lookupUserByEmail,
    override: deps.slackUserOverride,
  });
  const msg = buildPendingSlack(report, mentions);
  if (!msg) {
    say('Nothing pending — nothing posted to Slack.');
    return true;
  }
  if (!token || !channel) {
    say(msg.text);
    say('Slack not configured — run vast slack setup');
    return false;
  }
  try {
    await deps.postMessage(token, channel, msg.text, msg.blocks);
    say('Posted to Slack.');
    return true;
  } catch (error) {
    say(msg.text);
    say(`Slack post failed: ${message(error)}`);
    return false;
  }
}

const MARKDOWN_START = '──── markdown ────';
const MARKDOWN_END = '──── end markdown ────';

export async function runPending(
  names: string[],
  opts: PendingOptions,
  deps: PendingDeps = defaultPendingDeps,
): Promise<number> {
  if (opts.to !== 'production' && opts.to !== 'staging') {
    deps.err(`--to must be production or staging, not "${opts.to}"`);
    return 1;
  }
  const to: PendingTo = opts.to;
  const { repos, unknown } = sweepTargets(names, opts);
  if (unknown.length > 0) {
    deps.err(`Unknown ${unknown.length === 1 ? 'repository' : 'repositories'}: ${unknown.join(', ')}`);
    return 1;
  }
  if (repos.length === 0) {
    deps.err('Specify a repository, or --all / --frontend / --backend');
    return 1;
  }

  // With --json, stdout carries the JSON and nothing else.
  const say = opts.json ? deps.err : deps.out;
  if (!opts.json) {
    deps.out(createHeader('Pending', `${repos.length} repo(s) | ${to === 'production' ? 'staging → production' : 'develop → staging'}`));
  }

  const sweep = isSweep(opts);
  const report: PendingReport = {
    to,
    generatedAt: deps.now(),
    parity: opts.parity,
    repos: await Promise.all(repos.map((r) => collectOne(r, to, opts, sweep, deps))),
  };
  const render = { now: report.generatedAt, byTicket: opts.byTicket, short: opts.short };

  if (opts.json) {
    deps.out(renderJson(report));
  } else {
    deps.out(renderTerminal(report, render));
    if (opts.markdown) deps.out(['', MARKDOWN_START, renderMarkdown(report, render), MARKDOWN_END].join('\n'));
  }
  for (const r of report.repos) for (const note of r.notes) say(`  ${r.repo}: ${note}`);

  let code = report.repos.some((r) => r.problem?.kind === 'error') ? 1 : 0;
  // Unlike promote, where the PR is already open, the post is the thing asked for.
  if (opts.slack && !(await postPending(report, deps, say))) code = 1;
  return code;
}

export function registerPendingCommand(program: Command): void {
  program
    .command('pending')
    .description('What staging has that production lacks (or develop vs staging), by PR')
    .argument('[repositories...]', 'Repository name(s) (omit and pass --all, --frontend or --backend)')
    .option('-t, --to <env>', 'production: staging vs production; staging: develop vs staging', 'production')
    .option('--parity', 'Also list what the target has that the source lacks', false)
    .option('-a, --all', 'Every repo on a release train', false)
    .option('--frontend', 'The frontend repos', false)
    .option('--backend', 'The backend repos', false)
    .option('--by-ticket', 'Group PRs by ClickUp ticket', false)
    .option('--short', 'PR titles only, no model call', false)
    .option('--markdown', 'Also print the report as markdown', false)
    .option('--slack', 'Post the pending list to the Slack channel', false)
    .option('--json', 'Print the report as JSON and nothing else', false)
    .option('--dir <path>', 'Override the local checkout path (one repo only)')
    .addHelpText(
      'after',
      `
Examples:
  $ vast pending VastPayPwa                  staging PRs production lacks
  $ vast pending VastPayPwa --parity         ...and production PRs staging lacks
  $ vast pending VastPayPwa --to staging     develop PRs staging lacks
  $ vast pending --all --short               every repo, titles only
  $ vast pending --frontend --slack          post the frontend queue to Slack
  $ vast pending VastPayPwa --markdown       also print markdown to paste
  $ vast pending VastPayPwa --json           machine-readable

Reads only. It fetches and reports, and changes nothing; --slack posts one
message and that is all.

How items are matched:
  By PR number, read from "Merge pull request #N" subjects on each side, so a
  PR cherry-picked into a hotfix counts as present. Release, hotfix and bump
  PRs are left out, as are version bumps and Helm-values-only commits.
  Anything left on one side is checked by code content:
    ported (same code)      the same change is on the other side under
                            another commit
    not found on <branch>   no match by PR or by code. Not proof it is
                            missing: a port-back that needed conflict fixes
                            has different code
  "In flight" lists PRs already inside an open release/hotfix PR.
  "stale" marks work waiting more than 14 days.
`,
    )
    .action(async (names: string[], opts: PendingOptions) => {
      process.exitCode = await runPending(names, opts);
    });
}
```

- [ ] **Step 4: Register it and list it in help**

In `src/cli.ts`, add `import { registerPendingCommand } from './commands/pending.js';` beside the other command imports, and `registerPendingCommand(this.program);` on the line after `registerStatusCommand(this.program);`.

In `src/utils/help.ts`, change `INSPECT` to:

```ts
const INSPECT: Row[] = [
  { left: 'status', right: 'Deployed versions and branch drift, all repos' },
  { left: 'pending', right: 'What staging has that production lacks, by PR' },
];
```

In `tests/help.test.ts`, add `'pending'` to the array in `help lists every command`.

- [ ] **Step 5: Run the command tests, then everything**

Run: `node --import tsx --test tests/pending.test.ts tests/help.test.ts`
Expected: `# fail 0`.

Run: `npm test 2>&1 | grep -E "^# (pass|fail)" && npm run typecheck`
Expected: `# fail 0`, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/commands/pending.ts src/cli.ts src/utils/help.ts tests/pending.test.ts tests/help.test.ts
git commit -m "feat(pending): vast pending command"
```

---

### Task 9: Build, live read-only check, docs

**Files:**
- Modify: `README.md` (Commands table at line ~150; new section after `### Reading \`vast status\``)
- Modify: `skills/release/SKILL.md` (after the "Reading `vast status`" paragraph in §0; §5 Production)
- Modify: `CLAUDE.md` (new `## vast pending` section before `## Slack announcements`)
- Rebuild: `dist/`

**Interfaces:**
- Consumes: the built CLI.
- Produces: docs and `dist/` matching `node bin/vast.js pending --help`.

- [ ] **Step 1: Build and read the real help**

Run: `npm run build && node bin/vast.js pending --help && node bin/vast.js --help | grep pending`
Expected: the options and help text from Task 8; root help lists `pending`.

- [ ] **Step 2: Live read-only runs (never `--slack`)**

```bash
node bin/vast.js pending VastPayPwaV2 --parity
node bin/vast.js pending VastPayPwaV2 --to staging --parity --short
node bin/vast.js pending --all --short
node bin/vast.js pending VastPayPwaV2 --by-ticket --markdown --short
node bin/vast.js pending VastPayPwaV2 --json --short | node -e "JSON.parse(require('fs').readFileSync(0,'utf8')); console.log('json ok')"
```

Expected on VastPayPwaV2 (state as of 2026-09-24; later merges may add PRs): In flight under `hotfix/2.1.15 (#334, open)` holding #301, #313, #316, #318, #321, #328; the rest of the 30 staging-only PRs under Waiting; with `--parity`, production-only items including #270, #325, #332 and the two cashback patches (#279, #281), with no `release/*`, `hotfix/*` or `bump-prod-*` PR listed; `json ok`. Record the actual output in the PR description. If a number is off, fix the cause in `parity.ts` with a new fixture test before continuing.

- [ ] **Step 3: README** — add a row to the Commands table after `vast status`:

```markdown
| `vast pending` | What staging has that production lacks (or develop vs staging), by PR — `--parity` both ways |
```

and add this section after `### Reading \`vast status\``:

````markdown
### What's waiting: `vast pending`

```bash
vast pending VastPayPwa                 # staging PRs production lacks
vast pending VastPayPwa --parity        # ...and production PRs staging lacks
vast pending VastPayPwa --to staging    # develop PRs staging lacks (what the next promote carries)
vast pending --all --short              # every repo, one summary table, titles only
```

It compares **by PR, not by commit**: PR numbers are read from the
`Merge pull request #N` subjects on each side, so a PR cherry-picked into a hotfix
counts as present. Release, hotfix and bump PRs are left out, as are version bumps
and Helm-values-only commits. PRs already inside an open release/hotfix PR are
listed as **In flight**; anything waiting more than 14 days is marked **stale**.

`--parity` adds the other direction: on production but not staging (fixes that went
straight to production), or with `--to staging`, on staging but not develop.
Anything found on one side only is also checked by code content. **`ported (same
code)`** means the same change is on the other side under another commit.
**`not found on <branch>`** is not proof it is missing: a port-back that needed
conflict fixes has different code, so check it by hand.

Each PR shows a 2-3 word phrase from your local `claude` plus its title; `--short`
shows titles only and skips the model (so does a machine without `claude`).
`--by-ticket` groups PRs under their ClickUp tickets.

| Flag | Output |
|---|---|
| (none) | Terminal report |
| `--markdown` | Also prints the report as markdown, ready to paste |
| `--slack` | Posts one message to the Slack channel from `vast slack setup`: one bullet per repo, the source-not-target direction only. Exits 1 if it cannot post |
| `--json` | The report as JSON and nothing else, for scripts and the `/release` skill |
````

- [ ] **Step 4: SKILL.md** — after the "**Reading `vast status`.**" paragraph in §0, add:

```markdown
**Reading `vast pending`.** `vast pending <repo>` (or `--all`, `--frontend`, `--backend`)
is read-only and is the right way to answer "what goes in the next release?" or "what
is waiting?". Use `--json` when you need to reason over it. It compares by PR:
**In flight** means the PR is already inside an open release/hotfix PR, so do not
pick it again; **stale** means it has waited more than 14 days. With `--parity`, a
production-only item marked `ported (same code)` is fine, and one marked `not found
on staging` needs a human check, not a claim that it is missing: a port-back that
needed conflict fixes has different code. `--to staging` does the same for develop
vs staging. Never add `--slack` unless the user asked for it to be posted.
```

and in §5 Production, before the first command that cuts a production PR, add:

```markdown
Before cutting a release or hotfix PR, run `vast pending <repo> --json` and tell the
user what is waiting and what is already in flight, so nothing is picked twice.
```

- [ ] **Step 5: CLAUDE.md** — add before `## Slack announcements`:

```markdown
## vast pending

- Read-only report of what one branch has that the next lacks: `--to production`
  (default) is staging vs production, `--to staging` is develop vs staging;
  `--parity` adds the reverse. The two `*-BackEnd` repos have no develop and are
  skipped under `--to staging`.
- Compared **by PR number** from `Merge pull request #N` subjects on every commit
  (`src/utils/parity.ts`), never by commit: a `--pick` hotfix carries PRs as
  cherry-picked merges. Vehicles (`release/*`, `hotfix/*`, `bump-*`) and
  bookkeeping (version bumps, Helm-values-only commits) are dropped; the rules
  live in `src/utils/pr-subject.ts`, shared with the release announcement.
- Items left on one side are checked by patch-id: `ported (same code)`. The
  limit is deliberate wording: a conflict-resolved port-back reads `not found
  on <branch>`, never "missing".
- `--slack` posts the forward direction only, one bullet per repo in the
  announcement's shape (`src/utils/slack-rich-text.ts`), and exits 1 if it
  cannot post. Never run it live while developing: `~/.vast-cli/slack.json`
  exists and it would post to the team channel.
```

- [ ] **Step 6: Verify docs against the CLI**

Run: `node bin/vast.js pending --help` and confirm every flag named in the README section, SKILL.md paragraph and CLAUDE.md section appears there (`--to`, `--parity`, `--all`, `--frontend`, `--backend`, `--by-ticket`, `--short`, `--markdown`, `--slack`, `--json`, `--dir`).

- [ ] **Step 7: Full check and commit**

```bash
npm test 2>&1 | grep -E "^# (pass|fail)"
npm run typecheck
npm run bundle && node build/vast.mjs pending --help | head -3
git add README.md skills/release/SKILL.md CLAUDE.md dist
git commit -m "docs(pending): document vast pending; rebuild dist"
```

Expected: `# fail 0`, typecheck clean, the bundle prints the usage line.

---

### Task 10: PR, merge, release 2.5.0 (only after Mostafa says ship)

- [ ] **Step 1: Push and open the PR**

```bash
git push -u origin feat/vast-pending
gh pr create --title "feat: vast pending — what staging has that production lacks, by PR" --body "<summary, the live output from Task 9 Step 2, test count>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 2: Merge and confirm**

```bash
gh pr merge <number> --merge
gh pr view <number> --json state -q .state
```

Expected: `MERGED`.

- [ ] **Step 3: Release**

```bash
git checkout main && git pull && git branch -d feat/vast-pending
npm version minor && git push --follow-tags
```

Expected: tag `v2.5.0`; commit message `2.5.0` with no attribution lines (`git log -1 --format=%B`).

- [ ] **Step 4: Verify the release by tag, not by a piped watch**

```bash
gh run list --workflow release --json databaseId,headBranch,status,conclusion -q '.[] | select(.headBranch=="v2.5.0")'
gh release view v2.5.0 --json tagName,assets -q '.tagName + " " + (.assets|map(.name)|join(","))'
```

Expected: `"conclusion":"success"` and `v2.5.0 vast.mjs`. Then `vast upgrade && vast --version` prints `2.5.0` (plain `vast upgrade`; `--check` reads a daily cache).

- [ ] **Step 5: Memory** — add a line to the project memory noting `vast pending` shipped in 2.5.0 and the VastPayPwaV2 production-only items it surfaced (#270, #325, #332, #279, #281) as a follow-up for Mostafa.
