/**
 * Release Command
 *
 * The whole staging ritual in one line: promote develop → staging, derive the
 * next release candidate from the deployed Helm tag, dispatch the workflow,
 * wait for it, and merge the version-bump PR.
 *
 * Several repos at once behave like one terminal per repo: each is promoted
 * and dispatched in turn — seconds of local git and gh — and then every CI run
 * is watched concurrently, so the whole thing takes about one build rather
 * than one per repo. One repo refusing never stops another.
 *
 * Staging only. Production has a human review gate in the middle, so it is two
 * commands (promote, then deploy) rather than one.
 */

import { Command } from 'commander';
import { REPOS, getRepo, isReleasable, type RepoConfig } from '../config/repos.js';
import { nextRc, bump as bumpVersion } from '../utils/version.js';
import { readDeployedTag } from '../utils/helm.js';
import { promote } from './promote.js';
import { repoDir } from '../config/workspace.js';
import {
  bumpPrTitle,
  deployOne,
  notClonedOutcome,
  printSummary,
  type DeployOutcome,
} from './deploy.js';
import {
  findPullRequest,
  getRunStatus,
  mergePullRequest,
  runUrl,
  runWorkflow,
} from '../utils/github.js';
import { DEFAULT_TIMING, formatElapsed, pollRun, type PollTiming } from '../utils/run-poll.js';
import { createStatusBoard, type StatusBoard, type Tone } from '../utils/status-board.js';
import { createHeader, createErrorBox, log } from '../utils/ui.js';

export interface ReleaseOptions {
  to: string;
  dir?: string;
  dryRun: boolean;
  targetVersion?: string;
  /** Start a new version series instead of continuing the current rc run. */
  bump?: 'patch' | 'minor' | 'major';
  skipPromote: boolean;
  all: boolean;
}

const BUMP_LEVELS = ['patch', 'minor', 'major'];

/**
 * Whether this repo has a develop branch to promote into staging.
 *
 * `vast promote <repo>` (explicit) still refuses when this is false — an
 * explicit ask to merge develop deserves an explanation, not a silent no-op.
 * Only `vast release` treats it as a skip.
 */
export function needsPromotion(repo: RepoConfig): boolean {
  return repo.promoteFrom.staging !== null;
}

/**
 * Option combinations that cannot mean anything, refused before any repo is
 * touched — never after the first repo has already been released.
 */
export function validateReleaseOptions(
  names: string[],
  options: { all: boolean; targetVersion?: string; dir?: string; bump?: string },
): string | null {
  if (options.all && names.length > 0) return 'Pass repository names or --all, not both.';
  if (options.bump && options.targetVersion) return '--bump and --target-version are mutually exclusive.';
  if (options.bump && !BUMP_LEVELS.includes(options.bump)) {
    return `Invalid --bump level: ${options.bump}. Use patch, minor, or major.`;
  }
  // A repo named twice is still one repo, so the count is of distinct names —
  // matching how releaseTargets dedupes, casing and all.
  const many = options.all || new Set(names.map((n) => n.toLowerCase())).size > 1;
  if (many && options.targetVersion) {
    return '--target-version is per repository — each repo derives its own. It cannot be used with --all or more than one repository.';
  }
  if (many && options.dir) {
    return '--dir names one checkout, so it cannot be used with --all or more than one repository.';
  }
  return null;
}

/**
 * Repos `vast release` acts on, in the order they were named, deduplicated.
 *
 * `--all` is filtered to releasable repos, so an unreleasable repo (no
 * workflow / no Helm) that simply is not cloned yet cannot fail the whole
 * sweep with a spurious "not cloned". Named repos are never filtered: an
 * explicit `vast release Terraform` deserves "no deploy workflow", not
 * "unknown repository".
 */
export function releaseTargets(
  names: string[],
  all: boolean,
): { repos: RepoConfig[]; unknown: string[] } {
  if (all) return { repos: REPOS.filter(isReleasable), unknown: [] };
  const repos: RepoConfig[] = [];
  const unknown: string[] = [];
  for (const name of names) {
    const repo = getRepo(name);
    if (!repo) unknown.push(name);
    else if (!repos.includes(repo)) repos.push(repo);
  }
  return { repos, unknown };
}

/** A repo that promoted cleanly and has a version: ready to dispatch. */
interface Prepared {
  repo: RepoConfig;
  workflow: string;
  version: string;
}

function isOutcome(x: Prepared | InFlight | DeployOutcome): x is DeployOutcome {
  return 'status' in x;
}

/**
 * Everything before the deploy: resolve the checkout, promote, derive the
 * version. Returns an outcome instead when the repo cannot go further.
 */
function prepareOne(repo: RepoConfig, options: ReleaseOptions): Prepared | DeployOutcome {
  const dir = repoDir(repo, options.dir);
  if (!dir) return notClonedOutcome(repo.name, options.all);

  if (!repo.workflow) {
    return { repo: repo.name, version: '—', status: 'skipped', detail: 'no deploy workflow exists' };
  }
  const helmPath = repo.helm.staging;
  if (!helmPath) {
    return { repo: repo.name, version: '—', status: 'skipped', detail: 'no staging Helm values' };
  }

  if (!options.skipPromote) {
    if (!needsPromotion(repo)) {
      // The backend repos have no usable develop — human PRs there target
      // staging directly. Failing the release for a promotion that cannot
      // exist made the everyday command unusable for that team and turned
      // every `release --all` sweep red. Skipping is not a policy change:
      // there is nothing to promote.
      log.muted(`  ${repo.name}: no develop to promote — deploying what is on staging`);
    } else if (!promote(repo, dir, 'staging', options.dryRun)) {
      return { repo: repo.name, version: '—', status: 'failed', detail: 'promotion refused' };
    }
  }

  let version: string;
  if (options.targetVersion) {
    version = options.targetVersion;
  } else {
    try {
      // Derived from what is DEPLOYED, not from the highest version ever cut.
      // Default continues the current rc series; --bump starts a new one at rc1.
      const deployed = readDeployedTag(dir, 'origin/staging', helmPath);
      version = options.bump ? bumpVersion(deployed, options.bump) : nextRc(deployed);
    } catch (error) {
      return {
        repo: repo.name,
        version: '—',
        status: 'failed',
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return { repo, workflow: repo.workflow, version };
}

/** One repo, start to finish, exactly as it has always run — live `gh run watch` included. */
async function releaseOne(repo: RepoConfig, options: ReleaseOptions): Promise<DeployOutcome> {
  const prep = prepareOne(repo, options);
  if (isOutcome(prep)) return prep;
  return deployOne(repo, 'staging', prep.version, options.dryRun);
}

/** A dispatched run the concurrent path is waiting on. */
export interface InFlight {
  repo: RepoConfig;
  version: string;
  runId: number;
}

/**
 * Kick one repo off: promote, derive, dispatch. Run for each repo in turn so
 * the dispatch spinner and run-id detection never interleave; the first build
 * is already running on GitHub while the next repo promotes.
 */
async function launchOne(repo: RepoConfig, options: ReleaseOptions): Promise<InFlight | DeployOutcome> {
  const prep = prepareOne(repo, options);
  if (isOutcome(prep)) return prep;
  // deployOne logs the "deploying X" line and returns the dry-run outcome
  // without dispatching anything, so a multi-repo dry run reads like a real one.
  if (options.dryRun) return deployOne(repo, 'staging', prep.version, true);

  log.info(`${repo.name}: deploying ${prep.version} to staging`);
  const result = await runWorkflow({
    repository: repo.name,
    version: prep.version,
    branch: 'staging',
    workflowName: prep.workflow,
  });
  if (!result.success || !result.runId) {
    return {
      repo: repo.name,
      version: prep.version,
      status: 'failed',
      detail: result.error ?? 'could not identify the dispatched run',
    };
  }
  return { repo, version: prep.version, runId: result.runId };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * How often to ask GitHub for each run's status, given how many are being
 * watched. One second per run keeps a big `--all` sweep from hammering the API
 * with one request per run every five seconds, and the floor keeps the common
 * two- or three-repo release as responsive as a single one.
 */
export function pollIntervalFor(runCount: number): number {
  return Math.max(5000, 1000 * runCount);
}

/**
 * The polling timing for a whole watch, live or piped.
 *
 * When the board is live each repo owns one line that is rewritten in place, so
 * a heartbeat on every poll costs no scrollback and keeps the elapsed time on
 * every line moving. Piped output appends instead, so it keeps the slow default
 * heartbeat rather than one line per repo every few seconds.
 */
export function pollTimingFor(runCount: number, live: boolean): PollTiming {
  const pollMs = pollIntervalFor(runCount);
  return {
    pollMs,
    heartbeatMs: live ? pollMs : DEFAULT_TIMING.heartbeatMs,
    maxConsecutiveErrors: DEFAULT_TIMING.maxConsecutiveErrors,
  };
}

/** The one line of the board a repo owns, and how wide its name is padded. */
export interface FinishSlot {
  board: StatusBoard;
  row: number;
  labelWidth: number;
}

/**
 * Wait for a dispatched run and merge its bump PR — deployOne's second half,
 * written to run alongside others. `gh run watch` would block the process and
 * repaint the screen, so the run is polled instead and every stage of it is
 * reported onto this repo's own line of the board.
 *
 * Nothing here may print directly: on a TTY the board tracks the cursor by
 * counting its own lines, so one stray `console.log` scrolls the rows out from
 * under it and every later update lands on the wrong line. The failure detail
 * still carries the run URL, since the live step view is gone.
 */
async function finishOne(
  flight: InFlight,
  slot: FinishSlot,
  timing: PollTiming,
): Promise<DeployOutcome> {
  const { repo, version, runId } = flight;
  const label = repo.name.padEnd(slot.labelWidth);
  const say = (line: string, tone: Tone): void => slot.board.update(slot.row, line, tone);
  const result = await pollRun(
    label,
    runId,
    {
      getStatus: () => getRunStatus(repo.name, runId),
      sleep,
      now: Date.now,
      print: (line) => slot.board.update(slot.row, line, 'muted'),
    },
    timing,
  );
  const took = formatElapsed(result.elapsedMs);
  const url = runUrl(repo.name, runId);

  if (!result.ok) {
    const why =
      result.error ??
      `run ${runId} ${result.conclusion === 'failure' ? 'failed' : (result.conclusion ?? 'completed without a conclusion')}`;
    // A run that could not be read has no conclusion to name and no useful run
    // page to point at, so the line carries the read error instead.
    const word = result.error
      ? 'unreadable'
      : result.conclusion === 'failure'
        ? 'failed'
        : (result.conclusion ?? 'completed without a conclusion');
    say(`  ${label}  run ${runId}  ${word}  ${took}  ${result.error ?? url}`, 'error');
    return { repo: repo.name, version, status: 'failed', detail: `${why} — ${url}` };
  }

  // Same budget as deployOne: the bump PR is opened by the workflow's last
  // step and can take a while to appear.
  say(`  ${label}  run ${runId}  succeeded  ${took}  looking for the bump PR...`, 'success');
  const prTitle = bumpPrTitle(version, 'staging');
  let prNumber: number | null = null;
  for (let i = 0; i < 45 && prNumber === null; i++) {
    prNumber = await findPullRequest(repo.name, prTitle);
    if (prNumber === null) await sleep(20000);
  }
  if (prNumber === null) {
    say(`  ${label}  run ${runId}  succeeded  ${took}  bump PR not found`, 'error');
    return { repo: repo.name, version, status: 'failed', detail: 'bump PR not found' };
  }

  try {
    await mergePullRequest(repo.name, prNumber);
    say(`  ${label}  run ${runId}  succeeded  ${took}  PR #${prNumber} merged`, 'success');
    return { repo: repo.name, version, status: 'released', detail: `PR #${prNumber}` };
  } catch (error) {
    say(`  ${label}  run ${runId}  succeeded  ${took}  could not merge PR #${prNumber}`, 'error');
    return {
      repo: repo.name,
      version,
      status: 'failed',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/** The two halves of a multi-repo release, injectable so they can be faked in tests. */
export interface ReleaseManyDeps {
  launch: (repo: RepoConfig, options: ReleaseOptions) => Promise<InFlight | DeployOutcome>;
  finish: (flight: InFlight, slot: FinishSlot, timing: PollTiming) => Promise<DeployOutcome>;
  /** Injectable so a test can record what each repo wrote to its line. */
  board?: (rows: number) => StatusBoard;
}

/**
 * Several repos, like one terminal per repo. Promote and dispatch each in turn
 * (seconds), then watch every run concurrently (minutes). Outcomes come back in
 * the order the repos were named, so the summary reads the way it was typed.
 *
 * allSettled rather than all: one repo's watch throwing must not swallow the
 * outcomes of the repos that finished fine. That is the whole promise of the
 * multi-repo path, so it is structural here rather than a matter of every
 * caller downstream remembering to catch.
 */
export async function releaseMany(
  targets: RepoConfig[],
  options: ReleaseOptions,
  deps: ReleaseManyDeps = { launch: launchOne, finish: finishOne },
): Promise<DeployOutcome[]> {
  const launched: Array<InFlight | DeployOutcome> = [];
  for (const repo of targets) launched.push(await deps.launch(repo, options));

  const flights = launched.filter((l): l is InFlight => !isOutcome(l));
  // Only a TTY can rewrite a line. Piped output (the /release skill runs the
  // CLI that way) appends instead, so it keeps the old one-line-per-change log.
  const live = process.stdout.isTTY === true;
  const timing = pollTimingFor(flights.length, live);
  const every = Math.round(timing.pollMs / 1000);
  if (flights.length > 0) {
    log.newline();
    log.info(
      live
        ? `Watching ${flights.length} run(s) — status every ${every}s`
        : `Watching ${flights.length} run(s) — status every ${every}s, ` +
            'one line per change, heartbeat every 30s',
    );
  }
  const labelWidth = Math.max(...flights.map((f) => f.repo.name.length), 0);
  // One board for every repo: two would each believe they own the cursor.
  const board = (deps.board ?? createStatusBoard)(flights.length);
  const settled = await Promise.allSettled(
    flights.map((f, i) => deps.finish(f, { board, row: i, labelWidth }, timing)),
  );
  const finished = settled.map((r, i): DeployOutcome =>
    r.status === 'fulfilled'
      ? r.value
      : {
          repo: flights[i].repo.name,
          version: flights[i].version,
          status: 'failed',
          detail: r.reason instanceof Error ? r.reason.message : String(r.reason),
        },
  );

  let next = 0;
  return launched.map((l) => (isOutcome(l) ? l : finished[next++]));
}

async function executeRelease(repoNames: string[], options: ReleaseOptions): Promise<void> {
  const problem = validateReleaseOptions(repoNames, options);
  if (problem) {
    log.error(problem);
    process.exit(1);
  }

  if (options.to !== 'staging') {
    console.log(
      createErrorBox(
        `\`release\` only targets staging`,
        'Production has a human review gate in the middle, so it is two steps:\n\n' +
          '    vast promote <repo> --to production    cut release/X.Y.Z + PR\n' +
          '    # review and merge that PR\n' +
          '    vast deploy  <repo> --to production    build and ship it\n\n' +
          'Add `--as hotfix` to the promote for a hotfix/X.Y.Z branch instead.\n' +
          'The promote works any time; only the deploy needs `vast production enable`.',
      ),
    );
    process.exit(1);
  }

  const { repos: targets, unknown } = releaseTargets(repoNames, options.all);
  if (unknown.length > 0) {
    log.error(`Unknown ${unknown.length === 1 ? 'repository' : 'repositories'}: ${unknown.join(', ')}`);
    process.exit(1);
  }
  if (targets.length === 0) {
    log.error('Specify a repository or --all');
    process.exit(1);
  }

  console.log(createHeader('Release', `${targets.length} repo(s) | → staging`));

  // A single repo keeps the live `gh run watch` view. Two or more cannot: it
  // blocks the process and repaints the screen, so they are polled instead.
  const outcomes =
    targets.length === 1
      ? [await releaseOne(targets[0], options)]
      : await releaseMany(targets, options);

  printSummary(outcomes, 'staging');
  if (outcomes.some((o) => o.status === 'failed')) process.exit(1);
}

export function registerReleaseCommand(program: Command): void {
  program
    .command('release')
    .description('Promote develop to staging, derive the version, deploy, merge the bump PR')
    .argument('[repositories...]', 'Repository name(s) (omit and pass --all for every repo)')
    .option('-t, --to <env>', 'Target environment (staging only)', 'staging')
    .option('-a, --all', 'Release every configured repo', false)
    .option('--dir <path>', 'Override the local checkout path (one repo only)')
    .option('-v, --target-version <version>', 'Override the derived version entirely (one repo only)')
    .option('--bump <level>', 'Start a new series: patch, minor, or major')
    .option('--skip-promote', 'Deploy what is already on the branch', false)
    .option('-n, --dry-run', 'Report what would happen without merging or deploying', false)
    .addHelpText(
      'after',
      `
Version derivation (from the tag currently deployed to staging):

  $ vast release VastPayPwa                  1.5.5-rc15 -> 1.5.5-rc16   continue the series
  $ vast release VastPayPwa --bump patch     1.5.5-rc15 -> 1.5.6-rc1    new patch series
  $ vast release VastPayPwa --bump minor     1.5.5-rc15 -> 1.6.0-rc1    new minor series
  $ vast release VastPayPwa --bump major     1.5.5-rc15 -> 2.0.0-rc1    new major series

  $ vast release VastPayPwa --dry-run        show the derived version, deploy nothing
  $ vast release VastPayPwa VastMenuPwa      both at once, one summary
  $ vast release --all                       every configured repo, one summary

Several repos release side by side, as if each had its own terminal: each is
promoted and dispatched in turn, then every CI run is watched at the same time,
each on its own line that updates in place (one line per change when output is
piped). One repo refusing never stops another.
--bump, --skip-promote and --dry-run apply to every repo named; --target-version
and --dir are per-repo and refused with --all or more than one repo.
`,
    )
    .action(executeRelease);
}
