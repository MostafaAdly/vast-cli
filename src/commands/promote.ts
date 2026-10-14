/**
 * Promote Command
 *
 * The merge half of the release chain: fast-forward both branches, verify the
 * merge is clean without touching the working tree, then merge and push.
 *
 * Refuses on conflict. It never attempts a resolution — a stranded half-merged
 * checkout is the exact failure this replaces.
 *
 * Production is different in kind: it opens a reviewed release/X.Y.Z pull
 * request and stops. Nothing here merges it, and it is gated on the production
 * lock being lifted.
 */

import { Command, Option } from 'commander';
import { existsSync } from 'fs';
import { join } from 'path';
import { getRepo, type RepoConfig } from '../config/repos.js';
import { repoDir } from '../config/workspace.js';
import {
  isClean,
  fetch as gitFetch,
  aheadBehind,
  trialMerge,
  mergeAndPush,
  syncLocalBranch,
} from '../utils/git.js';
import { deployedTag } from '../utils/deployments.js';
import {
  cutReleaseBranch,
  cutPickedBranch,
  releaseBranchName,
  RELEASE_KINDS,
  type ReleaseKind,
  type CutResult,
} from '../utils/release-branch.js';
import { resolvePicks, type ResolvedPick } from '../utils/picks.js';
import { nextPatch, stripRc } from '../utils/version.js';
import { ORG } from '../utils/remote.js';
import { commitSubjects, type BodyMode } from '../utils/changelog.js';
import {
  prNumbersInRange,
  prNumbersOfPicks,
  shippedPrs,
  resolveMentions,
  type ShippedPr,
} from '../utils/shipped.js';
import { summarizePrs } from '../utils/pr-summary.js';
import { readSlackToken, readSlackChannel, slackUserOverride } from '../config/slack.js';
import { lookupUserByEmail, postMessage } from '../utils/slack.js';
import { buildReleaseMessage, releaseContributors } from '../utils/release-message.js';
import { createHeader, createErrorBox, log } from '../utils/ui.js';
import { newReport, promoteState, type PromotionReport } from '../utils/promotion-report.js';
import { ndjsonSink, NO_EVENTS, streamToEnd, type EventSink, type SlackResult } from '../utils/events.js';
import { errorMessage, firstLine, reportUnexpectedError } from '../utils/errors.js';
import { routeHumanOutputToStderr } from '../utils/json-mode.js';

/**
 * Fast-forward the local branches this promotion reads, and say what came in.
 *
 * A branch that has diverged locally is reported and skipped rather than
 * aborting: the promotion merges `origin/*`, so its correctness never depended
 * on the local ref being current.
 */
function syncBranches(repo: RepoConfig, dir: string, to: 'staging' | 'production'): void {
  const branches =
    to === 'production'
      ? ['staging', 'production']
      : [repo.promoteFrom.staging, 'staging'].filter((b): b is string => Boolean(b));

  for (const branch of branches) {
    try {
      const gained = syncLocalBranch(dir, branch);
      if (gained > 0) log.muted(`  pulled ${gained} new commit(s) into ${branch}`);
    } catch {
      log.warn(
        `${branch} has local commits that are not on origin/${branch} — leaving it alone. ` +
          `The promotion still uses origin/${branch}.`,
      );
    }
  }
}

/**
 * Everything the announcement reaches outside itself, in one injectable bag —
 * so the announce step can be tested end to end without a network, a Slack
 * workspace, or an authenticated gh.
 */
export interface AnnounceDeps {
  readSlackToken: () => string | null;
  readSlackChannel: () => string | null;
  slackUserOverride: (login: string) => string | null;
  lookupUserByEmail: (token: string, email: string) => Promise<string | null>;
  postMessage: (
    token: string,
    channel: string,
    text: string,
    blocks: unknown[],
  ) => Promise<{ ts: string; channel: string }>;
  shippedPrs: (repo: string, numbers: number[]) => Promise<ShippedPr[]>;
  summarizePrs: typeof summarizePrs;
  buildReleaseMessage: typeof buildReleaseMessage;
}

const defaultAnnounceDeps: AnnounceDeps = {
  readSlackToken,
  readSlackChannel,
  slackUserOverride,
  lookupUserByEmail: (token, email) => lookupUserByEmail(token, email),
  postMessage: (token, channel, text, blocks) => postMessage(token, channel, text, fetch, blocks),
  shippedPrs: (repo, numbers) => shippedPrs(repo, numbers),
  summarizePrs,
  buildReleaseMessage,
};

/**
 * Tell the team a release PR is open.
 *
 * Runs only AFTER the PR exists, and never fails the promotion: by this point
 * the branch is pushed and the PR is open, so a missing token or an unreachable
 * Slack costs the announcement and nothing else. Every path that cannot post
 * prints the message instead, so the operator can paste it by hand.
 */
export async function announceRelease(
  repo: RepoConfig,
  dir: string,
  kind: ReleaseKind,
  version: string,
  url: string | null,
  opts: { dryRun: boolean; picks?: ResolvedPick[] },
  deps: AnnounceDeps = defaultAnnounceDeps,
): Promise<SlackResult> {
  const branch = releaseBranchName(kind, version);
  const picks = opts.picks ?? [];

  // On a dry run the branch was never cut, so the closest honest stand-in for
  // what it would carry is staging itself.
  const head = opts.dryRun ? 'origin/staging' : branch;
  const numbers = picks.length > 0 ? prNumbersOfPicks(picks) : prNumbersInRange(dir, 'origin/production', head);

  const prs = await deps.shippedPrs(repo.name, numbers);
  // Commit subjects back the message up when a PR could not be read — or when
  // the work landed without going through a PR at all. A dry-run pick has no
  // cut branch, and staging stands in for far more than was picked, so the
  // picks' own subjects are the honest fallback there.
  const fallbackSubjects =
    opts.dryRun && picks.length > 0
      ? picks.map((p) => p.subject)
      : commitSubjects(dir, 'origin/production', head);
  // Only what a summary needs: the model is never shown who wrote the PR.
  const summaries = await deps.summarizePrs(prs.map(({ number, title, branch }) => ({ number, title, branch })));
  const contributors = releaseContributors(prs);
  const mentions = await resolveMentions(contributors, {
    token: deps.readSlackToken(),
    lookup: deps.lookupUserByEmail,
    override: deps.slackUserOverride,
  });

  const { text, blocks } = deps.buildReleaseMessage({
    displayName: repo.displayName,
    branch,
    // No PR exists on a dry run; the repo's PR list is the nearest real link.
    prUrl: url ?? `https://github.com/${ORG}/${repo.name}/pulls`,
    prs,
    summaries,
    fallbackSubjects,
    mentions,
  });

  if (opts.dryRun) {
    console.log(createHeader('Slack message (dry run)', `${repo.displayName} | ${branch}`));
    console.log(text);
    // What is printed is the plain fallback; the post itself is a rich_text
    // bullet, and a reader of the dry run should not expect a typed "•".
    console.log('  (Slack renders this as a bulleted list item with real mentions and ticket links)');
    return { text, posted: false, error: null };
  }

  const token = deps.readSlackToken();
  const channel = deps.readSlackChannel();
  if (!token || !channel) {
    console.log(text);
    log.warn('Slack not configured — run vast slack setup');
    return { text, posted: false, error: 'Slack not configured — run vast slack setup' };
  }

  try {
    await deps.postMessage(token, channel, text, blocks);
    log.success(`announced in ${channel}`);
    return { text, posted: true, error: null };
  } catch (error) {
    // Deliberately not a failure: the release PR is already open, and the
    // operator now has the exact text to post by hand.
    const message = error instanceof Error ? error.message : String(error);
    log.error(`could not announce in Slack: ${message}`);
    console.log(text);
    return { text, posted: false, error: message };
  }
}

/**
 * @returns true when the promotion completed (or would have, under dryRun).
 *
 * Async because a production promotion derives its version from the live tag,
 * read over the API from Vast-deployments — or, while production is not
 * migrated, from the app repo's own Helm on `origin/production`.
 */
export async function promote(
  repo: RepoConfig,
  dir: string,
  to: 'staging' | 'production',
  dryRun: boolean,
  kind: ReleaseKind = 'release',
  targetVersion?: string,
  bodyMode: BodyMode = 'changelog',
  pickRefs: string[] = [],
  slack = false,
  report: PromotionReport = newReport(),
  announceDeps: AnnounceDeps = defaultAnnounceDeps,
): Promise<boolean> {
  // Every refusal goes through here so the report always knows why it stopped.
  // The title alone can lose the cause ("cannot derive a release version"), so
  // the body's first line rides along.
  const refuse = (title: string, body: string): false => {
    console.log(createErrorBox(title, body));
    report.result = 'refused';
    const cause = body.split('\n').find((line) => line.trim() !== '')?.trim();
    report.error = cause ? `${title}: ${cause}` : title;
    return false;
  };

  // A cut that names a problem is reported as refused, dry run or not: a
  // preview must not promise a PR the real run would refuse to open. A dry
  // run still returns true, as it always has — its exit code and its Slack
  // preview are unchanged; the report is what says it would refuse.
  const recordCut = (cut: CutResult): boolean => {
    report.url = cut.url;
    if (cut.problem !== null || (cut.url === null && !dryRun)) {
      report.result = 'refused';
      report.error = cut.problem ?? `could not cut ${report.branch} or open its PR`;
      return dryRun;
    }
    report.result = cut.url !== null ? 'pr opened' : 'would open pr';
    return true;
  };

  // Deliberately NOT gated on the production lock. Cutting a branch and opening
  // a PR ships nothing; the lock guards the deploy that follows the merge.
  if (!existsSync(join(dir, '.git'))) {
    return refuse(`${repo.name} is not cloned`, `Expected a checkout at ${dir}`);
  }

  if (!isClean(dir)) {
    return refuse(`${repo.name} has uncommitted changes`, 'Commit or stash them before promoting.');
  }

  gitFetch(dir);

  // Bring the local branches up to date with what was just fetched. The merge
  // below reads origin/* either way, so this is about not leaving the checkout
  // sitting on a stale develop after the promotion.
  syncBranches(repo, dir, to);

  if (to === 'production') {
    if (!repo.deployments.staging) {
      return refuse(
        `${repo.name}: no staging deployments file`,
        'Cannot derive a release version.',
      );
    }
    if (pickRefs.length > 0) {
      const { picks, merges, warnings, errors } = resolvePicks(dir, ORG, repo.name, pickRefs);
      if (errors.length > 0) {
        return refuse(
          `${repo.name}: ${errors.length} pick(s) cannot be promoted`,
          errors.map((e) => `• ${e}`).join('\n'),
        );
      }
      if (picks.length === 0 && merges.length === 0) {
        return refuse(`${repo.name}: nothing to pick`, 'Every ref resolved to nothing.');
      }
      // The one loudly-permitted exception to the staging-only rule: a branch
      // cut from production skipped staging by definition.
      for (const w of warnings) log.warn(w);

      let version: string;
      // The tag comes from Vast-deployments, or from the app repo's own Helm when
      // its production file is missing; the line below says which.
      if (targetVersion) {
        version = targetVersion;
      } else {
        if (!repo.deployments.production) {
          return refuse(
            `${repo.name}: no production deployments file`,
            'Pass --target-version explicitly.',
          );
        }
        try {
          // A selective promotion advances production's OWN tag — staging's
          // version would claim content production did not receive.
          version = nextPatch(await deployedTag(repo, 'production'));
        } catch (error) {
          return refuse(
            `${repo.name}: cannot derive a hotfix version`,
            `${error instanceof Error ? error.message : String(error)}\n\n` +
              `Re-run with an explicit version:\n` +
              `    vast promote ${repo.name} --to production --pick ... --target-version X.Y.Z`,
          );
        }
      }

      const what = [
        picks.length ? `${picks.length} pick(s)` : '',
        merges.length ? `${merges.length} branch merge(s)` : '',
      ]
        .filter(Boolean)
        .join(' + ');
      report.commits = picks.length + merges.length;
      report.version = version;
      report.kind = kind;
      report.branch = releaseBranchName(kind, version);
      log.info(`${repo.name}: ${what} → production, ${kind} ${version}`);
      const cut = cutPickedBranch(dir, repo.name, kind, version, picks, dryRun, bodyMode, merges);
      const ok = recordCut(cut);
      const url = cut.url;
      // A dry run never returns a URL, but it still has a message to show.
      if (slack && ok) {
        report.slack = await announceRelease(repo, dir, kind, version, url, { dryRun, picks }, announceDeps);
      }
      if (url !== null) {
        // Deliberately not a `vast deploy` hint any more: production has not
        // moved to the new pipeline, so that command would only refuse.
        log.muted(`  after the PR is merged, deploy ${version} to production by hand`);
        if (merges.length > 0) {
          log.warn(
            `port the fix back: merge ${merges.map((m) => m.name).join(', ')} into develop/staging too, or the bug stays there`,
          );
        }
      }
      return ok;
    }

    const { ahead } = aheadBehind(dir, 'origin/staging', 'origin/production');
    if (ahead === 0) {
      log.info(`${repo.name}: production already contains staging. Nothing to release.`);
      report.commits = 0;
      report.result = 'nothing to promote';
      return true;
    }
    let version: string;
    if (targetVersion) {
      version = targetVersion;
    } else {
      try {
        version = stripRc(await deployedTag(repo, 'staging'));
      } catch (error) {
        return refuse(
          `${repo.name}: cannot derive a release version`,
          `${error instanceof Error ? error.message : String(error)}\n\n` +
            `Re-run with an explicit version:\n` +
            `    vast promote ${repo.name} --to production --target-version X.Y.Z`,
        );
      }
    }

    report.commits = ahead;
    report.version = version;
    report.kind = kind;
    report.branch = releaseBranchName(kind, version);
    log.info(`${repo.name}: ${ahead} commit(s) staging → production, ${kind} ${version}`);
    const cut = cutReleaseBranch(dir, repo.name, kind, version, dryRun, bodyMode);
    const ok = recordCut(cut);
    if (slack && ok) {
      report.slack = await announceRelease(repo, dir, kind, version, cut.url, { dryRun }, announceDeps);
    }
    return ok;
  }

  const from = repo.promoteFrom.staging;
  if (!from) {
    return refuse(
      `Cannot promote ${repo.name} into staging`,
      `No promotion source is configured. ${repo.name} has no usable \`develop\` — ` +
        `human PRs there target \`staging\` directly, so merging \`develop\` would ` +
        `regress it by hundreds of commits.`,
    );
  }

  const { ahead } = aheadBehind(dir, `origin/${from}`, 'origin/staging');
  if (ahead === 0) {
    log.info(`${repo.name}: staging already contains ${from}. Nothing to promote.`);
    report.commits = 0;
    report.result = 'nothing to promote';
    return true;
  }

  const trial = trialMerge(dir, 'origin/staging', `origin/${from}`);
  if (!trial.clean) {
    return refuse(
      `${repo.name}: ${from} → staging conflicts`,
      `${trial.conflicts.length} conflicting file(s):\n` +
        trial.conflicts.map((f) => `  • ${f}`).join('\n') +
        `\n\nNothing was changed. Resolve these before promoting.`,
    );
  }

  log.info(`${repo.name}: ${ahead} commit(s) from ${from} → staging, merge is clean`);

  if (dryRun) {
    log.muted('  (dry run — no merge performed)');
    report.commits = ahead;
    report.result = 'would merge';
    return true;
  }

  // Counted before the push, so a push that throws still says what it carried.
  report.commits = ahead;
  mergeAndPush(dir, 'staging', `origin/${from}`);
  report.result = 'merged';
  log.success(`${repo.name}: ${from} → staging pushed`);
  return true;
}

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

/**
 * What a finished promotion means for the stream's `done`, read from the
 * report rather than from promote's return value: a dry run that would refuse
 * returns true (exit 0) but its report says refused.
 */
function promotionDone(
  report: PromotionReport,
  dryRun: boolean,
): { status: 'released' | 'skipped' | 'failed'; detail: string } {
  if (report.result === 'refused') return { status: 'failed', detail: report.error ?? 'promotion refused' };
  if (report.result === 'nothing to promote') return { status: 'skipped', detail: 'nothing to promote' };
  if (dryRun) return { status: 'skipped', detail: 'dry run' };
  if (report.result === 'pr opened') return { status: 'released', detail: `PR opened — ${report.url}` };
  return { status: 'released', detail: 'promoted' };
}

export async function runPromote(
  repoName: string,
  options: PromoteCommandOptions,
  events: EventSink,
  args: string[],
  announceDeps?: AnnounceDeps,
): Promise<number> {
  const repo = getRepo(repoName);
  if (!repo) {
    log.error(`Unknown repository: ${repoName}`);
    return 1;
  }

  if (options.to !== 'staging' && options.to !== 'production') {
    log.error(`Invalid --to value: ${options.to}. Use staging or production.`);
    return 1;
  }

  if (options.as !== undefined && !RELEASE_KINDS.includes(options.as)) {
    log.error(`Invalid --as value: ${options.as}. Use ${RELEASE_KINDS.join(' or ')}.`);
    return 1;
  }

  if (options.pick?.length && options.to !== 'production') {
    log.error('--pick is production-only. Staging always promotes all of develop.');
    return 1;
  }

  // There is nothing to announce about a staging promotion: it opens no PR,
  // and staging moves many times a day.
  if (options.slack && options.to !== 'production') {
    log.error('--slack is production-only. A staging promotion opens no release PR to announce.');
    return 1;
  }

  // A selective promotion is definitionally a hotfix, so --pick flips the
  // default; --as still overrides either way.
  const kind: ReleaseKind = options.as ?? (options.pick?.length ? 'hotfix' : 'release');

  const label = options.to === 'production' ? `→ production (${kind})` : '→ staging';
  console.log(createHeader('Promote', `${repo.name} | ${label}`));
  // --no-changelog wins over --summarize: asking for no description at all is
  // the more specific request.
  const bodyMode: BodyMode = !options.changelog
    ? 'bare'
    : options.summarize || options.llm
      ? 'summarize'
      : 'changelog';

  const dir = repoDir(repo, options.dir);
  if (!dir) {
    console.log(
      createErrorBox(`${repo.name} is not cloned`, 'Run `vast init`, or clone it with `vast clone`.'),
    );
    return 1;
  }

  events.emit({ type: 'start', command: 'promote', args, dryRun: options.dryRun, repos: [repo.name] });

  const report = newReport();
  let succeeded: boolean;
  try {
    succeeded = await promote(
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
      announceDeps,
    );
  } catch (error) {
    // A throw (a push, a git call, gh) must still end the stream with plan and
    // done, or the app shows a promotion that never ends. The report keeps any
    // success it recorded before the throw — a PR already opened stays opened —
    // otherwise it is still at its default, 'refused'. The whole error is
    // printed; the stream carries its first line.
    if (report.result === 'refused') report.error = firstLine(errorMessage(error));
    succeeded = false;
    reportUnexpectedError(error);
  }
  // The stream reads the report; the exit code stays promote's own answer.
  const ok = report.result !== 'refused';
  events.emit({
    type: 'plan',
    repo: repo.name,
    ok,
    version: report.version ?? '—',
    commits: report.commits,
    promote: promoteState(report.result),
    notice: null,
    detail: ok ? null : (report.error ?? null),
  });
  if (options.to === 'staging' && report.result === 'merged') {
    events.emit({ type: 'promoted', repo: repo.name, commits: report.commits ?? 0 });
  }
  // A refused cut opened no PR and would open none: no `pr` event for it.
  if (report.branch && report.version && report.result !== 'refused') {
    events.emit({
      type: 'pr',
      repo: repo.name,
      branch: report.branch,
      url: report.url ?? null,
      version: report.version,
      slack: report.slack ?? null,
    });
  }
  const done = promotionDone(report, options.dryRun);
  events.emit({ type: 'done', repo: repo.name, version: report.version ?? '—', status: done.status, detail: done.detail });
  return succeeded ? 0 : 1;
}

async function executePromote(repoName: string, options: PromoteCommandOptions): Promise<void> {
  if (!options.json) {
    const code = await runPromote(repoName, options, NO_EVENTS, process.argv.slice(2));
    if (code !== 0) process.exit(code);
    return;
  }
  // stdout is a data channel from here on: one JSON object per line, and
  // `end` is always the last of them, even after a throw.
  routeHumanOutputToStderr();
  const events = ndjsonSink();
  process.exitCode = await streamToEnd(events, () => runPromote(repoName, options, events, process.argv.slice(2)));
}

export function registerPromoteCommand(program: Command): void {
  program
    .command('promote')
    .description('Merge develop into staging, or open a release PR into production')
    .argument('<repository>', 'Repository name')
    .option('-t, --to <env>', 'Target environment: staging or production', 'staging')
    .option('--as <kind>', 'Production branch kind: release or hotfix (hotfix when --pick is used)')
    .option(
      '-p, --pick <ref...>',
      'Promote only these changes: commit SHA, PR number/#number, PR link, or commit link',
    )
    .option('-v, --target-version <version>', 'Override the derived release version')
    .option('--no-changelog', 'Open the PR with a bare description, no change summary')
    .option('-s, --summarize', 'Describe the diff with a small local model instead of commits')
    .option('--slack', 'Announce the release PR in Slack')
    .addOption(new Option('--llm').hideHelp())
    .option('--dir <path>', 'Override the local checkout path')
    .option('-n, --dry-run', 'Report what would happen without merging', false)
    .option('--json', 'Stream the result as JSON lines on stdout (human output goes to stderr)', false)
    .addHelpText(
      'after',
      `
Examples:
  $ vast promote VastPayPwa                             develop -> staging, push
  $ vast promote VastPayPwa --dry-run                   check conflicts, change nothing
  $ vast promote VastPayPwa --to production             cut release/X.Y.Z + PR
  $ vast promote VastPayPwa --to production --as hotfix cut hotfix/X.Y.Z + PR
  $ vast promote VastPayPwa --to production --no-changelog   bare PR description
  $ vast promote VastPayPwa --to production --slack     cut the PR, announce it
  $ vast promote VastPayPwa --to production --slack -n  print the message only
  $ vast promote VastPayPwa --to production -n --json   the PR it would open, as JSON

Slack announcement (--slack, production only):
  Runs after the release PR is open and posts one Slack bullet naming what
  shipped: a short summary of each PR in ascending PR order, everyone who
  worked on them, and any ClickUp ticket the PRs carried. People are
  @-mentioned when their commit email matches a Slack account; anyone it
  cannot match is named in plain text instead.

  It never fails the promotion. With no token or channel configured, and if
  Slack refuses the post, the message is printed for you to paste by hand and
  the promotion still succeeds — the PR is already open by then.

  With --dry-run nothing is sent: the message is printed as it would read,
  built from origin/production..origin/staging, since no branch exists yet.

  Configure it with \`vast slack setup\`.

PR description (production only):
  default          bullets from the commit subjects being promoted, grouped
                   into Features / Fixes / Improvements / Maintenance
  --summarize      a small local model reads the diff and describes it instead;
                   slower and not reproducible, but catches changes nobody
                   wrote a good commit message for. Falls back to the default
                   if it is unavailable or the output fails screening.
  --no-changelog   a one-line description

Descriptions never contain tool instructions or any note about how they were
produced — the whole team reads them.

Preparing a production release is NOT gated on anything — cutting a branch and
opening a PR ships nothing. The PR is opened for review and is never merged by
this tool.

The production DEPLOY that follows is currently blocked: production has not
moved to the new Vast-deployments + ArgoCD pipeline, so \`vast deploy --to
production\` refuses and the deploy is done by hand. Versions here are derived
from Vast-deployments (release = staging's tag without its -rc suffix; hotfix =
production's own tag plus a patch).
`,
    )
    .action(executePromote);
}
