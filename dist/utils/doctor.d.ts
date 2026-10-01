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
    session: () => Promise<{
        loggedIn: boolean;
        username?: string;
    }>;
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
    productionTag: (repo: RepoConfig, dir: string | null) => Promise<string>;
    argocd: (env: 'staging') => ArgoState;
    slack: {
        token: string | null;
        channel: string | null;
        authTest: () => Promise<void>;
        /** How to name the target: `#releases`, or `a direct message`. Null when it is gone. */
        channelName: () => Promise<string | null>;
    };
}
/**
 * Whether the workflow can be dispatched with the one `version` input the CLI
 * sends. A text check rather than a YAML parse: no new dependency, and the
 * shape it looks for — `workflow_dispatch:` then `inputs:` then a `version:`
 * key — is the contract itself.
 */
export declare function workflowAcceptsVersion(yaml: string): boolean;
export declare function tally(checks: Check[]): {
    fail: number;
    warn: number;
};
export declare function runDoctor(deps: DoctorDeps): Promise<Check[]>;
//# sourceMappingURL=doctor.d.ts.map