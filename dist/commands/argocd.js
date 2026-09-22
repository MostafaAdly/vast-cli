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
import inquirer from 'inquirer';
import { DEPLOY_ENVS } from '../config/repos.js';
import { albCookieSavedAt, argocdFile, argocdHost, forgetArgocdToken, isArgocdEnabled, setArgocdEnabled, normalizeAlbCookie, readAlbCookie, readArgocdToken, saveAlbCookie, saveArgocdToken, } from '../config/argocd.js';
import { ArgoSsoWallError, login as argoLogin, userinfo } from '../utils/argocd.js';
import { createErrorBox, createHeader, createInfoBox, createSuccessBox, formatKeyValue, log, } from '../utils/ui.js';
function parseEnv(value) {
    const env = value.trim().toLowerCase();
    if (!DEPLOY_ENVS.includes(env)) {
        log.error(`Unknown environment "${value}". Expected one of: ${DEPLOY_ENVS.join(', ')}`);
        process.exit(1);
    }
    return env;
}
async function login(options) {
    const env = parseEnv(options.to);
    const host = argocdHost(env);
    console.log(createHeader('ArgoCD login', host));
    const answers = await inquirer.prompt([
        {
            type: 'input',
            name: 'username',
            message: 'ArgoCD username:',
            when: !options.username,
            validate: (value) => (value.trim() ? true : 'Username is required'),
        },
        {
            type: 'password',
            name: 'password',
            mask: '*',
            message: 'ArgoCD password:',
            validate: (value) => (value ? true : 'Password is required'),
        },
    ]);
    const username = (options.username ?? answers.username).trim();
    // The password is only ever held in this closure and sent as a request body.
    const attempt = () => argoLogin(host, username, answers.password, undefined, readAlbCookie(env));
    let token;
    try {
        token = await attempt();
    }
    catch (error) {
        if (!(error instanceof ArgoSsoWallError)) {
            // The message comes from ArgoCD ("Invalid username or password"); the
            // credentials themselves are never part of it.
            log.error(error instanceof Error ? error.message : String(error));
            process.exitCode = 1;
            return;
        }
        // A load balancer in front of ArgoCD answers with a redirect to a browser
        // sign-in instead of JSON. The way past it is the session cookie that a
        // signed-in browser holds; the user pastes it here, hidden, exactly like
        // the password — and it is the only thing we keep out of what they paste.
        const bridged = await askForAlbCookie(env, host, readAlbCookie(env) !== null);
        if (!bridged)
            return;
        try {
            token = await attempt();
        }
        catch (error) {
            if (error instanceof ArgoSsoWallError) {
                console.log(createErrorBox('The load balancer did not accept that cookie', 'It may be from a different host, or already expired. Sign in to ArgoCD\n' +
                    'in your browser again and copy a fresh AWSELBAuthSessionCookie-0 value.'));
            }
            else {
                log.error(error instanceof Error ? error.message : String(error));
            }
            process.exitCode = 1;
            return;
        }
    }
    saveArgocdToken(env, token, username);
    console.log(createSuccessBox(`Logged in to ${host} as ${username}`, `Token stored for ${env} in ${argocdFile(env)} (owner-only).\n` +
        'It is used to confirm rollouts during release and deploy. Check it any\n' +
        'time with `vast argocd status`; drop it with `vast argocd logout`.'));
}
/**
 * Explain the wall and take the cookie that gets past it.
 *
 * @returns false when nothing usable was pasted; the caller stops there.
 */
async function askForAlbCookie(env, host, hadOne) {
    log.warn(hadOne
        ? `${host} is behind a browser sign-in and the stored session cookie no longer gets past it (they last about a week).`
        : `${host} is behind a browser sign-in at the load balancer, so the CLI needs the browser's session cookie to reach ArgoCD.`);
    log.muted('  1. Open the ArgoCD host in your browser and sign in (Google).');
    log.muted('  2. DevTools → Application → Cookies → that host.');
    log.muted('  3. Copy the value of AWSELBAuthSessionCookie-0 (a whole Cookie line works too).');
    log.muted('  The paste is hidden. Only the AWSELBAuthSessionCookie pairs are kept, stored owner-only.');
    const { pasted } = await inquirer.prompt([
        {
            type: 'password',
            name: 'pasted',
            mask: '*',
            message: 'Load-balancer session cookie:',
            validate: (value) => (value.trim() ? true : 'Paste the cookie, or Ctrl-C to stop'),
        },
    ]);
    const cookie = normalizeAlbCookie(pasted);
    if (!cookie) {
        log.error('No AWSELBAuthSessionCookie value found in what was pasted. Nothing stored.');
        process.exitCode = 1;
        return false;
    }
    saveAlbCookie(env, cookie);
    log.success(`Session cookie stored for ${env}. Retrying the ArgoCD login...`);
    return true;
}
async function status() {
    console.log(createHeader('ArgoCD', 'session tokens'));
    for (const env of DEPLOY_ENVS) {
        const host = argocdHost(env);
        const token = readArgocdToken(env);
        const fromEnvVar = Boolean(process.env[`VAST_ARGOCD_TOKEN_${env.toUpperCase()}`]?.trim());
        const enabled = isArgocdEnabled(env);
        let state = 'no token — run `vast argocd login`';
        if (!enabled) {
            state = 'not checked — confirmation is disabled';
        }
        else if (token) {
            // Only asked when a token exists, so `status` makes no network call for
            // an env you have never logged in to — production included.
            try {
                const who = await userinfo(host, token, undefined, readAlbCookie(env));
                state = who.loggedIn
                    ? `valid${who.username ? ` — ${who.username}` : ''}`
                    : 'expired — run `vast argocd login`';
            }
            catch (error) {
                // The token may be perfectly good — it simply cannot be presented to
                // anything, because the API is not what answers.
                state =
                    error instanceof ArgoSsoWallError
                        ? `unreachable — ${error.message}`
                        : `unknown — ${error instanceof Error ? error.message : String(error)}`;
            }
        }
        const cookieFromEnv = Boolean(process.env[`VAST_ARGOCD_ALB_COOKIE_${env.toUpperCase()}`]?.trim());
        const cookie = readAlbCookie(env)
            ? cookieFromEnv
                ? 'from VAST_ARGOCD_ALB_COOKIE env var'
                : `present (saved ${albCookieSavedAt(env) ?? 'unknown'})`
            : 'none';
        console.log(createInfoBox(env, [
            formatKeyValue('Host', host),
            formatKeyValue('Confirmation', enabled ? 'enabled' : 'disabled — `vast argocd enable` to turn on'),
            formatKeyValue('Token', token ? (fromEnvVar ? 'from VAST_ARGOCD_TOKEN env var' : argocdFile(env)) : 'none'),
            formatKeyValue('Cookie', cookie),
            formatKeyValue('Session', state),
        ]));
    }
}
function setEnabled(enabled, options) {
    const env = parseEnv(options.to);
    setArgocdEnabled(env, enabled);
    console.log(enabled
        ? createSuccessBox(`ArgoCD confirmation enabled for ${env}`, 'Deploys will refresh the app and wait until it is Synced/Healthy again.\n' +
            'Check the connection with `vast argocd status`.')
        : createSuccessBox(`ArgoCD confirmation disabled for ${env}`, 'Deploys still build and commit the tag, but make no ArgoCD call at all\n' +
            'and report "rollout not confirmed (ArgoCD disabled)". Turn it back on\n' +
            'with `vast argocd enable`.'));
}
function logout(options) {
    const env = parseEnv(options.to);
    forgetArgocdToken(env);
    console.log(createSuccessBox(`Forgot the ${env} ArgoCD token and session cookie`, `Removed ${argocdFile(env)}.`));
}
export function registerArgocdCommand(program) {
    const cmd = program
        .command('argocd')
        .description('Manage the ArgoCD session token used to confirm deploys')
        .addHelpText('after', `
Examples:
  $ vast argocd                       show both environments (same as: status)
  $ vast argocd login                 log in to staging
  $ vast argocd login --username me   skip the username prompt
  $ vast argocd logout                forget the staging token
  $ vast argocd disable               stop talking to ArgoCD during deploys
  $ vast argocd enable                start confirming rollouts again

Why this exists:

  Staging deploys through GitOps. The build workflow only commits the image tag
  into Vast-deployments — ArgoCD is what actually rolls it out. So \`vast release\`
  and \`vast deploy\` wait on the ArgoCD API until the new tag reports
  Synced/Healthy. Without a token the deploy still runs, but the CLI cannot
  confirm the rollout and says so in the summary; log in with
  \`vast argocd login\` to get live confirmation.

  ArgoCD uses local accounts, so this is a real login: once per token lifetime,
  not once per release.

  The staging host sits behind a load-balancer browser sign-in (Google) that
  covers every path, /api/* included. A browser that has signed in holds the
  cookie that gets past it, so login asks you to paste it once: sign in to
  ArgoCD in your browser, open DevTools → Application → Cookies → that host,
  copy AWSELBAuthSessionCookie-0, and paste it when asked (hidden; a whole
  Cookie line works, only the AWSELBAuthSessionCookie pairs are kept). It lasts
  about a week; when it expires deploys report "rollout not confirmed (ArgoCD
  session cookie expired)" and login asks again. Deploys never stop for any of
  this — the build runs and the tag is committed regardless. The permanent fix
  is for DevOps to exempt /api/* from that rule.

The password is never stored, never echoed and never logged — only the session
token it returns, written owner-only under ~/.vast-cli/argocd/<env>.json.
Set VAST_ARGOCD_TOKEN_STAGING (or _PRODUCTION) to supply a token instead, and
VAST_ARGOCD_ALB_COOKIE_STAGING for the cookie; the env vars win over the file. Override the server with a "host" field in
that same file.

When ArgoCD cannot be reached from your machine at all, \`vast argocd disable\`
turns every ArgoCD call off: releases and deploys still build and commit the tag,
report "rollout not confirmed (ArgoCD disabled)", and never fail on ArgoCD. The
switch is per environment and survives \`vast argocd logout\`.

Production is not deployed by this CLI yet, so you only need staging.
`);
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
        .command('enable')
        .description('Confirm rollouts through ArgoCD during release and deploy (the default)')
        .option('--to <env>', 'Environment (staging|production)', 'staging')
        .action((options) => setEnabled(true, options));
    cmd
        .command('disable')
        .description('Skip every ArgoCD call during release and deploy; rollouts go unconfirmed')
        .option('--to <env>', 'Environment (staging|production)', 'staging')
        .action((options) => setEnabled(false, options));
    cmd
        .command('logout')
        .description('Forget the stored ArgoCD token and session cookie')
        .option('--to <env>', 'Environment to forget (staging|production)', 'staging')
        .action(logout);
}
//# sourceMappingURL=argocd.js.map