/**
 * `vast doctor`: will a release work from this machine right now?
 *
 * Almost every past break came from something outside the CLI changing
 * quietly — the workflow rename on 2026-09-24, the ArgoCD sign-in wall — and
 * was found mid-deploy. These checks find
 * them first. Read-only: nothing here writes, dispatches or posts.
 *
 * Statuses mean what they mean for a release:
 *   fail  a release or deploy would stop (no gh auth, no workflow, expired token)
 *   warn  it would run but degrade or need a flag (no token, version behind production)
 *   ok    nothing to do
 *
 * Every dependency is injected, so the tests never touch the network or the
 * real ~/.vast-cli.
 */

import type { RepoConfig } from '../config/repos.js';
import { ArgoSsoWallError } from './argocd.js';
import { isNewer } from './update-check.js';
import { nextRc, parseTag } from './version.js';
import { checkAgainstProduction } from './version-guard.js';

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface Check {
  group: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface ArgoState {
  enabled: boolean;
  hasToken: boolean;
  /** Asks ArgoCD who the token belongs to; throws ArgoSsoWallError behind a sign-in wall. */
  session: () => Promise<{ loggedIn: boolean; username?: string }>;
}

export interface DoctorDeps {
  now: number;
  nodeVersion: string;
  has: (cmd: string) => boolean;
  ghAuthenticated: () => Promise<boolean>;
  currentVersion: string;
  latestRelease: () => Promise<string | null>;
  repos: RepoConfig[];
  repoDir: (repo: RepoConfig) => string | null;
  /** build-deploy.yml on the repo's staging branch. */
  fetchWorkflow: (repo: RepoConfig) => Promise<string>;
  stagingTag: (repo: RepoConfig) => Promise<string>;
  productionTag: (repo: RepoConfig) => Promise<string>;
  argocd: (env: 'staging') => ArgoState;
  slack: {
    token: string | null;
    channel: string | null;
    authTest: () => Promise<void>;
    /** How to name the target: `#releases`, or `a direct message`. Null when it is gone. */
    channelName: () => Promise<string | null>;
  };
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Whether the workflow can be dispatched with the one `version` input the CLI
 * sends. A text check rather than a YAML parse: no new dependency, and the
 * shape it looks for — `workflow_dispatch:` then `inputs:` then a `version:`
 * key — is the contract itself.
 */
export function workflowAcceptsVersion(yaml: string): boolean {
  const dispatch = yaml.indexOf('workflow_dispatch:');
  if (dispatch === -1) return false;
  return /\n\s+inputs:\s*\n(?:\s+.*\n)*?\s+version:\s*(?:\n|$)/.test(yaml.slice(dispatch));
}

export function tally(checks: Check[]): { fail: number; warn: number } {
  return {
    fail: checks.filter((c) => c.status === 'fail').length,
    warn: checks.filter((c) => c.status === 'warn').length,
  };
}

function toolChecks(deps: DoctorDeps): Check[] {
  const group = 'Tools';
  const major = Number(deps.nodeVersion.split('.')[0]);
  const checks: Check[] = [
    major >= 18
      ? { group, label: 'node', status: 'ok', detail: `v${deps.nodeVersion}` }
      : { group, label: 'node', status: 'fail', detail: `v${deps.nodeVersion} — vast needs Node 18 or newer` },
  ];
  if (!deps.has('git')) {
    checks.push({ group, label: 'git', status: 'fail', detail: 'not installed — vast shells out to git' });
  } else {
    checks.push({ group, label: 'git', status: 'ok', detail: 'installed' });
  }
  if (!deps.has('gh')) {
    checks.push({ group, label: 'gh', status: 'fail', detail: 'not installed — vast shells out to gh for everything' });
  }
  return checks;
}

async function cliCheck(deps: DoctorDeps): Promise<Check> {
  const base = { group: 'vast-cli', label: 'vast-cli' };
  const latest = await deps.latestRelease();
  if (!latest) return { ...base, status: 'warn', detail: `${deps.currentVersion} — could not check for a newer release` };
  if (isNewer(latest, deps.currentVersion)) {
    return { ...base, status: 'warn', detail: `${deps.currentVersion} → ${latest.replace(/^v/, '')} available — run \`vast upgrade\`` };
  }
  return { ...base, status: 'ok', detail: `${deps.currentVersion}, up to date` };
}

function checkoutCheck(deps: DoctorDeps): Check {
  const base = { group: 'vast-cli', label: 'Checkouts' };
  const missing = deps.repos.filter((r) => !deps.repoDir(r)).map((r) => r.name);
  const found = deps.repos.length - missing.length;
  if (missing.length === 0) return { ...base, status: 'ok', detail: `all ${found} releasable repos found` };
  return {
    ...base,
    status: 'warn',
    detail: `${found} of ${deps.repos.length} found; not here: ${missing.join(', ')} — \`vast init\` if they are cloned somewhere, \`vast clone\` if not`,
  };
}

async function argocdChecks(deps: DoctorDeps): Promise<Check[]> {
  const group = 'ArgoCD';
  const label = 'ArgoCD staging';
  const argo = deps.argocd('staging');
  if (!argo.enabled) {
    return [{ group, label, status: 'warn', detail: 'confirmation disabled — rollouts go unconfirmed; `vast argocd enable` to turn it on' }];
  }
  if (!argo.hasToken) {
    return [{ group, label, status: 'warn', detail: 'no token — rollouts go unconfirmed; run `vast argocd login`' }];
  }
  try {
    const who = await argo.session();
    return [
      who.loggedIn
        ? { group, label, status: 'ok', detail: `token valid${who.username ? ` — ${who.username}` : ''}` }
        : { group, label, status: 'fail', detail: 'token expired — deploys stop before the build; run `vast argocd login`' },
    ];
  } catch (error) {
    return [
      error instanceof ArgoSsoWallError
        ? { group, label, status: 'warn', detail: 'API answered with a browser sign-in page — rollouts go unconfirmed; ask DevOps to keep /api/* outside any sign-in rule' }
        : { group, label, status: 'warn', detail: `could not reach ArgoCD — ${message(error)}` },
    ];
  }
}

/** Each repo's problems, or one ok line saying what was checked. */
async function repoChecks(deps: DoctorDeps, repo: RepoConfig): Promise<Check[]> {
  const group = 'Repos';
  const label = repo.name;
  const issues: Check[] = [];
  const [workflow, staging, production] = await Promise.allSettled([
    deps.fetchWorkflow(repo),
    deps.stagingTag(repo),
    deps.productionTag(repo),
  ]);

  if (workflow.status === 'rejected') {
    issues.push({ group, label, status: 'fail', detail: `cannot read build-deploy.yml on staging — deploys cannot dispatch (${message(workflow.reason)})` });
  } else if (!workflowAcceptsVersion(workflow.value)) {
    issues.push({ group, label, status: 'fail', detail: 'build-deploy.yml takes no `version` input on workflow_dispatch — deploys cannot dispatch' });
  }

  let next: string | null = null;
  if (staging.status === 'rejected') {
    issues.push({ group, label, status: 'fail', detail: `cannot read the staging tag — ${message(staging.reason)}` });
  } else {
    try {
      next = nextRc(staging.value);
    } catch {
      issues.push({ group, label, status: 'warn', detail: `staging tag ${staging.value} cannot be incremented — release it with --target-version` });
    }
  }

  if (production.status === 'rejected') {
    issues.push({ group, label, status: 'warn', detail: `cannot read the production tag — releases go unchecked against it (${message(production.reason)})` });
  } else if (next) {
    try {
      parseTag(production.value);
      const verdict = checkAgainstProduction(next, production.value);
      if (verdict.kind === 'behind') {
        issues.push({
          group,
          label,
          status: 'warn',
          detail: `next ${next} is not above production ${production.value} — release it with --fix-version (→ ${verdict.corrected})`,
        });
      }
    } catch {
      issues.push({ group, label, status: 'warn', detail: `production tag ${production.value} cannot be compared` });
    }
  }

  if (issues.length > 0) return issues;
  const prod = production.status === 'fulfilled' ? production.value : '?';
  return [{ group, label, status: 'ok', detail: `workflow ok · next ${next} · production ${prod}` }];
}

async function slackCheck(deps: DoctorDeps): Promise<Check> {
  const base = { group: 'Slack', label: 'Slack' };
  if (!deps.slack.token || !deps.slack.channel) {
    return { ...base, status: 'warn', detail: 'not set up — only `--slack` needs it; `vast slack setup`' };
  }
  try {
    await deps.slack.authTest();
  } catch (error) {
    return { ...base, status: 'fail', detail: `token rejected — ${message(error)}; run \`vast slack setup\`` };
  }
  const name = await deps.slack.channelName();
  if (!name) return { ...base, status: 'fail', detail: `channel ${deps.slack.channel} not found — run \`vast slack setup\`` };
  return { ...base, status: 'ok', detail: `token valid, posts to ${name}` };
}

/** A check that throws becomes a warning about itself, never a crashed run. */
async function guarded(group: string, label: string, run: () => Promise<Check[]>): Promise<Check[]> {
  try {
    return await run();
  } catch (error) {
    return [{ group, label, status: 'warn', detail: `check failed to run — ${message(error)}` }];
  }
}

export async function runDoctor(deps: DoctorDeps): Promise<Check[]> {
  const checks = toolChecks(deps);
  if (!deps.has('gh')) return checks;

  if (!(await deps.ghAuthenticated())) {
    // Every remaining check goes through gh; they would all fail the same way.
    checks.push({ group: 'Tools', label: 'gh', status: 'fail', detail: 'not authenticated — run `gh auth login`' });
    return checks;
  }
  checks.push({ group: 'Tools', label: 'gh', status: 'ok', detail: 'authenticated' });

  const rest = await Promise.all([
    guarded('vast-cli', 'vast-cli', async () => [await cliCheck(deps)]),
    guarded('vast-cli', 'Checkouts', async () => [checkoutCheck(deps)]),
    guarded('ArgoCD', 'ArgoCD staging', () => argocdChecks(deps)),
    ...deps.repos.map((repo) => guarded('Repos', repo.name, () => repoChecks(deps, repo))),
    guarded('Slack', 'Slack', async () => [await slackCheck(deps)]),
  ]);
  return [...checks, ...rest.flat()];
}
