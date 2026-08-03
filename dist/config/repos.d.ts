/**
 * The Vast Group repos this CLI can release.
 *
 * Names are the canonical GitHub spellings, matching
 * ~/.claude/vast-routines/scripts/repos.txt. Do not "fix" the casing —
 * tests/repos.test.ts guards against drift in either direction.
 *
 * Workflow names and Helm paths below were read from GitHub on 2026-08-04,
 * not assumed.
 */
export interface RepoConfig {
    /** Canonical GitHub repo name. */
    name: string;
    /**
     * Directory name under ~/Workshop/Work/vastgroup.
     * NOT derivable from `name` — VastMenuPwa lives at `vastmenu-pwa`,
     * vast-menu-payments at `vastmenu-payments`, VastPay-BackEnd at `vastpay-api`.
     */
    localDir: string;
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
}
export declare const REPOS: RepoConfig[];
/** Case-insensitive lookup that returns the canonically-spelled config. */
export declare function getRepo(name: string): RepoConfig | undefined;
/** Canonical names, for help text and --all iteration. */
export declare function repoNames(): string[];
//# sourceMappingURL=repos.d.ts.map