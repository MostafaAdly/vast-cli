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
export declare function argocdAppUrl(env: DeployEnv, app: string): string;
//# sourceMappingURL=argocd.d.ts.map