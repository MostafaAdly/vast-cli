/**
 * Doctor Command
 *
 * One read-only screen answering "will a release work from here right now?",
 * so the next quiet change upstream is found before a deploy, not during one.
 * The checks themselves live in `src/utils/doctor.ts`; this file wires them to
 * the real readers and prints the result.
 */

import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import { Command } from 'commander';
import { REPOS, isReleasable } from '../config/repos.js';
import { repoDir } from '../config/workspace.js';
import { argocdHost, isArgocdEnabled, readArgocdToken } from '../config/argocd.js';
import { readSlackChannel, readSlackToken } from '../config/slack.js';
import { userinfo } from '../utils/argocd.js';
import { deployedTag, productionTag } from '../utils/deployments.js';
import { runDoctor, tally, type Check, type DoctorDeps } from '../utils/doctor.js';
import { authTest, channelInfo } from '../utils/slack.js';
import { ORG } from '../utils/remote.js';
import { colors, createHeader, createSpinner, log } from '../utils/ui.js';
import { VERSION } from '../version.js';

const execFileAsync = promisify(execFile);

async function gh(args: string[]): Promise<string> {
  return (await execFileAsync('gh', args)).stdout;
}

function liveDeps(): DoctorDeps {
  const releasable = REPOS.filter(isReleasable);
  return {
    now: Date.now(),
    nodeVersion: process.versions.node,
    has: (cmd) => {
      try {
        execFileSync('which', [cmd], { stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    },
    ghAuthenticated: async () => {
      try {
        await gh(['auth', 'status']);
        return true;
      } catch {
        return false;
      }
    },
    currentVersion: VERSION,
    latestRelease: async () => (await gh(['api', 'repos/MostafaAdly/vast-cli/releases/latest', '--jq', '.tag_name'])).trim() || null,
    repos: releasable,
    repoDir: (repo) => repoDir(repo),
    // The file deploys dispatch, on the branch they dispatch it on.
    fetchWorkflow: async (repo) => {
      const file = repo.workflow.staging ?? 'build-deploy.yml';
      const content = await gh(['api', `repos/${ORG}/${repo.name}/contents/.github/workflows/${file}?ref=staging`, '--jq', '.content']);
      return Buffer.from(content.replace(/\s+/g, ''), 'base64').toString('utf-8');
    },
    stagingTag: (repo) => deployedTag(repo, 'staging'),
    productionTag: async (repo, dir) => (await productionTag(repo, dir)).tag,
    argocd: (env) => {
      const token = readArgocdToken(env);
      return {
        enabled: isArgocdEnabled(env),
        hasToken: Boolean(token),
        session: () => userinfo(argocdHost(env), token ?? ''),
      };
    },
    slack: {
      token: readSlackToken(),
      channel: readSlackChannel(),
      authTest: async () => {
        await authTest(readSlackToken() ?? '');
      },
      channelName: async () => {
        const info = await channelInfo(readSlackToken() ?? '', readSlackChannel() ?? '');
        if (!info) return null;
        return info.isDm ? 'a direct message' : `#${info.name}`;
      },
    },
  };
}

const ICON: Record<Check['status'], string> = {
  ok: colors.success('✓'),
  warn: colors.warning('⚠'),
  fail: colors.error('✗'),
};

export function renderChecks(checks: Check[]): string[] {
  const width = Math.max(...checks.map((c) => c.label.length), 4);
  const lines: string[] = [];
  let group = '';
  for (const c of checks) {
    if (c.group !== group) {
      group = c.group;
      lines.push('', `  ${colors.primary(group.toUpperCase())}`);
    }
    const detail = c.status === 'ok' ? colors.muted(c.detail) : c.detail;
    lines.push(`  ${ICON[c.status]} ${c.label.padEnd(width)}  ${detail}`);
  }
  return lines;
}

async function executeDoctor(): Promise<void> {
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

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Check that a release will work from this machine')
    .addHelpText(
      'after',
      `
Reads only — it checks and reports, and changes nothing. Exits 1 when anything
would stop a release.

  $ vast doctor

What it checks:
  Tools      node 18+, git, gh installed and authenticated
  vast-cli   up to date; every releasable repo found on this machine
  ArgoCD     staging token valid, or that confirmation is disabled
  Repos      per releasable repo: build-deploy.yml on staging takes a
             \`version\` input; the staging tag is readable and can be
             incremented; the next version is above production's
  Slack      bot token valid and the channel reachable (only --slack needs it)

  ✗  a release or deploy would stop (no gh auth, no workflow, expired token)
  ⚠  it would run but degrade or need a flag (no ArgoCD token, a version
     behind production — release that repo with --fix-version)
  ✓  nothing to do
`,
    )
    .action(executeDoctor);
}
