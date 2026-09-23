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
