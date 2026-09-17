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
 * 2026-09-17, not assumed. Staging is GitOps: `build-deploy` builds the image
 * and commits the tag into Vast-deployments, which ArgoCD watches. Production
 * paths are the same shape but are assumptions until DevOps migrates it.
 */
export const RELEASE_TEAMS = ['frontend', 'backend'];
export const DEPLOY_ENVS = ['staging', 'production'];
/** Every releasable repo builds and commits its tag through the same workflow. */
const BUILD_DEPLOY = { staging: 'build-deploy', production: 'build-deploy' };
const NO_DEPLOY = { staging: null, production: null };
/**
 * Staging folder names are ArgoCD app names hand-written in Vast-deployments,
 * not derived from the repo name — `vastpay-dasaboard` is misspelled upstream
 * and must stay that way here, or the app lookup misses.
 */
const deployments = (name, stagingFolder) => ({
    staging: `deployments/helm/staging/${stagingFolder}/stage.yaml`,
    production: `deployments/helm/production/${name}/prod.yaml`,
});
const FRONTEND_PROMOTION = { staging: 'develop', production: 'staging' };
/** Frontend repo: develop -> staging -> production. */
const fe = (name, stagingFolder, teams = ['frontend'], releaseTeam = 'frontend') => ({
    name,
    workflow: { ...BUILD_DEPLOY },
    deployments: deployments(name, stagingFolder),
    promoteFrom: { ...FRONTEND_PROMOTION },
    teams,
    releaseTeam,
});
export const REPOS = [
    fe('VastPayPwaV2', 'vastpay-pwa-v2'),
    fe('VastPay-DashBoard', 'vastpay-dasaboard'),
    fe('VastMenuPwa', 'pwa'),
    fe('VastMenuPwaV2', 'pwav2'),
    fe('VastPayPwa', 'vastpay-pwa'),
    fe('VastMenu-DashBoard', 'vastmenu-dashboard'),
    // Cloned with the frontend but deliberately out of the frontend release
    // train — it ships on its own cadence and is released by name only.
    fe('vast-menu-payments', 'vastmenu-payments', ['frontend'], null),
    // Vast-Finance has no deployments folder and no build-deploy workflow — only
    // review bots (Claude PR Review, Copilot, CodeQL). Verified via the GitHub
    // API. It is listed so `status` and `--all` acknowledge it, but every
    // release path skips it with a reason rather than pretending it can ship.
    {
        name: 'Vast-Finance',
        workflow: { ...NO_DEPLOY },
        deployments: { ...NO_DEPLOY },
        promoteFrom: { ...FRONTEND_PROMOTION },
        teams: ['frontend'],
        releaseTeam: null,
    },
    // Dead `develop` — no promotion source into staging. Human PRs in these two
    // target `staging` directly.
    {
        name: 'VastPay-BackEnd',
        workflow: { ...BUILD_DEPLOY },
        deployments: deployments('VastPay-BackEnd', 'vastpay-backend'),
        promoteFrom: { staging: null, production: 'staging' },
        teams: ['backend'],
        releaseTeam: 'backend',
    },
    {
        name: 'VastMenu-BackEnd',
        workflow: { ...BUILD_DEPLOY },
        deployments: deployments('VastMenu-BackEnd', 'vastmenu-backend'),
        promoteFrom: { staging: null, production: 'staging' },
        teams: ['backend'],
        releaseTeam: 'backend',
    },
    // Cloneable, not releasable: no deployments file and no deploy workflow, so
    // isReleasable() keeps them out of status, promote, and deploy.
    {
        name: 'vastpay-payment-odoo',
        workflow: { ...NO_DEPLOY },
        deployments: { ...NO_DEPLOY },
        promoteFrom: { staging: null, production: null },
        teams: ['backend'],
        releaseTeam: null,
    },
    {
        name: 'Terraform',
        workflow: { ...NO_DEPLOY },
        deployments: { ...NO_DEPLOY },
        promoteFrom: { staging: null, production: null },
        teams: ['infra'],
        releaseTeam: null,
    },
];
/** Case-insensitive lookup that returns the canonically-spelled config. */
export function getRepo(name) {
    const needle = name.toLowerCase();
    return REPOS.find((r) => r.name.toLowerCase() === needle);
}
/** Canonical names, for help text and --all iteration. */
export function repoNames() {
    return REPOS.map((r) => r.name);
}
/** Team profiles offered to `vast clone --team`. */
export const TEAMS = ['frontend', 'backend', 'infra', 'all'];
/** Repos belonging to a team profile. `all` is every repo tagged with any team. */
export function reposForTeam(team) {
    if (team === 'all')
        return REPOS.filter((r) => r.teams.length > 0);
    return REPOS.filter((r) => r.teams.includes(team));
}
/** Repos a `vast release --<team>` sweep acts on, in REPOS order. */
export function reposForRelease(team) {
    return REPOS.filter((r) => r.releaseTeam === team);
}
/** Path in Vast-deployments holding this repo's deployed tag for an env. */
export function deploymentsFile(repo, env) {
    return repo.deployments[env];
}
/**
 * The ArgoCD application name for an env: the folder the values file sits in.
 * Derived from the path so the two can never disagree.
 */
export function argoApp(repo, env) {
    const file = deploymentsFile(repo, env);
    if (!file)
        return null;
    const parts = file.split('/');
    return parts[parts.length - 2] ?? null;
}
/**
 * Whether the release commands can act on this repo.
 *
 * Derived rather than declared, so widening the list for `vast clone` never
 * makes a docs or infra repo show up in `status --all` or become promotable.
 */
export function isReleasable(repo) {
    return Boolean(repo.workflow.staging && repo.deployments.staging);
}
//# sourceMappingURL=repos.js.map