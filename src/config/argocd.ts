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
import type { DeployEnv } from './repos.js';

/**
 * Verified on 2026-09-17. `argocd-prod.vastmenu.com` exists but answers 403
 * from outside the cluster network; nothing in this CLI calls it while the
 * production pipeline is blocked.
 */
export const DEFAULT_ARGOCD_HOSTS: Record<DeployEnv, string> = {
  staging: 'https://argocd-stg.vastmenu.com',
  production: 'https://argocd-prod.vastmenu.com',
};

interface StoredArgocd {
  /** Overrides the built-in host for this env. Hand-written; we never set it. */
  host?: string;
  token?: string;
  username?: string;
  savedAt?: string;
  /**
   * The load balancer's own session cookie (`AWSELBAuthSessionCookie-*`), pasted
   * by the user out of a browser that has signed in. It gets requests past the
   * ALB's Google sign-in so ArgoCD's real login and API can be reached at all.
   */
  albCookie?: string;
  albCookieSavedAt?: string;
}

export function argocdFile(env: DeployEnv): string {
  return join(vastHome(), 'argocd', `${env}.json`);
}

function read(env: DeployEnv): StoredArgocd {
  const file = argocdFile(env);
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as StoredArgocd;
  } catch {
    // A truncated or hand-mangled file must not break every command; treat it
    // as "no token stored" and let the user log in again.
    return {};
  }
}

export function argocdHost(env: DeployEnv): string {
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
export function readArgocdToken(env: DeployEnv): string | null {
  const fromEnv = process.env[`VAST_ARGOCD_TOKEN_${env.toUpperCase()}`]?.trim();
  if (fromEnv) return fromEnv;
  const stored = read(env).token?.trim();
  return stored || null;
}

export function saveArgocdToken(env: DeployEnv, token: string, username: string): void {
  const file = argocdFile(env);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  // Keep any host override the user hand-wrote; logging in must not silently
  // point them back at the default server.
  const next: StoredArgocd = { ...read(env), token, username, savedAt: new Date().toISOString() };
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
  // `mode` on writeFileSync only applies when the file is created, so an
  // existing file keeps whatever permissions it had. Force them.
  chmodSync(file, 0o600);
}

export function forgetArgocdToken(env: DeployEnv): void {
  rmSync(argocdFile(env), { force: true });
}

/** Only the cookies the load balancer itself sets. Everything else a browser holds is noise. */
const ALB_COOKIE_PREFIX = 'AWSELBAuthSessionCookie';

/**
 * Turn whatever the user pasted into the exact `Cookie` header value to send.
 *
 * People copy this three ways: the bare value from DevTools, one `name=value`
 * pair, or a whole `Cookie:` line lifted from a request. All three are accepted,
 * and only the `AWSELBAuthSessionCookie-*` pairs are kept — the ALB splits long
 * sessions into `-0`, `-1`, ... so several may be needed, while `_ga`,
 * `AWSALBAuthNonce` and `argocd.token` must never be stored or sent.
 */
export function normalizeAlbCookie(input: string): string | null {
  const text = input.trim().replace(/^cookie:\s*/i, '');
  if (!text) return null;
  if (!text.includes('=')) return `${ALB_COOKIE_PREFIX}-0=${text}`;
  const pairs = text
    .split(';')
    .map((pair) => pair.trim())
    .filter((pair) => pair.startsWith(ALB_COOKIE_PREFIX) && pair.includes('='));
  return pairs.length > 0 ? pairs.join('; ') : null;
}

/** The stored ALB cookie for an env, or null. The env var wins, like the token's. */
export function readAlbCookie(env: DeployEnv): string | null {
  const fromEnv = process.env[`VAST_ARGOCD_ALB_COOKIE_${env.toUpperCase()}`]?.trim();
  if (fromEnv) return fromEnv;
  const stored = read(env).albCookie?.trim();
  return stored || null;
}

export function albCookieSavedAt(env: DeployEnv): string | null {
  return read(env).albCookieSavedAt ?? null;
}

export function saveAlbCookie(env: DeployEnv, cookie: string): void {
  const file = argocdFile(env);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const next: StoredArgocd = { ...read(env), albCookie: cookie, albCookieSavedAt: new Date().toISOString() };
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
  chmodSync(file, 0o600);
}

export function argocdAppUrl(env: DeployEnv, app: string): string {
  return `${argocdHost(env)}/applications/${app}`;
}
