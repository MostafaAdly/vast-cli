/**
 * The Vast Group repos this CLI knows about — both the ones it can release
 * and the wider set a teammate should clone (`vast clone`). Whether a repo
 * is releasable is derived (see `isReleasable`), not declared, so widening
 * this list for cloning can never leak an infra or integration repo into
 * status, promote, or deploy.
 *
 * Names are the canonical GitHub spellings, matching
 * ~/.claude/vast-routines/scripts/repos.txt. Do not "fix" the casing —
 * tests/repos.test.ts guards against drift in either direction. The config
 * now deliberately exceeds that manifest.
 *
 * Workflow names and Helm paths below were read from GitHub on 2026-08-04,
 * not assumed.
 */
export interface RepoConfig {
    /** Canonical GitHub repo name. */
    name: string;
    /**
     * GitHub Actions workflow that builds the image and opens the bump PR.
     * null means the repo has no deploy workflow and cannot be released.
     */
    workflow: string | null;
    /** Helm values file holding the deployed image tag, per env. null if absent. */
    helm: {
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
/**
 * Whether the release commands can act on this repo.
 *
 * Derived rather than declared, so widening the list for `vast clone` never
 * makes a docs or infra repo show up in `status --all` or become promotable.
 */
export declare function isReleasable(repo: RepoConfig): boolean;
//# sourceMappingURL=repos.d.ts.map