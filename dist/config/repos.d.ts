/**
 * The Vast Group repos this CLI knows about — both the ones it can release
 * and the wider set a teammate should clone (`vast clone`). Whether a repo
 * is releasable is derived (see `isReleasable`), not declared, so widening
 * this list for cloning can never leak an infra or integration repo into
 * status, promote, or deploy.
 *
 * Two different groupings live here and must not be conflated: `teams` drives
 * `vast clone --team`, while `releaseTeam` drives the `vast release --frontend`
 * / `--backend` sweeps. A repo can be cloned with a team without riding its
 * release train.
 *
 * Names are the canonical GitHub spellings, matching
 * ~/.claude/vast-routines/scripts/repos.txt. Do not "fix" the casing —
 * tests/repos.test.ts guards against drift in either direction. The config
 * now deliberately exceeds that manifest.
 *
 * Workflow names and Vast-deployments paths below were read from GitHub on
 * 2026-09-17, not assumed. Staging is GitOps: `build-deploy.yml` builds the image
 * and commits the tag into Vast-deployments, which ArgoCD watches. Production
 * paths are the same shape but are assumptions until DevOps migrates it.
 */
export type ReleaseTeam = 'frontend' | 'backend';
export declare const RELEASE_TEAMS: ReleaseTeam[];
/** The environments a repo can be deployed to, in promotion order. */
export type DeployEnv = 'staging' | 'production';
export declare const DEPLOY_ENVS: DeployEnv[];
export interface RepoConfig {
    /** Canonical GitHub repo name. */
    name: string;
    /**
     * The name a human reads — used in the Slack release announcement, where the
     * audience is the whole team rather than anyone who works in the repo.
     * Declared, not derived: "VastPay-DashBoard" de-camel-cased is not what
     * anybody calls it, and the release message is the one place the GitHub
     * spelling would look wrong.
     */
    displayName: string;
    /**
     * GitHub Actions workflow that builds the image and commits the tag into
     * Vast-deployments, per env. null means the repo cannot be deployed there.
     */
    workflow: {
        staging: string | null;
        production: string | null;
    };
    /**
     * Values file in Vast-deployments holding the deployed image tag, per env.
     * null means the repo is not deployed to that env.
     */
    deployments: {
        staging: string | null;
        production: string | null;
    };
    /**
     * Branch a promotion into each env merges FROM.
     * null means promotion into that env is unsupported for this repo — both
     * *-BackEnd repos have a dead `develop` (weeks stale, hundreds of commits
     * behind staging), so merging it into staging would be destructive.
     */
    promoteFrom: {
        staging: string | null;
        production: string | null;
    };
    /**
     * Team profiles this repo belongs to, driving `vast clone --team`.
     * Empty means it exists in the list but no profile clones it.
     */
    teams: string[];
    /**
     * Which `vast release` sweep this repo rides in — `--frontend`, `--backend`,
     * or none (released only by name). Distinct from `teams`, which drives
     * `vast clone`: vast-menu-payments is cloned with the frontend but is not
     * part of the frontend release train.
     */
    releaseTeam: ReleaseTeam | null;
}
export declare const REPOS: RepoConfig[];
/** Case-insensitive lookup that returns the canonically-spelled config. */
export declare function getRepo(name: string): RepoConfig | undefined;
/** Canonical names, for help text and --all iteration. */
export declare function repoNames(): string[];
/** Team profiles offered to `vast clone --team`. */
export declare const TEAMS: string[];
/** Repos belonging to a team profile. `all` is every repo tagged with any team. */
export declare function reposForTeam(team: string): RepoConfig[];
/** Repos a `vast release --<team>` sweep acts on, in REPOS order. */
export declare function reposForRelease(team: ReleaseTeam): RepoConfig[];
/** Path in Vast-deployments holding this repo's deployed tag for an env. */
export declare function deploymentsFile(repo: RepoConfig, env: DeployEnv): string | null;
/**
 * The ArgoCD application name for an env: the folder the values file sits in.
 * Derived from the path so the two can never disagree.
 */
export declare function argoApp(repo: RepoConfig, env: DeployEnv): string | null;
/**
 * Whether the release commands can act on this repo.
 *
 * Derived rather than declared, so widening the list for `vast clone` never
 * makes a docs or infra repo show up in `status --all` or become promotable.
 */
export declare function isReleasable(repo: RepoConfig): boolean;
//# sourceMappingURL=repos.d.ts.map