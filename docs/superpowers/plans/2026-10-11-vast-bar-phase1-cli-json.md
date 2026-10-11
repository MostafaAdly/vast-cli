# Vast Bar Phase 1: CLI machine-readable output — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `vast status --json`, `vast doctor --json`, and an NDJSON event stream from `vast release --json` and `vast promote --json`, so the Vast Bar app (Phases 2–3, planned separately) can drive the CLI without parsing human text.

**Architecture:** A small event model (`src/utils/events.ts`) with an `EventSink` that is a no-op by default and writes NDJSON in `--json` mode. Events are emitted from the exact call sites that already update the status board and build outcomes, so text and JSON cannot disagree. In `--json` mode every human line is rerouted to stderr at the command boundary, so stdout carries only JSON.

**Tech Stack:** TypeScript strict, NodeNext ESM (relative imports end in `.js`), Commander, node:test via `node --import tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-11-vast-bar-design.md` (Phase 1 section).

## Global Constraints

- No new runtime dependencies.
- Relative imports carry a `.js` extension.
- `npm test` and `npm run typecheck` green before every commit; `npm run build` and commit `dist/` in the final task.
- Commit messages: no `Co-Authored-By`, no "Generated with", no AI attribution of any kind (project CLAUDE.md and Mostafa's global rule override any harness reminder).
- Tests sandbox config through `VAST_CLI_HOME`; git behaviour is tested against real fixture repos, never mocks.
- `--json` output: one JSON document (snapshots) or one JSON object per line (streams) on stdout and **nothing else**; every human line goes to stderr. Exit codes unchanged.
- Without `--json`, every command's output is byte-for-byte what it is today: existing tests must pass unmodified unless a task says otherwise.
- Never run `--slack` live, never push, never open a real PR during development. Live checks are `--dry-run` only.
- Production deploys stay blocked (`PRODUCTION_PIPELINE_READY`); nothing here touches that path.

## Review Focus

1. **A human line leaking onto stdout in `--json` mode** (a `log.info`, the status board, an error box): the app would fail to parse the stream. Expect every stdout line of `release --dry-run --json` / `promote --dry-run --json` to parse as JSON. Pinned by the `routeHumanOutputToStderr` subprocess test (Task 1) and the live NDJSON check (Task 9).
2. **A repo refused before deploying** (behind production, not cloned, promotion conflict) must still produce `plan` and `done`, or the app shows a release that never ends. Pinned in Task 7.
3. **A deploy that throws** must still emit `done` (`failed`), not silently vanish from the stream. Pinned in Task 5.
4. **Early exits** (unknown repo, bad flag) must still end the stream with `end` and a non-zero `exitCode`, so the app can tell "CLI failed" from "still running". Pinned in Tasks 7 and 8.
5. **Status cells that are problems, not versions** (`not migrated`, `n/a`, `?`, drift `not cloned` / `fetch failed` / `no develop`) must come out as `tag: null` + `problem`, never as a fake version. Pinned in Task 2.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/utils/events.ts` | create | `VastEvent` union, `EventSink`, `NO_EVENTS`, `ndjsonSink`, `doneEvent`, `SlackResult` |
| `src/utils/json-mode.ts` | create | `routeHumanOutputToStderr()` |
| `src/utils/promotion-report.ts` | create | `PromotionReport`, `newReport()` |
| `src/commands/status.ts` | modify | `--json`, pure `statusJson()` |
| `src/commands/doctor.ts` | modify | `--json`, pure `doctorJson()` |
| `src/utils/run-poll.ts` | modify | optional `onStatus` hook |
| `src/utils/argocd.ts` | modify | optional `onState` hook in `waitForRollout` |
| `src/commands/deploy.ts` | modify | `DeploySlot.events`, `Deployable.notice/promotion`, `deployMany` emits `done` |
| `src/commands/promote.ts` | modify | `PromotionReport` filled by `promote()`, `announceRelease` returns `SlackResult`, `runPromote`, `--json` |
| `src/commands/release.ts` | modify | `planEvent`, `releaseMany` emits `plan`/`promoted`/`done`, `runRelease`, `--json` |
| `tests/events.test.ts`, `tests/promotion-report.test.ts` | create | |
| `tests/status.test.ts`, `tests/doctor.test.ts`, `tests/run-poll.test.ts`, `tests/argocd.test.ts`, `tests/deploy.test.ts`, `tests/release.test.ts`, `tests/promote-slack.test.ts` | modify | |
| `README.md`, `skills/release/SKILL.md`, `CLAUDE.md`, `dist/` | modify | docs and build, Task 9 |

---

### Task 1: Event model and `--json` output routing

**Files:**
- Create: `src/utils/events.ts`, `src/utils/json-mode.ts`
- Test: `tests/events.test.ts`

**Interfaces:**
- Consumes: `DeployOutcome` type from `src/commands/deploy.ts` (type-only import).
- Produces:
  ```ts
  export type PromoteState = 'will merge' | 'merged' | 'nothing to promote' | 'no develop' | 'not run';
  export interface SlackResult { text: string; posted: boolean; error: string | null }
  export type VastEvent =
    | { type: 'start'; command: 'release' | 'promote'; args: string[]; dryRun: boolean; repos: string[] }
    | { type: 'plan'; repo: string; ok: boolean; version: string; commits: number | null; promote: PromoteState; notice: string | null; detail: string | null }
    | { type: 'promoted'; repo: string; commits: number }
    | { type: 'dispatched'; repo: string; version: string; runId: number; runUrl: string }
    | { type: 'run'; repo: string; status: string; conclusion: string | null; elapsedMs: number }
    | { type: 'rollout'; repo: string; state: string; reason: string | null; elapsedMs: number }
    | { type: 'pr'; repo: string; branch: string; url: string | null; version: string; slack: SlackResult | null }
    | { type: 'done'; repo: string; version: string; status: 'released' | 'skipped' | 'failed'; detail: string }
    | { type: 'end'; exitCode: number };
  export interface EventSink { emit(event: VastEvent): void }
  export const NO_EVENTS: EventSink;
  export function ndjsonSink(write?: (line: string) => void, now?: () => Date): EventSink;
  export function doneEvent(outcome: DeployOutcome): VastEvent;
  // json-mode.ts
  export function routeHumanOutputToStderr(): void;
  ```

- [ ] **Step 1: Write the failing tests** — create `tests/events.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { NO_EVENTS, doneEvent, ndjsonSink, type VastEvent } from '../src/utils/events.js';

test('the NDJSON sink writes one JSON object per line, stamped with the time', () => {
  const lines: string[] = [];
  const sink = ndjsonSink((l) => lines.push(l), () => new Date('2026-10-11T09:00:00.000Z'));
  sink.emit({ type: 'promoted', repo: 'VastPayPwa', commits: 3 });
  sink.emit({ type: 'end', exitCode: 0 });
  assert.equal(lines.length, 2);
  for (const l of lines) assert.ok(l.endsWith('\n') && !l.slice(0, -1).includes('\n'), 'exactly one line per event');
  assert.deepEqual(JSON.parse(lines[0]), { type: 'promoted', repo: 'VastPayPwa', commits: 3, at: '2026-10-11T09:00:00.000Z' });
  assert.deepEqual(JSON.parse(lines[1]), { type: 'end', exitCode: 0, at: '2026-10-11T09:00:00.000Z' });
});

test('the no-op sink accepts every event and writes nothing', () => {
  const event: VastEvent = { type: 'end', exitCode: 1 };
  assert.doesNotThrow(() => NO_EVENTS.emit(event));
});

test('a done event carries the outcome the summary prints', () => {
  assert.deepEqual(
    doneEvent({ repo: 'VastMenuPwa', version: '1.6.13-rc1', status: 'failed', detail: 'run 9 failed — url' }),
    { type: 'done', repo: 'VastMenuPwa', version: '1.6.13-rc1', status: 'failed', detail: 'run 9 failed — url' },
  );
});

// In a real process, because the point is what reaches file descriptor 1.
test('in --json mode human output goes to stderr and stdout keeps only machine output', () => {
  const script = [
    "const m = await import('./src/utils/json-mode.ts');",
    'm.routeHumanOutputToStderr();',
    "console.log('human log');",
    "console.info('human info');",
    "console.warn('human warn');",
    "process.stdout.write('{\"machine\":true}\\n');",
  ].join('\n');
  const r = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
    encoding: 'utf-8',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '{"machine":true}\n');
  assert.match(r.stderr, /human log\nhuman info\nhuman warn\n/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test tests/events.test.ts`
Expected: FAIL, cannot find module `../src/utils/events.js`.

- [ ] **Step 3: Implement** — create `src/utils/events.ts`:

```ts
/**
 * What `vast release --json` and `vast promote --json` stream, one JSON object
 * per line, for the Vast Bar app (and any script) to follow a run live.
 *
 * Events are emitted from the same call sites that update the status board and
 * build the outcomes the summary prints, so the stream and the terminal can
 * never tell two different stories. Without --json the sink is a no-op.
 */

import type { DeployOutcome } from '../commands/deploy.js';

/** Where a repo's develop → staging promotion stands when its plan is reported. */
export type PromoteState = 'will merge' | 'merged' | 'nothing to promote' | 'no develop' | 'not run';

/** What happened to a release announcement: the text is always there, posted or not. */
export interface SlackResult {
  text: string;
  posted: boolean;
  error: string | null;
}

export type VastEvent =
  | { type: 'start'; command: 'release' | 'promote'; args: string[]; dryRun: boolean; repos: string[] }
  | {
      type: 'plan';
      repo: string;
      ok: boolean;
      version: string;
      commits: number | null;
      promote: PromoteState;
      notice: string | null;
      detail: string | null;
    }
  | { type: 'promoted'; repo: string; commits: number }
  | { type: 'dispatched'; repo: string; version: string; runId: number; runUrl: string }
  | { type: 'run'; repo: string; status: string; conclusion: string | null; elapsedMs: number }
  | { type: 'rollout'; repo: string; state: string; reason: string | null; elapsedMs: number }
  | { type: 'pr'; repo: string; branch: string; url: string | null; version: string; slack: SlackResult | null }
  | { type: 'done'; repo: string; version: string; status: 'released' | 'skipped' | 'failed'; detail: string }
  | { type: 'end'; exitCode: number };

export interface EventSink {
  emit(event: VastEvent): void;
}

export const NO_EVENTS: EventSink = { emit: () => {} };

/** One line per event, flushed as it happens, each stamped with when it happened. */
export function ndjsonSink(
  write: (line: string) => void = (line) => {
    process.stdout.write(line);
  },
  now: () => Date = () => new Date(),
): EventSink {
  return { emit: (event) => write(`${JSON.stringify({ ...event, at: now().toISOString() })}\n`) };
}

export function doneEvent(outcome: DeployOutcome): VastEvent {
  return { type: 'done', repo: outcome.repo, version: outcome.version, status: outcome.status, detail: outcome.detail };
}
```

Create `src/utils/json-mode.ts`:

```ts
/**
 * In --json mode stdout is a data channel. Every human line — log.info, error
 * boxes, the status board, a muted note deep inside promote — is moved to
 * stderr here, once, at the command boundary, rather than threading a flag
 * through every print. Machine output is written with process.stdout.write,
 * which this leaves alone.
 */

import { format } from 'util';

export function routeHumanOutputToStderr(): void {
  const toStderr = (...args: unknown[]): void => {
    process.stderr.write(`${format(...args)}\n`);
  };
  console.log = toStderr;
  console.info = toStderr;
  console.warn = toStderr;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --import tsx --test tests/events.test.ts`
Expected: `# pass 4`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
npm run typecheck
git add src/utils/events.ts src/utils/json-mode.ts tests/events.test.ts
git commit -m "feat(json): event model and stdout routing for --json output"
```

---

### Task 2: `vast status --json`

**Files:**
- Modify: `src/commands/status.ts` (`Row` export, new `statusJson`, `executeStatus`, `registerStatusCommand`)
- Test: `tests/status.test.ts` (append)

**Interfaces:**
- Consumes: existing `readTags`, `inspect`, `Row` in `status.ts`; `RepoConfig`, `ReleaseTeam` from `src/config/repos.ts`.
- Produces:
  ```ts
  export interface StatusCell { tag: string | null; problem: string | null }
  export interface StatusDrift { text: string; ahead: number | null; problem: string | null }
  export interface StatusJsonRepo { repo: string; displayName: string; releaseTeam: ReleaseTeam | null; staging: StatusCell; production: StatusCell; drift: StatusDrift }
  export interface StatusJson { generatedAt: string; repos: StatusJsonRepo[] }
  export function statusJson(targets: RepoConfig[], rows: Row[], generatedAt: Date): StatusJson;
  ```

- [ ] **Step 1: Write the failing tests** — append to `tests/status.test.ts` (add `statusJson` and `type Row` to its import from `../src/commands/status.js`):

```ts
const row = (over: Partial<Row>): Row => ({
  name: 'VastPayPwaV2',
  staging: '2.1.4-rc1',
  production: '2.1.17',
  drift: 'develop +10',
  ...over,
});

test('status JSON carries versions, team, display name and drift ahead', () => {
  const json = statusJson([getRepo('VastPayPwaV2')!], [row({})], new Date('2026-10-11T09:00:00.000Z'));
  assert.deepEqual(json, {
    generatedAt: '2026-10-11T09:00:00.000Z',
    repos: [
      {
        repo: 'VastPayPwaV2',
        displayName: 'Vastpay Pwa V2',
        releaseTeam: 'frontend',
        staging: { tag: '2.1.4-rc1', problem: null },
        production: { tag: '2.1.17', problem: null },
        drift: { text: 'develop +10', ahead: 10, problem: null },
      },
    ],
  });
});

test('a cell that is a problem is never reported as a version', () => {
  const repo = getRepo('VastPayPwaV2')!;
  const at = new Date(0);
  for (const problem of ['not migrated', 'n/a', '?']) {
    const [r] = statusJson([repo], [row({ staging: problem, production: problem })], at).repos;
    assert.deepEqual(r.staging, { tag: null, problem });
    assert.deepEqual(r.production, { tag: null, problem });
  }
});

test('drift is a count when it is one, and a problem otherwise', () => {
  const repo = getRepo('VastPay-BackEnd')!;
  const at = new Date(0);
  const drift = (text: string) => statusJson([repo], [row({ name: 'VastPay-BackEnd', drift: text })], at).repos[0].drift;
  assert.deepEqual(drift('in sync'), { text: 'in sync', ahead: 0, problem: null });
  assert.deepEqual(drift('develop +3'), { text: 'develop +3', ahead: 3, problem: null });
  for (const p of ['not cloned', 'fetch failed', 'no develop', '?']) {
    assert.deepEqual(drift(p), { text: p, ahead: null, problem: p });
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test tests/status.test.ts`
Expected: FAIL, `statusJson` / `Row` not exported.

- [ ] **Step 3: Implement** — in `src/commands/status.ts`:

1. Change `interface Row {` to `export interface Row {`.
2. Change the repos import to also import `ReleaseTeam`:
   `import { REPOS, getRepo, isReleasable, type DeployEnv, type RepoConfig, type ReleaseTeam } from '../config/repos.js';` (keep whatever names it already imports; add `type ReleaseTeam`).
3. Add after `inspect`:

```ts
export interface StatusCell {
  tag: string | null;
  problem: string | null;
}

export interface StatusDrift {
  text: string;
  /** Commits develop has that staging lacks; null when that cannot be said. */
  ahead: number | null;
  problem: string | null;
}

export interface StatusJsonRepo {
  repo: string;
  displayName: string;
  releaseTeam: ReleaseTeam | null;
  staging: StatusCell;
  production: StatusCell;
  drift: StatusDrift;
}

export interface StatusJson {
  generatedAt: string;
  repos: StatusJsonRepo[];
}

/** The words the table prints instead of a version. In JSON they are problems, never tags. */
const TAG_PROBLEMS = new Set(['not migrated', 'n/a', '?']);

function cellOf(value: string): StatusCell {
  return TAG_PROBLEMS.has(value) ? { tag: null, problem: value } : { tag: value, problem: null };
}

function driftOf(text: string): StatusDrift {
  if (text === 'in sync') return { text, ahead: 0, problem: null };
  const m = /\+(\d+)$/.exec(text);
  return m ? { text, ahead: Number(m[1]), problem: null } : { text, ahead: null, problem: text };
}

/** The table, as data: built from the same rows, so the two cannot disagree. */
export function statusJson(targets: RepoConfig[], rows: Row[], generatedAt: Date): StatusJson {
  return {
    generatedAt: generatedAt.toISOString(),
    repos: rows.map((r, i) => ({
      repo: r.name,
      displayName: targets[i].displayName,
      releaseTeam: targets[i].releaseTeam,
      staging: cellOf(r.staging),
      production: cellOf(r.production),
      drift: driftOf(r.drift),
    })),
  };
}
```

4. In `executeStatus`, change the options type to `{ all: boolean; dir?: string; fetch: boolean; json?: boolean }`. Make the spinner and header conditional and add the JSON branch right after `rows` is built:

```ts
    const spinner = process.stdout.isTTY && !options.json
      ? createSpinner(`Refreshing ${targets.length} repo(s)...`).start()
      : null;
```

```ts
  if (!options.json) {
    console.log(createHeader('Release Status', options.fetch ? 'Vast Group' : 'Vast Group (local refs)'));
  }
```

```ts
  if (options.json) {
    process.stdout.write(`${JSON.stringify(statusJson(targets, rows, new Date()), null, 2)}\n`);
    return;
  }
```

5. In `registerStatusCommand`, add after the `--dir` option:
   `.option('--json', 'Print the table as JSON and nothing else', false)`
   and add to the help text's examples: `  $ vast status --all --json       the same, as JSON for scripts and Vast Bar`.

- [ ] **Step 4: Run to verify it passes**

Run: `node --import tsx --test tests/status.test.ts && npm run typecheck`
Expected: `# fail 0`, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/commands/status.ts tests/status.test.ts
git commit -m "feat(status): --json, the table as data"
```

---

### Task 3: `vast doctor --json`

**Files:**
- Modify: `src/commands/doctor.ts` (`executeDoctor`, `registerDoctorCommand`, new `doctorJson`)
- Test: `tests/doctor.test.ts` (append)

**Interfaces:**
- Consumes: `Check` from `src/utils/doctor.ts`.
- Produces: `export function doctorJson(checks: Check[], generatedAt: Date): { generatedAt: string; checks: Check[] }`.

- [ ] **Step 1: Write the failing test** — append to `tests/doctor.test.ts` (add `import { doctorJson } from '../src/commands/doctor.js';` at the top if the file does not already import from that module; if importing `src/commands/doctor.js` pulls config readers, put the import after any `VAST_CLI_HOME` setup the file already does):

```ts
test('doctor JSON is the check list, stamped', () => {
  const checks = [
    { group: 'Tools', label: 'gh', status: 'ok' as const, detail: 'authenticated as MostafaAdly' },
    { group: 'Repos', label: 'VastMenuPwa', status: 'warn' as const, detail: 'next 1.6.10-rc16 is not above production 1.6.12' },
  ];
  assert.deepEqual(doctorJson(checks, new Date('2026-10-11T09:00:00.000Z')), {
    generatedAt: '2026-10-11T09:00:00.000Z',
    checks,
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test tests/doctor.test.ts`
Expected: FAIL, `doctorJson` not exported.

- [ ] **Step 3: Implement** — in `src/commands/doctor.ts` add:

```ts
/** The check list, as data — the same list the terminal output is drawn from. */
export function doctorJson(checks: Check[], generatedAt: Date): { generatedAt: string; checks: Check[] } {
  return { generatedAt: generatedAt.toISOString(), checks };
}
```

Replace `executeDoctor` with:

```ts
async function executeDoctor(options: { json?: boolean } = {}): Promise<void> {
  if (options.json) {
    const checks = await runDoctor(liveDeps());
    process.stdout.write(`${JSON.stringify(doctorJson(checks, new Date()), null, 2)}\n`);
    if (tally(checks).fail > 0) process.exitCode = 1;
    return;
  }

  console.log(createHeader('Doctor', 'will a release work from here?'));
  const spinner = process.stdout.isTTY ? createSpinner('Checking tools, ArgoCD, every repo and Slack...').start() : null;
  const checks = await runDoctor(liveDeps());
  spinner?.stop();

  for (const line of renderChecks(checks)) console.log(line);
  log.newline();
  const { fail, warn } = tally(checks);
  if (fail === 0 && warn === 0) {
    log.success('All good — a release should work from here.');
  } else {
    const parts = [fail ? `${fail} problem${fail === 1 ? '' : 's'}` : '', warn ? `${warn} warning${warn === 1 ? '' : 's'}` : ''];
    (fail ? log.error : log.warn)(parts.filter(Boolean).join(', '));
  }
  if (fail > 0) process.exit(1);
}
```

In `registerDoctorCommand`, add `.option('--json', 'Print the checks as JSON and nothing else', false)` before `.addHelpText`, and under the `$ vast doctor` example line add `  $ vast doctor --json        the same, as JSON (exit 1 when a check fails)`.

- [ ] **Step 4: Run to verify it passes**

Run: `node --import tsx --test tests/doctor.test.ts && npm run typecheck`
Expected: `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/commands/doctor.ts tests/doctor.test.ts
git commit -m "feat(doctor): --json, the checks as data"
```

---

### Task 4: Progress hooks in the run and rollout pollers

**Files:**
- Modify: `src/utils/run-poll.ts` (`PollDeps`, `pollRun`)
- Modify: `src/utils/argocd.ts` (`RolloutDeps`, `waitForRollout`)
- Test: `tests/run-poll.test.ts`, `tests/argocd.test.ts` (append)

**Interfaces:**
- Produces:
  ```ts
  // PollDeps gains:
  onStatus?: (status: RunStatus, elapsedMs: number) => void; // on every status/conclusion change, including completion
  // RolloutDeps gains:
  onState?: (state: string, elapsedMs: number) => void; // on every state change; 'Synced/Healthy' when done
  ```

- [ ] **Step 1: Write the failing tests** — append to `tests/run-poll.test.ts`:

```ts
test('onStatus reports each status change once, including completion', async () => {
  const s = scripted([
    { status: 'queued', conclusion: null },
    { status: 'in_progress', conclusion: null },
    { status: 'in_progress', conclusion: null },
    { status: 'completed', conclusion: 'success' },
  ]);
  const seen: string[] = [];
  await pollRun('X', 1, { ...s.deps, onStatus: (st) => seen.push(`${st.status}/${st.conclusion}`) }, {
    pollMs: 5000,
    heartbeatMs: 30000,
    maxConsecutiveErrors: 12,
  });
  assert.deepEqual(seen, ['queued/null', 'in_progress/null', 'completed/success']);
});
```

Append to `tests/argocd.test.ts` (it already imports `waitForRollout` and has `ArgoApp` fixtures; if it has no scripted helper for `waitForRollout`, use this self-contained one):

```ts
test('onState reports each rollout state change and the final Synced/Healthy', async () => {
  const apps = [
    { syncStatus: 'Synced', healthStatus: 'Healthy', images: ['r/app:1.0.0'], revision: 'a' },
    { syncStatus: 'OutOfSync', healthStatus: 'Progressing', images: ['r/app:1.0.1'], revision: 'b' },
    { syncStatus: 'Synced', healthStatus: 'Healthy', images: ['r/app:1.0.1'], revision: 'b' },
  ];
  let i = 0;
  let clock = 0;
  const seen: string[] = [];
  const result = await waitForRollout(
    'X',
    'app',
    '1.0.1',
    {
      getApp: async () => apps[Math.min(i++, apps.length - 1)],
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
      print: () => {},
      onState: (state) => seen.push(state),
    },
    { pollMs: 5000, heartbeatMs: 30000, timeoutMs: 900000, maxConsecutiveErrors: 12 },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(seen, ['waiting for 1.0.1', 'OutOfSync/Progressing', 'Synced/Healthy']);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --import tsx --test tests/run-poll.test.ts tests/argocd.test.ts`
Expected: FAIL — `seen` stays empty (the hooks are never called).

- [ ] **Step 3: Implement**

In `src/utils/run-poll.ts`, add to `PollDeps`:

```ts
  /** Called once per status change (including completion), for machine-readable progress. */
  onStatus?: (status: RunStatus, elapsedMs: number) => void;
```

In `pollRun`, declare `let lastReported: string | null = null;` beside `lastStatus`, and replace the `if (current) {` block with:

```ts
    if (current) {
      const elapsed = deps.now() - start;
      const key = `${current.status}/${current.conclusion ?? ''}`;
      if (key !== lastReported) {
        deps.onStatus?.(current, elapsed);
        lastReported = key;
      }
      if (current.status === 'completed') {
        return { ok: current.conclusion === 'success', conclusion: current.conclusion, elapsedMs: elapsed };
      }
      if (current.status !== lastStatus || elapsed - lastPrintedAt >= timing.heartbeatMs) {
        deps.print(`  ${label}  run ${runId}  ${current.status}  ${formatElapsed(elapsed)}`);
        lastStatus = current.status;
        lastPrintedAt = elapsed;
      }
    }
```

In `src/utils/argocd.ts`, add to `RolloutDeps`:

```ts
  /** Called once per state change, and with "Synced/Healthy" when done, for machine-readable progress. */
  onState?: (state: string, elapsedMs: number) => void;
```

In `waitForRollout`, declare `let lastReported: string | null = null;` beside `lastState`, and replace the `if (current) {` block with:

```ts
    if (current) {
      lastApp = current;
      const elapsed = deps.now() - start;
      if (isDone(current)) {
        deps.onState?.(`${current.syncStatus}/${current.healthStatus}`, elapsed);
        return { ok: true, elapsedMs: elapsed, app: current };
      }

      // Before the tag shows up, sync/health describe the OLD image and would
      // read as a finished deploy. Say what we are actually waiting for.
      const state = hasTag(current, tag)
        ? `${current.syncStatus}/${current.healthStatus}`
        : `waiting for ${tag}`;
      if (state !== lastReported) {
        deps.onState?.(state, elapsed);
        lastReported = state;
      }
      if (state !== lastState || elapsed - lastPrintedAt >= timing.heartbeatMs) {
        deps.print(`  ${label}  argocd ${appName}  ${state}  ${formatElapsed(elapsed)}`);
        lastState = state;
        lastPrintedAt = elapsed;
      }
    }
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --import tsx --test tests/run-poll.test.ts tests/argocd.test.ts && npm run typecheck`
Expected: `# fail 0` (all existing poller tests unchanged and passing).

- [ ] **Step 5: Commit**

```bash
git add src/utils/run-poll.ts src/utils/argocd.ts tests/run-poll.test.ts tests/argocd.test.ts
git commit -m "feat(json): progress hooks in the run and rollout pollers"
```

---

### Task 5: Deploy events — dispatched, run, rollout, done

**Files:**
- Modify: `src/commands/deploy.ts` (`DeploySlot`, `Deployable`, `guardedStaging`, `deployOne`, `DeployManyDeps`, `deployMany`)
- Test: `tests/deploy.test.ts`, `tests/release.test.ts` (append)

**Interfaces:**
- Consumes: `EventSink`, `NO_EVENTS`, `doneEvent` (Task 1); `onStatus` / `onState` hooks (Task 4); `GuardNotice` from `src/utils/version-guard.ts`; `PromotionReport` (created here as a type-only file, filled in Task 6).
- Produces:
  ```ts
  export interface DeploySlot { board: StatusBoard; row: number; labelWidth: number; events?: EventSink }
  export interface Deployable { repo: RepoConfig; version: string; note?: string; notice?: GuardNotice; promotion?: PromotionReport }
  export interface DeployManyDeps { deploy?: …; board?: …; events?: EventSink }
  // src/utils/promotion-report.ts
  export interface PromotionReport { commits: number | null; result: PromotionResult; version?: string; kind?: ReleaseKind; branch?: string; url?: string | null; slack?: SlackResult | null; error?: string }
  export type PromotionResult = 'merged' | 'would merge' | 'nothing to promote' | 'refused' | 'pr opened' | 'would open pr';
  export function newReport(): PromotionReport; // { commits: null, result: 'refused' }
  ```

- [ ] **Step 1: Create the report type** (used by Deployable now, filled by promote in Task 6) — create `src/utils/promotion-report.ts`:

```ts
/**
 * What a promotion did, filled in by `promote()` as it goes so a caller can
 * report it as data. The boolean `promote()` returns stays the success signal;
 * this is the detail behind it.
 */

import type { SlackResult } from './events.js';
import type { ReleaseKind } from './release-branch.js';

export type PromotionResult =
  | 'merged'
  | 'would merge'
  | 'nothing to promote'
  | 'refused'
  | 'pr opened'
  | 'would open pr';

export interface PromotionReport {
  /** Commits the promotion carries: develop → staging, staging → production, or picks. */
  commits: number | null;
  result: PromotionResult;
  /** Production only. */
  version?: string;
  kind?: ReleaseKind;
  branch?: string;
  url?: string | null;
  slack?: SlackResult | null;
  /** Why it stopped, when result is 'refused'. */
  error?: string;
}

/** Starts as refused: a promotion that returns early without saying more has refused. */
export function newReport(): PromotionReport {
  return { commits: null, result: 'refused' };
}
```

Check `ReleaseKind`'s home with `grep -rn "export type ReleaseKind" src` and fix the import path if it is not `./release-branch.js`.

- [ ] **Step 2: Write the failing tests** — append to `tests/deploy.test.ts` (add `import type { VastEvent } from '../src/utils/events.js';`):

```ts
function recordingEvents(): { events: { emit: (e: VastEvent) => void }; seen: VastEvent[] } {
  const seen: VastEvent[] = [];
  return { events: { emit: (e) => seen.push(e) }, seen };
}

test('a deploy streams dispatched, run progress and its rollout', async () => {
  const { slot } = recordingSlot();
  const { events, seen } = recordingEvents();
  const d = deps({
    getRunStatus: async () => ({ status: 'completed', conclusion: 'success' }),
  });
  await deployOne(REPO, 'staging', '1.5.7-rc1', false, { ...slot, events }, undefined, d.deps);
  assert.deepEqual(seen[0], {
    type: 'dispatched',
    repo: 'VastPayPwa',
    version: '1.5.7-rc1',
    runId: 77,
    runUrl: 'https://github.com/Vast-menu/VastPayPwa/actions/runs/77',
  });
  assert.deepEqual(
    seen.filter((e) => e.type === 'run').map((e) => (e.type === 'run' ? `${e.status}/${e.conclusion}` : '')),
    ['completed/success'],
  );
});

test('a rollout that is not confirmed says why, as an event', async () => {
  const { slot } = recordingSlot();
  const { events, seen } = recordingEvents();
  const d = deps({ argocdEnabled: () => false });
  await deployOne(REPO, 'staging', '1.5.7-rc1', false, { ...slot, events }, undefined, d.deps);
  const rollout = seen.find((e) => e.type === 'rollout');
  assert.deepEqual(rollout && { ...rollout, elapsedMs: 0 }, {
    type: 'rollout',
    repo: 'VastPayPwa',
    state: 'not confirmed',
    reason: 'ArgoCD disabled',
    elapsedMs: 0,
  });
});
```

(`runUrl()` lives in `src/utils/github.ts`: `https://github.com/Vast-menu/<repo>/actions/runs/<id>`.)

Append to `tests/release.test.ts` (add `deployMany` to its import from `../src/commands/deploy.js` and `import type { VastEvent } from '../src/utils/events.js';`):

```ts
test('deployMany emits done for every repo it deploys, even one that throws', async () => {
  const seen: VastEvent[] = [];
  const [a, b] = targetsFor(['VastMenuPwa', 'VastMenu-DashBoard']);
  const outcomes = await deployMany([{ repo: a, version: '1.0.0-rc1' }, { repo: b, version: '2.0.0-rc1' }], 'staging', false, {
    board: () => ({ update: () => {} }),
    events: { emit: (e) => seen.push(e) },
    deploy: async (repo, _env, version) => {
      if (repo.name === 'VastMenu-DashBoard') throw new Error('boom');
      return released(repo, version);
    },
  });
  assert.deepEqual(outcomes.map((o) => o.status), ['released', 'failed']);
  assert.deepEqual(
    seen.filter((e) => e.type === 'done').map((e) => (e.type === 'done' ? `${e.repo}:${e.status}` : '')).sort(),
    ['VastMenu-DashBoard:failed', 'VastMenuPwa:released'],
  );
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `node --import tsx --test tests/deploy.test.ts tests/release.test.ts`
Expected: FAIL — no events recorded.

- [ ] **Step 4: Implement** — in `src/commands/deploy.ts`:

1. Imports: add `import { NO_EVENTS, doneEvent, type EventSink } from '../utils/events.js';`, `import type { GuardNotice } from '../utils/version-guard.js';` (merge into the existing version-guard import), `import type { PromotionReport } from '../utils/promotion-report.js';`.
2. `DeploySlot`: add `  /** Machine-readable progress; a no-op unless --json. */\n  events?: EventSink;`.
3. `Deployable`: add `notice?: GuardNotice;` and `promotion?: PromotionReport;`.
4. `guardedStaging`: change its last line to carry the notice:

```ts
  const ready: Deployable = { repo, version: guard.version };
  if (guard.note) ready.note = guard.note;
  if (guard.notice) ready.notice = guard.notice;
  return ready;
```

5. In `deployOne`, after `const say = …`, add `const events = slot.events ?? NO_EVENTS;`. Then:
   - right after `const url = runUrl(repo.name, runId);` add
     `events.emit({ type: 'dispatched', repo: repo.name, version, runId, runUrl: url });`
   - in the `pollRun` deps object add
     `onStatus: (s, ms) => events.emit({ type: 'run', repo: repo.name, status: s.status, conclusion: s.conclusion, elapsedMs: ms }),`
   - at the top of `unconfirmed`, add:

```ts
    events.emit({
      type: 'rollout',
      repo: repo.name,
      state: 'not confirmed',
      reason: kind === 'sso' ? 'ArgoCD API behind a sign-in' : kind === 'disabled' ? 'ArgoCD disabled' : 'no ArgoCD token',
      elapsedMs: 0,
    });
```

   - in the `waitForRollout` deps object add
     `onState: (state, ms) => events.emit({ type: 'rollout', repo: repo.name, state, reason: null, elapsedMs: ms }),`
   - inside `if (!rollout.ok) {` (the non-SSO failure branch), before `say(…)`, add
     `events.emit({ type: 'rollout', repo: repo.name, state: 'failed', reason: why, elapsedMs: rollout.elapsedMs });`

6. `DeployManyDeps`: add `  /** Machine-readable progress; a no-op unless --json. */\n  events?: EventSink;`.
7. In `deployMany`, replace from `const settled = await Promise.allSettled(` to the end of the `finished` computation with:

```ts
  const events = deps.events ?? NO_EVENTS;
  const failedOutcome = (i: number, reason: unknown): DeployOutcome => ({
    repo: going[i].repo.name,
    version: going[i].version,
    status: 'failed',
    detail: reason instanceof Error ? reason.message : String(reason),
  });
  // A note belongs in the summary too, not only in the scrollback above the board.
  const withNote = (i: number, outcome: DeployOutcome): DeployOutcome => {
    const note = going[i].note;
    return note ? { ...outcome, detail: `${outcome.detail} · ${note}` } : outcome;
  };
  // Each repo reports `done` the moment it finishes — a long rollout must not
  // hold back the news that a sibling already failed. Never rejects, so
  // one throw cannot swallow the others' outcomes.
  const finished = await Promise.all(
    going.map((g, i) =>
      run(g.repo, env, g.version, dryRun, { board, row: i, labelWidth, events }, timing).then(
        (o) => withNote(i, o),
        (reason) => withNote(i, failedOutcome(i, reason)),
      ).then((final) => {
        events.emit(doneEvent(final));
        return final;
      }),
    ),
  );
```

   Keep the existing tail (`let next = 0; return planned.map(…)`) unchanged.

- [ ] **Step 5: Run to verify they pass**

Run: `node --import tsx --test tests/deploy.test.ts tests/release.test.ts && npm test 2>&1 | grep -E "^# (pass|fail)" && npm run typecheck`
Expected: `# fail 0` everywhere; existing deploy/release tests unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/commands/deploy.ts src/utils/promotion-report.ts tests/deploy.test.ts tests/release.test.ts
git commit -m "feat(json): deploys stream dispatched, run, rollout and done events"
```

---

### Task 6: `promote()` reports what it did; the announcement returns its result

**Files:**
- Modify: `src/commands/promote.ts` (`promote`, `announceRelease`)
- Test: `tests/promotion-report.test.ts` (create), `tests/promote-slack.test.ts` (append)

**Interfaces:**
- Consumes: `PromotionReport`, `newReport` (Task 5); `SlackResult` (Task 1).
- Produces:
  ```ts
  export async function promote(repo, dir, to, dryRun, kind?, targetVersion?, bodyMode?, pickRefs?, slack?, report: PromotionReport = newReport()): Promise<boolean>;
  export async function announceRelease(…same params…): Promise<SlackResult>;
  ```

- [ ] **Step 1: Write the failing tests** — create `tests/promotion-report.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.VAST_CLI_HOME = mkdtempSync(join(tmpdir(), 'vast-report-home-'));
const { promote } = await import('../src/commands/promote.js');
const { newReport } = await import('../src/utils/promotion-report.js');
const { getRepo } = await import('../src/config/repos.js');

/** A clone with a real origin holding develop, staging and production. */
function fixture(developAhead: number): { clone: string; cleanup: () => void } {
  const base = mkdtempSync(join(tmpdir(), 'vast-report-'));
  const upstream = join(base, 'upstream');
  const clone = join(base, 'clone');
  const git = (dir: string, ...args: string[]): string =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: 'pipe' });
  execFileSync('git', ['init', '-q', '-b', 'production', upstream], { stdio: 'pipe' });
  git(upstream, 'config', 'user.email', 't@e.com');
  git(upstream, 'config', 'user.name', 'T');
  writeFileSync(join(upstream, 'f.txt'), 'base\n');
  git(upstream, 'add', '.');
  git(upstream, 'commit', '-qm', 'base');
  git(upstream, 'branch', 'staging');
  git(upstream, 'checkout', '-qb', 'develop');
  for (let i = 0; i < developAhead; i++) {
    writeFileSync(join(upstream, `d${i}.txt`), `${i}\n`);
    git(upstream, 'add', '.');
    git(upstream, 'commit', '-qm', `feat: d${i}`);
  }
  git(upstream, 'checkout', '-q', 'production');
  execFileSync('git', ['clone', '-q', upstream, clone], { stdio: 'pipe' });
  git(clone, 'config', 'user.email', 't@e.com');
  git(clone, 'config', 'user.name', 'T');
  return { clone, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

const REPO = getRepo('VastPayPwa')!;

test('a dry-run staging promotion reports the commits it would merge', async () => {
  const f = fixture(2);
  try {
    const report = newReport();
    assert.equal(await promote(REPO, f.clone, 'staging', true, 'release', undefined, 'changelog', [], false, report), true);
    assert.deepEqual(report, { commits: 2, result: 'would merge' });
  } finally {
    f.cleanup();
  }
});

test('a staging promotion with nothing new reports nothing to promote', async () => {
  const f = fixture(0);
  try {
    const report = newReport();
    assert.equal(await promote(REPO, f.clone, 'staging', true, 'release', undefined, 'changelog', [], false, report), true);
    assert.deepEqual(report, { commits: 0, result: 'nothing to promote' });
  } finally {
    f.cleanup();
  }
});

test('a refused promotion records why', async () => {
  const f = fixture(1);
  try {
    writeFileSync(join(f.clone, 'dirty.txt'), 'uncommitted\n');
    const report = newReport();
    assert.equal(await promote(REPO, f.clone, 'staging', true, 'release', undefined, 'changelog', [], false, report), false);
    assert.equal(report.result, 'refused');
    assert.equal(report.error, 'VastPayPwa has uncommitted changes');
  } finally {
    f.cleanup();
  }
});
```

Append to `tests/promote-slack.test.ts` (it already has `fixture`, `recorder`, `withRecorder` and a fake `buildReleaseMessage` that renders `MSG <display> <branch> <url> …`):

```ts
test('a dry-run announcement returns its message, unposted', async () => {
  const f = fixture();
  const r = recorder();
  try {
    let result: Awaited<ReturnType<typeof announceRelease>> | undefined;
    await withRecorder(r, async () => {
      result = await announceRelease(repo, f.dir, 'release', '1.4.0', null, { dryRun: true }, r.deps);
    });
    assert.equal(result?.posted, false);
    assert.equal(result?.error, null);
    assert.match(result?.text ?? '', /^MSG Vastpay Pwa release\/1\.4\.0 /);
  } finally {
    f.cleanup();
  }
});

test('a posted announcement says so in its result', async () => {
  const f = fixture();
  const r = recorder();
  try {
    let result: Awaited<ReturnType<typeof announceRelease>> | undefined;
    await withRecorder(r, async () => {
      result = await announceRelease(repo, f.dir, 'release', '1.4.0', 'https://github.com/Vast-menu/VastPayPwa/pull/99', { dryRun: false }, r.deps);
    });
    assert.equal(result?.posted, true);
    assert.equal(result?.error, null);
  } finally {
    f.cleanup();
  }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --import tsx --test tests/promotion-report.test.ts tests/promote-slack.test.ts`
Expected: FAIL — report stays `{ commits: null, result: 'refused' }`; `announceRelease` returns `undefined`.

- [ ] **Step 3: Implement** — in `src/commands/promote.ts`:

1. Imports: `import { newReport, type PromotionReport } from '../utils/promotion-report.js';` and `import type { SlackResult } from '../utils/events.js';`.
2. `announceRelease`: return type `Promise<SlackResult>`. Replace its four exits:
   - dry run: after the three `console.log` lines, `return { text, posted: false, error: null };`
   - not configured: after `log.warn(…)`, `return { text, posted: false, error: 'Slack not configured — run vast slack setup' };`
   - posted: after `log.success(…)`, `return { text, posted: true, error: null };`
   - failed: in the `catch`, compute `const message = error instanceof Error ? error.message : String(error);`, use it in the existing `log.error`, then after `console.log(text);` add `return { text, posted: false, error: message };`
3. `promote`: add a final parameter `report: PromotionReport = newReport(),` after `slack = false,`. As the first statement inside the function body add:

```ts
  // Every refusal goes through here so the report always knows why it stopped.
  const refuse = (title: string, body: string): false => {
    console.log(createErrorBox(title, body));
    report.result = 'refused';
    report.error = title;
    return false;
  };
```

   Then replace every `console.log(createErrorBox(TITLE, BODY));` immediately followed by `return false;` inside `promote()` with `return refuse(TITLE, BODY);`. There are ten (not cloned, uncommitted changes, no staging deployments file, picks cannot be promoted, nothing to pick, no production deployments file, cannot derive a hotfix version, cannot derive a release version, cannot promote into staging, conflicts). Verify none is left:
   `awk '/^export async function promote\(/,/^}/' src/commands/promote.ts | grep -c "createErrorBox"` → `1` (only inside `refuse`).
4. Record outcomes at the success exits of `promote()`:
   - production, picks path: after `version` is settled and before `log.info(…)`, set
     `report.commits = picks.length + merges.length; report.version = version; report.kind = kind; report.branch = releaseBranchName(kind, version);`
     after `cutPickedBranch(…)` returns `url`, set `report.url = url; report.result = url !== null ? 'pr opened' : dryRun ? 'would open pr' : 'refused';`
     change the announce call to `report.slack = await announceRelease(…same args…);`
   - production, release path: in the `ahead === 0` branch, set `report.commits = 0; report.result = 'nothing to promote';` before `return true;`
     after `version` is settled and before `log.info(…)`, set `report.commits = ahead; report.version = version; report.kind = kind; report.branch = releaseBranchName(kind, version);`
     after `cutReleaseBranch(…)` returns `url`, set `report.url = url; report.result = url !== null ? 'pr opened' : dryRun ? 'would open pr' : 'refused';`
     change the announce call to `report.slack = await announceRelease(…same args…);`
   - staging: in the `ahead === 0` branch set `report.commits = 0; report.result = 'nothing to promote';` before `return true;`; in the dry-run branch set `report.commits = ahead; report.result = 'would merge';` before `return true;`; after `mergeAndPush(…)` set `report.commits = ahead; report.result = 'merged';`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --import tsx --test tests/promotion-report.test.ts tests/promote-slack.test.ts && npm test 2>&1 | grep -E "^# (pass|fail)" && npm run typecheck`
Expected: `# fail 0`; existing promote-slack tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/commands/promote.ts tests/promotion-report.test.ts tests/promote-slack.test.ts
git commit -m "feat(promote): report what a promotion did, and what the announcement said"
```

---

### Task 7: `vast release --json`

**Files:**
- Modify: `src/commands/release.ts` (`ReleaseOptions`, `PrepareDeps`, `prepareOne`, `ReleaseManyDeps`, `releaseMany`, new `planEvent`, new `runRelease`, `executeRelease`, `registerReleaseCommand`)
- Test: `tests/release.test.ts` (append)

**Interfaces:**
- Consumes: Tasks 1, 5, 6.
- Produces:
  ```ts
  export interface ReleaseOptions { …existing; json?: boolean }
  export interface PrepareDeps { stagingTag?; promote?: (repo: RepoConfig, dir: string, dryRun: boolean, report: PromotionReport) => Promise<boolean>; readProduction? }
  export interface ReleaseManyDeps extends DeployManyDeps { prepare?: … } // DeployManyDeps now has events
  export function planEvent(repo: RepoConfig, prepared: Deployable | DeployOutcome): VastEvent;
  export async function runRelease(repoNames: string[], options: ReleaseOptions, events: EventSink, args: string[], deps?: ReleaseManyDeps): Promise<number>; // exit code
  ```

- [ ] **Step 1: Write the failing tests** — append to `tests/release.test.ts` (add `planEvent`, `runRelease` to the import from `../src/commands/release.js`):

```ts
function recorder(): { events: { emit: (e: VastEvent) => void }; seen: VastEvent[] } {
  const seen: VastEvent[] = [];
  return { events: { emit: (e) => seen.push(e) }, seen };
}

test('a refused repo still reports its plan and its done', async () => {
  const { events, seen } = recorder();
  await releaseMany(targetsFor(['VastPayPwa', 'VastMenuPwa']), MANY_OPTIONS, {
    prepare: async (repo) => alternatingPrepare(repo),
    deploy: async (repo, _env, version) => released(repo, version),
    board: () => ({ update: () => {} }),
    events,
  });
  const forPwa = seen.filter((e) => 'repo' in e && e.repo === 'VastPayPwa').map((e) => e.type);
  assert.deepEqual(forPwa, ['plan', 'done']);
  const plan = seen.find((e) => e.type === 'plan' && e.repo === 'VastPayPwa');
  assert.deepEqual(plan, {
    type: 'plan',
    repo: 'VastPayPwa',
    ok: false,
    version: '—',
    commits: null,
    promote: 'not run',
    notice: null,
    detail: 'promotion refused',
  });
});

test('a promoted repo reports plan, promoted, then its deploy', async () => {
  const { events, seen } = recorder();
  await releaseMany(targetsFor(['VastMenuPwa']), MANY_OPTIONS, {
    prepare: async (repo) => ({ repo, version: '1.6.13-rc1', promotion: { commits: 4, result: 'merged' } }),
    deploy: async (repo, _env, version) => released(repo, version),
    board: () => ({ update: () => {} }),
    events,
  });
  assert.deepEqual(seen.map((e) => e.type), ['plan', 'promoted', 'done']);
  assert.deepEqual(seen[1], { type: 'promoted', repo: 'VastMenuPwa', commits: 4 });
});

test('a plan names the guard notice and the promotion state', () => {
  const repo = getRepo('VastMenuPwa')!;
  assert.deepEqual(
    planEvent(repo, {
      repo,
      version: '1.6.13-rc1',
      note: 'auto-corrected past production',
      notice: { tone: 'warn', text: '1.6.10-rc16 is not above production 1.6.12 — using 1.6.13-rc1' },
      promotion: { commits: 2, result: 'would merge' },
    }),
    {
      type: 'plan',
      repo: 'VastMenuPwa',
      ok: true,
      version: '1.6.13-rc1',
      commits: 2,
      promote: 'will merge',
      notice: '1.6.10-rc16 is not above production 1.6.12 — using 1.6.13-rc1',
      detail: 'auto-corrected past production',
    },
  );
  const backend = getRepo('VastPay-BackEnd')!;
  assert.equal((planEvent(backend, { repo: backend, version: '4.5.11-rc31' }) as { promote: string }).promote, 'no develop');
});

test('runRelease brackets the stream with start and end, and returns the exit code', async () => {
  const { events, seen } = recorder();
  const code = await runRelease(['VastMenuPwa'], { ...MANY_OPTIONS, dryRun: true }, events, ['release', 'VastMenuPwa', '--dry-run', '--json'], {
    prepare: async (repo) => ({ repo, version: '1.6.13-rc1' }),
    deploy: async (repo, _env, version) => ({ repo: repo.name, version, status: 'skipped', detail: 'dry run' }),
    board: () => ({ update: () => {} }),
  });
  assert.equal(code, 0);
  assert.equal(seen[0].type, 'start');
  assert.deepEqual(seen[0], {
    type: 'start',
    command: 'release',
    args: ['release', 'VastMenuPwa', '--dry-run', '--json'],
    dryRun: true,
    repos: ['VastMenuPwa'],
  });
  assert.equal(seen.at(-1)?.type, 'done');
});

test('an unknown repository is exit code 1 with no repo events', async () => {
  const { events, seen } = recorder();
  const code = await runRelease(['Nope'], MANY_OPTIONS, events, ['release', 'Nope'], {});
  assert.equal(code, 1);
  assert.deepEqual(seen, []);
});
```

(`end` is emitted by `executeRelease`, not `runRelease`, so a test can assert on the code; Task 9's live check covers the full `start … end` stream.)

- [ ] **Step 2: Run to verify they fail**

Run: `node --import tsx --test tests/release.test.ts`
Expected: FAIL — `planEvent` / `runRelease` not exported; no events.

- [ ] **Step 3: Implement** — in `src/commands/release.ts`:

1. Imports: `import { NO_EVENTS, doneEvent, ndjsonSink, type EventSink, type PromoteState, type VastEvent } from '../utils/events.js';`, `import { routeHumanOutputToStderr } from '../utils/json-mode.js';`, `import { newReport, type PromotionReport } from '../utils/promotion-report.js';`, `import { createStatusBoard } from '../utils/status-board.js';`, and ensure `isOutcome`, `type Deployable`, `type DeployOutcome` are imported from `./deploy.js`.
2. `ReleaseOptions`: add `json?: boolean;`.
3. `PrepareDeps.promote`: `promote?: (repo: RepoConfig, dir: string, dryRun: boolean, report: PromotionReport) => Promise<boolean>;`
4. In `prepareOne`, replace the promotion block (`if (!options.skipPromote) { … }` through `return planned;`) with:

```ts
  let promotion: PromotionReport | undefined;
  if (!options.skipPromote) {
    if (!needsPromotion(repo)) {
      // The backend repos have no usable develop — human PRs there target
      // staging directly. Failing the release for a promotion that cannot
      // exist made the everyday command unusable for that team and turned
      // every `release --all` sweep red. Skipping is not a policy change:
      // there is nothing to promote.
      log.muted(`  ${repo.name}: no develop to promote — deploying what is on staging`);
    } else {
      promotion = newReport();
      const run =
        deps.promote ??
        ((r: RepoConfig, d: string, n: boolean, rep: PromotionReport) =>
          promote(r, d, 'staging', n, 'release', undefined, 'changelog', [], false, rep));
      if (!(await run(repo, dir, options.dryRun, promotion))) {
        const why = promotion.error ? `promotion refused — ${promotion.error}` : 'promotion refused';
        return { repo: repo.name, version: '—', status: 'failed', detail: why };
      }
    }
  }

  return promotion ? { ...planned, promotion } : planned;
```

5. Add after `prepareOne`:

```ts
function promoteState(repo: RepoConfig, report: PromotionReport | undefined): PromoteState {
  if (!needsPromotion(repo)) return 'no develop';
  switch (report?.result) {
    case 'merged':
      return 'merged';
    case 'would merge':
      return 'will merge';
    case 'nothing to promote':
      return 'nothing to promote';
    default:
      return 'not run';
  }
}

/** One repo's preparation, as the app's preview reads it. */
export function planEvent(repo: RepoConfig, prepared: Deployable | DeployOutcome): VastEvent {
  if (isOutcome(prepared)) {
    return {
      type: 'plan',
      repo: repo.name,
      ok: false,
      version: prepared.version,
      commits: null,
      promote: 'not run',
      notice: null,
      detail: prepared.detail,
    };
  }
  return {
    type: 'plan',
    repo: repo.name,
    ok: true,
    version: prepared.version,
    commits: prepared.promotion?.commits ?? null,
    promote: promoteState(repo, prepared.promotion),
    notice: prepared.notice?.text ?? null,
    detail: prepared.note ?? null,
  };
}
```

6. Replace `releaseMany`'s body with:

```ts
  const prepare = deps.prepare ?? prepareOne;
  const events = deps.events ?? NO_EVENTS;
  const planned: Array<Deployable | DeployOutcome> = [];
  for (const repo of targets) {
    const prepared = await prepare(repo, options);
    events.emit(planEvent(repo, prepared));
    if (isOutcome(prepared)) {
      // Refused before deploying: this repo's story ends here, so say so now.
      events.emit(doneEvent(prepared));
    } else if (prepared.promotion?.result === 'merged') {
      events.emit({ type: 'promoted', repo: repo.name, commits: prepared.promotion.commits ?? 0 });
    }
    planned.push(prepared);
  }
  return deployMany(planned, 'staging', options.dryRun, deps);
```

7. Replace `executeRelease` with `runRelease` plus a thin `executeRelease`:

```ts
/**
 * The whole release, as an exit code rather than a process.exit, so it can be
 * driven by --json and by tests. Every human line still prints; in --json mode
 * the command boundary has already moved those lines to stderr.
 */
export async function runRelease(
  repoNames: string[],
  options: ReleaseOptions,
  events: EventSink,
  args: string[],
  deps: ReleaseManyDeps = {},
): Promise<number> {
  const startedAt = Date.now();
  const problem = validateReleaseOptions(repoNames, options);
  if (problem) {
    log.error(problem);
    return 1;
  }

  if (options.to !== 'staging') {
    console.log(
      createErrorBox(
        `\`release\` only targets staging`,
        'Production has a human review gate in the middle, so it is two steps:\n\n' +
          '    vast promote <repo> --to production    cut release/X.Y.Z + PR\n' +
          '    # review and merge that PR\n' +
          '    vast deploy  <repo> --to production    build and ship it\n\n' +
          'Add `--as hotfix` to the promote for a hotfix/X.Y.Z branch instead.\n\n' +
          'The promote works any time. The production DEPLOY is currently blocked\n' +
          'outright: production has not moved to the new pipeline yet, so it is\n' +
          'shipped by hand until DevOps has migrated it.',
      ),
    );
    return 1;
  }

  const { repos: targets, unknown } = releaseTargets(repoNames, options);
  if (unknown.length > 0) {
    log.error(`Unknown ${unknown.length === 1 ? 'repository' : 'repositories'}: ${unknown.join(', ')}`);
    return 1;
  }
  if (targets.length === 0) {
    log.error('Specify a repository, or --all / --frontend / --backend');
    return 1;
  }

  console.log(createHeader('Release', `${targets.length} repo(s) | → staging`));
  events.emit({ type: 'start', command: 'release', args, dryRun: options.dryRun, repos: targets.map((r) => r.name) });

  const outcomes = await releaseMany(targets, options, { ...deps, events });

  printSummary(outcomes, 'staging', { dryRun: options.dryRun, startedAt });
  return outcomes.some((o) => o.status === 'failed') ? 1 : 0;
}

async function executeRelease(repoNames: string[], options: ReleaseOptions): Promise<void> {
  if (!options.json) {
    const code = await runRelease(repoNames, options, NO_EVENTS, process.argv.slice(2));
    if (code !== 0) process.exit(code);
    return;
  }
  // stdout is a data channel from here on: one JSON object per line.
  routeHumanOutputToStderr();
  const events = ndjsonSink();
  const code = await runRelease(repoNames, options, events, process.argv.slice(2), {
    board: (rows) => createStatusBoard(rows, process.stderr),
  });
  events.emit({ type: 'end', exitCode: code });
  process.exitCode = code;
}
```

   Keep the exact refusal text of the existing `executeRelease` (copy it from the current file if it differs from the block above).

8. In `registerReleaseCommand`, add `.option('--json', 'Stream progress as JSON lines on stdout (human output goes to stderr)', false)` after `--dry-run`, and add to its help examples: `  $ vast release VastPayPwa --dry-run --json   the plan, as JSON lines`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --import tsx --test tests/release.test.ts && npm test 2>&1 | grep -E "^# (pass|fail)" && npm run typecheck`
Expected: `# fail 0`; all existing release tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/commands/release.ts tests/release.test.ts
git commit -m "feat(release): --json streams plan, promoted, deploy progress and done"
```

---

### Task 8: `vast promote --json`

**Files:**
- Modify: `src/commands/promote.ts` (new `runPromote`, `executePromote`, `registerPromoteCommand`)
- Test: `tests/promotion-report.test.ts` (append)

**Interfaces:**
- Consumes: Tasks 1, 6.
- Produces:
  ```ts
  export interface PromoteCommandOptions { to: string; as?: ReleaseKind; pick?: string[]; dir?: string; targetVersion?: string; changelog: boolean; summarize?: boolean; llm?: boolean; slack?: boolean; dryRun: boolean; json?: boolean }
  export async function runPromote(repoName: string, options: PromoteCommandOptions, events: EventSink, args: string[]): Promise<number>;
  ```

- [ ] **Step 1: Write the failing tests** — append to `tests/promotion-report.test.ts` (add `const { runPromote } = await import('../src/commands/promote.js');` next to the existing `promote` import, and `import type { VastEvent } from '../src/utils/events.js';`):

```ts
const BASE_OPTS = { to: 'staging', changelog: true, dryRun: true } as const;

test('runPromote brackets a promotion with start, plan and done', async () => {
  const f = fixture(2);
  try {
    const seen: VastEvent[] = [];
    const code = await runPromote('VastPayPwa', { ...BASE_OPTS, dir: f.clone }, { emit: (e) => seen.push(e) }, [
      'promote',
      'VastPayPwa',
      '--dry-run',
      '--json',
    ]);
    assert.equal(code, 0);
    assert.deepEqual(seen.map((e) => e.type), ['start', 'plan', 'done']);
    assert.deepEqual(seen[1], {
      type: 'plan',
      repo: 'VastPayPwa',
      ok: true,
      version: '—',
      commits: 2,
      promote: 'will merge',
      notice: null,
      detail: null,
    });
    assert.deepEqual(seen[2], { type: 'done', repo: 'VastPayPwa', version: '—', status: 'skipped', detail: 'dry run' });
  } finally {
    f.cleanup();
  }
});

test('runPromote on an unknown repository is exit 1 with no events', async () => {
  const seen: VastEvent[] = [];
  assert.equal(await runPromote('Nope', BASE_OPTS, { emit: (e) => seen.push(e) }, ['promote', 'Nope']), 1);
  assert.deepEqual(seen, []);
});

test('a refused promotion is done/failed with the reason', async () => {
  const f = fixture(1);
  try {
    writeFileSync(join(f.clone, 'dirty.txt'), 'x\n');
    const seen: VastEvent[] = [];
    const code = await runPromote('VastPayPwa', { ...BASE_OPTS, dir: f.clone }, { emit: (e) => seen.push(e) }, []);
    assert.equal(code, 1);
    assert.deepEqual(seen.at(-1), {
      type: 'done',
      repo: 'VastPayPwa',
      version: '—',
      status: 'failed',
      detail: 'VastPayPwa has uncommitted changes',
    });
  } finally {
    f.cleanup();
  }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --import tsx --test tests/promotion-report.test.ts`
Expected: FAIL — `runPromote` not exported.

- [ ] **Step 3: Implement** — in `src/commands/promote.ts`:

1. Imports: extend the events import to `import { ndjsonSink, NO_EVENTS, type EventSink, type SlackResult } from '../utils/events.js';` and add `import { routeHumanOutputToStderr } from '../utils/json-mode.js';`.
2. Add, above `executePromote`:

```ts
export interface PromoteCommandOptions {
  to: string;
  as?: ReleaseKind;
  pick?: string[];
  dir?: string;
  targetVersion?: string;
  /** Commander sets this false when --no-changelog is passed. */
  changelog: boolean;
  summarize?: boolean;
  /** Hidden alias for --summarize. */
  llm?: boolean;
  slack?: boolean;
  dryRun: boolean;
  json?: boolean;
}

/** What a finished promotion means for the stream's `done`. */
function promotionDone(report: PromotionReport, ok: boolean, dryRun: boolean): { status: 'released' | 'skipped' | 'failed'; detail: string } {
  if (!ok) return { status: 'failed', detail: report.error ?? 'promotion refused' };
  if (report.result === 'nothing to promote') return { status: 'skipped', detail: 'nothing to promote' };
  if (dryRun) return { status: 'skipped', detail: 'dry run' };
  if (report.result === 'pr opened') return { status: 'released', detail: `PR opened — ${report.url}` };
  return { status: 'released', detail: 'promoted' };
}
```

3. Rename the existing `executePromote` body into `runPromote(repoName, options, events, args): Promise<number>` with these changes, and nothing else:
   - change its options parameter type to `PromoteCommandOptions`;
   - every `log.error(…); process.exit(1);` and every `console.log(createErrorBox(…)); process.exit(1);` becomes the same print followed by `return 1;`;
   - after the header `console.log(createHeader('Promote', …));` and the `dir` check, emit
     `events.emit({ type: 'start', command: 'promote', args, dryRun: options.dryRun, repos: [repo.name] });`
   - replace the final `const ok = await promote(…); if (!ok) process.exit(1);` with:

```ts
  const report = newReport();
  const ok = await promote(
    repo,
    dir,
    options.to as 'staging' | 'production',
    options.dryRun,
    kind,
    options.targetVersion,
    bodyMode,
    options.pick ?? [],
    options.slack ?? false,
    report,
  );
  events.emit({
    type: 'plan',
    repo: repo.name,
    ok,
    version: report.version ?? '—',
    commits: report.commits,
    promote: options.to === 'staging' && report.result === 'would merge' ? 'will merge' : options.to === 'staging' && report.result === 'merged' ? 'merged' : report.result === 'nothing to promote' ? 'nothing to promote' : 'not run',
    notice: null,
    detail: ok ? null : (report.error ?? null),
  });
  if (options.to === 'staging' && report.result === 'merged') {
    events.emit({ type: 'promoted', repo: repo.name, commits: report.commits ?? 0 });
  }
  if (report.branch && report.version) {
    events.emit({ type: 'pr', repo: repo.name, branch: report.branch, url: report.url ?? null, version: report.version, slack: report.slack ?? null });
  }
  const done = promotionDone(report, ok, options.dryRun);
  events.emit({ type: 'done', repo: repo.name, version: report.version ?? '—', status: done.status, detail: done.detail });
  return ok ? 0 : 1;
```

   (In the not-cloned `dir` check that happens before `start`, keep `return 1` with no events, matching Task 7's rule that early refusals carry no repo events.)

4. New thin `executePromote`:

```ts
async function executePromote(repoName: string, options: PromoteCommandOptions): Promise<void> {
  if (!options.json) {
    const code = await runPromote(repoName, options, NO_EVENTS, process.argv.slice(2));
    if (code !== 0) process.exit(code);
    return;
  }
  // stdout is a data channel from here on: one JSON object per line.
  routeHumanOutputToStderr();
  const events = ndjsonSink();
  const code = await runPromote(repoName, options, events, process.argv.slice(2));
  events.emit({ type: 'end', exitCode: code });
  process.exitCode = code;
}
```

5. In `registerPromoteCommand`, add `.option('--json', 'Stream the result as JSON lines on stdout (human output goes to stderr)', false)` after `--dry-run`, and an example: `  $ vast promote VastPayPwa --to production -n --json   the PR it would open, as JSON`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --import tsx --test tests/promotion-report.test.ts && npm test 2>&1 | grep -E "^# (pass|fail)" && npm run typecheck`
Expected: `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/commands/promote.ts tests/promotion-report.test.ts
git commit -m "feat(promote): --json streams plan, pr and done"
```

---

### Task 9: Docs, build, live check, PR

**Files:**
- Modify: `README.md`, `skills/release/SKILL.md`, `CLAUDE.md`
- Rebuild: `dist/`

- [ ] **Step 1: Build and read the real help**

Run: `npm run build && for c in status doctor release promote; do node bin/vast.js $c --help | grep -- --json; done`
Expected: one `--json` line per command.

- [ ] **Step 2: Live checks (read-only, dry runs only, never `--slack`)**

```bash
node bin/vast.js status --all --json | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(j.repos.length, 'repos ok')"
node bin/vast.js doctor --json | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(j.checks.length, 'checks ok')"; echo "doctor exit $?"
node bin/vast.js release VastPayPwa --dry-run --json 2>/dev/null | node -e "const ls=require('fs').readFileSync(0,'utf8').trim().split('\n'); ls.forEach(l=>JSON.parse(l)); console.log(ls.map(l=>JSON.parse(l).type).join(' '))"
node bin/vast.js promote VastPayPwa --to production --dry-run --json 2>/dev/null | node -e "const ls=require('fs').readFileSync(0,'utf8').trim().split('\n'); ls.forEach(l=>JSON.parse(l)); console.log(ls.map(l=>JSON.parse(l).type).join(' '))"
node bin/vast.js release Nope --json 2>/dev/null; echo "exit $?"
```

Expected: `9 repos ok`; a check count; `start plan done end` for the release dry run; `start plan pr done end` for the promote dry run (or `start plan done end` if production already contains staging); `{"type":"end","exitCode":1,…}` then `exit 1` for the unknown repo. Every stdout line must parse; any parse error means a human line leaked — fix at the source and re-run.

- [ ] **Step 3: README** — in `### Reading \`vast status\``, add after the code block:

````markdown
Add `--json` for the same table as data (`staging`/`production` as `{ tag, problem }`,
drift as `{ text, ahead, problem }`). `vast doctor --json` prints its checks the same way.
````

And add a section after the release flow section:

````markdown
### Machine-readable output

`vast status --json` and `vast doctor --json` print one JSON document and nothing else.
`vast release … --json` and `vast promote … --json` stream one JSON object per line on
stdout as things happen, with every human line moved to stderr; exit codes are unchanged.
Add `--dry-run` for the preview alone.

| `type` | When |
|---|---|
| `start` | first: command, args, dry run, repos |
| `plan` | a repo is prepared: version, commits, promotion state, guard notice, or why it was refused |
| `promoted` | develop merged into staging |
| `dispatched` | the Pipeline run started (run id and URL) |
| `run` | the build's status changed |
| `rollout` | ArgoCD's state changed, or why the rollout is not confirmed |
| `pr` | promote opened (or would open) its PR, with the Slack message and whether it posted |
| `done` | a repo finished: `released`, `skipped` or `failed`, with the summary's detail |
| `end` | last: the exit code |
````

- [ ] **Step 4: SKILL.md** — after the "**Reading `vast status`.**" paragraph add:

```markdown
When you need the state as data rather than to read it, use `vast status --all --json`
and `vast doctor --json`; both print JSON only (`doctor --json` still exits 1 when a
check fails).
```

- [ ] **Step 5: CLAUDE.md** — add before `## Slack announcements`:

```markdown
## Machine-readable output (--json)

- `status --json` and `doctor --json` print one JSON document; `release --json` and
  `promote --json` stream NDJSON events (`src/utils/events.ts`). Stdout carries only
  JSON: `routeHumanOutputToStderr()` (`src/utils/json-mode.ts`) moves every human
  line to stderr at the command boundary, and the status board writes to stderr.
- Events come from the same call sites that update the board and build outcomes,
  through an `EventSink` (a no-op without --json). Never add a second code path
  that reconstructs events from text, and never print to stdout with
  `process.stdout.write` from command code except through the sink.
- Every repo in a stream gets a `plan` and a `done`, including one refused before
  deploying; every stream ends with `end` carrying the exit code. Vast Bar relies
  on both to tell "finished" from "still running".
```

- [ ] **Step 6: Verify docs against the CLI and run everything**

Run: `node bin/vast.js status --help | grep -- --json && node bin/vast.js release --help | grep -- --json && npm test 2>&1 | grep -E "^# (pass|fail)" && npm run typecheck && npm run bundle && node build/vast.mjs status --help | grep -- --json`
Expected: `# fail 0`; every grep finds its line.

- [ ] **Step 7: Commit, push, PR**

```bash
git add README.md skills/release/SKILL.md CLAUDE.md dist
git commit -m "docs(json): document --json output; rebuild dist"
git push -u origin feat/vast-bar
gh pr create --base main --title "feat: --json output for status, doctor, release and promote (Vast Bar phase 1)" --body "<summary of the four outputs, the event table, and the live check output from Step 2>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 8: Merge and release — only after Mostafa says ship**

```bash
gh pr merge <number> --merge && gh pr view <number> --json state -q .state
git checkout main && git pull --ff-only && git branch -d feat/vast-bar
npm version minor && git push --follow-tags
gh run list --workflow release --json headBranch,status,conclusion -q '.[] | select(.headBranch=="v2.9.0")'
gh release view v2.9.0 --json tagName,assets -q '.tagName + " " + (.assets|map(.name)|join(","))'
vast upgrade && vast --version
```

Expected: `MERGED`; `"conclusion":"success"`; `v2.9.0 vast.mjs`; installed `2.9.0`. That version is Vast Bar's minimum (spec).
