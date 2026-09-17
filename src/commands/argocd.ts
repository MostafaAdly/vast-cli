/**
 * ArgoCD Command
 *
 * Manages the ArgoCD session token that `vast release` and `vast deploy` need
 * in order to confirm a rollout. ArgoCD uses local accounts, so there is no SSO
 * to fall back on: one login per token lifetime, stored 0600 under the CLI home.
 *
 * The password is read hidden, sent once, and never stored or printed. Neither
 * is the token — `status` says whether one exists and whether it still works,
 * and nothing more.
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import { DEPLOY_ENVS, type DeployEnv } from '../config/repos.js';
import {
  argocdFile,
  argocdHost,
  forgetArgocdToken,
  readArgocdToken,
  saveArgocdToken,
} from '../config/argocd.js';
import { login as argoLogin, userinfo } from '../utils/argocd.js';
import { createHeader, createInfoBox, createSuccessBox, formatKeyValue, log } from '../utils/ui.js';

function parseEnv(value: string): DeployEnv {
  const env = value.trim().toLowerCase();
  if (!(DEPLOY_ENVS as string[]).includes(env)) {
    log.error(`Unknown environment "${value}". Expected one of: ${DEPLOY_ENVS.join(', ')}`);
    process.exit(1);
  }
  return env as DeployEnv;
}

async function login(options: { to: string; username?: string }): Promise<void> {
  const env = parseEnv(options.to);
  const host = argocdHost(env);

  console.log(createHeader('ArgoCD login', host));

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'username',
      message: 'ArgoCD username:',
      when: !options.username,
      validate: (value: string) => (value.trim() ? true : 'Username is required'),
    },
    {
      type: 'password',
      name: 'password',
      mask: '*',
      message: 'ArgoCD password:',
      validate: (value: string) => (value ? true : 'Password is required'),
    },
  ]);

  const username = (options.username ?? answers.username).trim();

  let token: string;
  try {
    token = await argoLogin(host, username, answers.password);
  } catch (error) {
    // The message comes from ArgoCD ("Invalid username or password"); the
    // credentials themselves are never part of it.
    log.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  saveArgocdToken(env, token, username);
  console.log(
    createSuccessBox(
      `Logged in to ${host} as ${username}`,
      `Token stored for ${env} in ${argocdFile(env)} (owner-only).\n` +
        'It is used to confirm rollouts during release and deploy. Check it any\n' +
        'time with `vast argocd status`; drop it with `vast argocd logout`.',
    ),
  );
}

async function status(): Promise<void> {
  console.log(createHeader('ArgoCD', 'session tokens'));

  for (const env of DEPLOY_ENVS) {
    const host = argocdHost(env);
    const token = readArgocdToken(env);
    const fromEnvVar = Boolean(process.env[`VAST_ARGOCD_TOKEN_${env.toUpperCase()}`]?.trim());

    let state = 'no token — run `vast argocd login`';
    if (token) {
      // Only asked when a token exists, so `status` makes no network call for
      // an env you have never logged in to — production included.
      try {
        const who = await userinfo(host, token);
        state = who.loggedIn
          ? `valid${who.username ? ` — ${who.username}` : ''}`
          : 'expired — run `vast argocd login`';
      } catch (error) {
        state = `unknown — ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    console.log(
      createInfoBox(env, [
        formatKeyValue('Host', host),
        formatKeyValue('Token', token ? (fromEnvVar ? 'from VAST_ARGOCD_TOKEN env var' : argocdFile(env)) : 'none'),
        formatKeyValue('Session', state),
      ]),
    );
  }
}

function logout(options: { to: string }): void {
  const env = parseEnv(options.to);
  forgetArgocdToken(env);
  console.log(createSuccessBox(`Forgot the ${env} ArgoCD token`, `Removed ${argocdFile(env)}.`));
}

export function registerArgocdCommand(program: Command): void {
  const cmd = program
    .command('argocd')
    .description('Manage the ArgoCD session token used to confirm deploys')
    .addHelpText(
      'after',
      `
Examples:
  $ vast argocd                       show both environments (same as: status)
  $ vast argocd login                 log in to staging
  $ vast argocd login --username me   skip the username prompt
  $ vast argocd logout                forget the staging token

Why this exists:

  Staging deploys through GitOps. The build workflow only commits the image tag
  into Vast-deployments — ArgoCD is what actually rolls it out. So \`vast release\`
  and \`vast deploy\` wait on the ArgoCD API until the new tag reports
  Synced/Healthy. Without a token the deploy still runs, but the CLI cannot
  confirm the rollout and says so in the summary; log in with
  \`vast argocd login\` to get live confirmation.

  ArgoCD uses local accounts, so this is a real login: once per token lifetime,
  not once per release.

The password is never stored, never echoed and never logged — only the session
token it returns, written owner-only under ~/.vast-cli/argocd/<env>.json.
Set VAST_ARGOCD_TOKEN_STAGING (or _PRODUCTION) to supply a token instead; the
env var wins over the stored one. Override the server with a "host" field in
that same file.

Production is not deployed by this CLI yet, so you only need staging.
`,
    );

  cmd
    .command('status', { isDefault: true })
    .description('Show, per environment, the host and whether the token still works')
    .action(status);

  cmd
    .command('login')
    .description('Log in to ArgoCD and store the session token')
    .option('--to <env>', 'Environment to log in to (staging|production)', 'staging')
    .option('--username <user>', 'ArgoCD username (prompted when omitted)')
    .action(login);

  cmd
    .command('logout')
    .description('Forget the stored ArgoCD token')
    .option('--to <env>', 'Environment to forget (staging|production)', 'staging')
    .action(logout);
}
