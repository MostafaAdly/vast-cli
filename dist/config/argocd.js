/**
 * ArgoCD hosts and session tokens, one pair per deploy environment.
 *
 * Staging moved to GitOps: a deploy is only really finished when ArgoCD has
 * rolled the new tag out, so `vast release` and `vast deploy` have to read the
 * ArgoCD API. ArgoCD here uses local accounts (no dex/oidc), so the only way in
 * is a session token minted from a username and password.
 *
 * The password is never stored, never echoed, and never reaches this module —
 * only the token it buys does. The token file is written 0600 because it is a
 * credential, not a preference, and it lives under `vastHome()` so the test
 * suite can sandbox it with `VAST_CLI_HOME` and never touch a developer's real
 * session.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { vastHome } from './workspace.js';
/**
 * Verified on 2026-09-17. `argocd-prod.vastmenu.com` exists but answers 403
 * from outside the cluster network; nothing in this CLI calls it while the
 * production pipeline is blocked.
 */
export const DEFAULT_ARGOCD_HOSTS = {
    staging: 'https://argocd-stg.vastmenu.com',
    production: 'https://argocd-prod.vastmenu.com',
};
export function argocdFile(env) {
    return join(vastHome(), 'argocd', `${env}.json`);
}
function read(env) {
    const file = argocdFile(env);
    if (!existsSync(file))
        return {};
    try {
        return JSON.parse(readFileSync(file, 'utf-8'));
    }
    catch {
        // A truncated or hand-mangled file must not break every command; treat it
        // as "no token stored" and let the user log in again.
        return {};
    }
}
export function argocdHost(env) {
    const host = read(env).host?.trim();
    return host || DEFAULT_ARGOCD_HOSTS[env];
}
/**
 * The token for an env, or null.
 *
 * The env var wins so CI and one-off shells can supply a token without writing
 * anything to disk. A blank env var falls through rather than masking a stored
 * token — an unset-looking variable should behave as unset.
 */
export function readArgocdToken(env) {
    const fromEnv = process.env[`VAST_ARGOCD_TOKEN_${env.toUpperCase()}`]?.trim();
    if (fromEnv)
        return fromEnv;
    const stored = read(env).token?.trim();
    return stored || null;
}
export function saveArgocdToken(env, token, username) {
    const file = argocdFile(env);
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    // Keep any host override the user hand-wrote; logging in must not silently
    // point them back at the default server. Nothing else carries over: files
    // from 2.1–2.7 also hold the load balancer's session cookie, a credential
    // that has been useless since the Google sign-in was removed (2026-10-01),
    // and a fresh login is what clears it off disk.
    const { host } = read(env);
    const next = { ...(host ? { host } : {}), token, username, savedAt: new Date().toISOString() };
    writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
    // `mode` on writeFileSync only applies when the file is created, so an
    // existing file keeps whatever permissions it had. Force them.
    chmodSync(file, 0o600);
}
export function forgetArgocdToken(env) {
    rmSync(argocdFile(env), { force: true });
}
/**
 * Whether deploys should talk to ArgoCD at all. On by default.
 *
 * The switch is its own marker file rather than a field in the token file, so
 * `vast argocd logout` (which deletes that file) can never quietly turn
 * confirmation back on while the host is still unreachable.
 */
function disabledMarker(env) {
    return join(vastHome(), 'argocd', `${env}.disabled`);
}
export function isArgocdEnabled(env) {
    return !existsSync(disabledMarker(env));
}
export function setArgocdEnabled(env, enabled) {
    const marker = disabledMarker(env);
    if (enabled) {
        rmSync(marker, { force: true });
        return;
    }
    mkdirSync(dirname(marker), { recursive: true, mode: 0o700 });
    writeFileSync(marker, `${new Date().toISOString()}\n`, 'utf-8');
}
export function argocdAppUrl(env, app) {
    return `${argocdHost(env)}/applications/${app}`;
}
//# sourceMappingURL=argocd.js.map