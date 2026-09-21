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
import type { DeployEnv } from './repos.js';
/**
 * Verified on 2026-09-17. `argocd-prod.vastmenu.com` exists but answers 403
 * from outside the cluster network; nothing in this CLI calls it while the
 * production pipeline is blocked.
 */
export declare const DEFAULT_ARGOCD_HOSTS: Record<DeployEnv, string>;
export declare function argocdFile(env: DeployEnv): string;
export declare function argocdHost(env: DeployEnv): string;
/**
 * The token for an env, or null.
 *
 * The env var wins so CI and one-off shells can supply a token without writing
 * anything to disk. A blank env var falls through rather than masking a stored
 * token — an unset-looking variable should behave as unset.
 */
export declare function readArgocdToken(env: DeployEnv): string | null;
export declare function saveArgocdToken(env: DeployEnv, token: string, username: string): void;
export declare function forgetArgocdToken(env: DeployEnv): void;
/**
 * Turn whatever the user pasted into the exact `Cookie` header value to send.
 *
 * People copy this three ways: the bare value from DevTools, one `name=value`
 * pair, or a whole `Cookie:` line lifted from a request. All three are accepted,
 * and only the `AWSELBAuthSessionCookie-*` pairs are kept — the ALB splits long
 * sessions into `-0`, `-1`, ... so several may be needed, while `_ga`,
 * `AWSALBAuthNonce` and `argocd.token` must never be stored or sent.
 */
export declare function normalizeAlbCookie(input: string): string | null;
/** The stored ALB cookie for an env, or null. The env var wins, like the token's. */
export declare function readAlbCookie(env: DeployEnv): string | null;
export declare function albCookieSavedAt(env: DeployEnv): string | null;
export declare function saveAlbCookie(env: DeployEnv, cookie: string): void;
export declare function argocdAppUrl(env: DeployEnv, app: string): string;
//# sourceMappingURL=argocd.d.ts.map