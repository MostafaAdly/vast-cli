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
const HELM = {
    staging: 'Helm/values-stage.yaml',
    production: 'Helm/values-prod.yaml',
};
const FRONTEND_PROMOTION = { staging: 'develop', production: 'staging' };
/** Frontend repo: develop -> staging -> production, standard Helm layout. */
const fe = (name, localDir, workflow) => ({
    name,
    localDir,
    workflow,
    helm: { ...HELM },
    promoteFrom: { ...FRONTEND_PROMOTION },
});
export const REPOS = [
    fe('VastPayPwaV2', 'vastpay-pwa-v2', 'vastpaypwa-v2-ci-new'),
    fe('VastPay-DashBoard', 'vastpay-dashboard', 'vastpay-dashboard-ci-new'),
    fe('VastMenuPwa', 'vastmenu-pwa', 'pwa-ci-new'),
    fe('VastMenuPwaV2', 'vastmenu-pwa-v2', 'pwa-v2-ci-new'),
    fe('VastPayPwa', 'vastpay-pwa', 'vastpay-pwa-ci-new'),
    fe('VastMenu-DashBoard', 'vastmenu-dashboard', 'dashboard-ci-new'),
    fe('vast-menu-payments', 'vastmenu-payments', 'payments-ci-new'),
    // Vast-Finance has no Helm directory and no CI workflow — only review bots
    // (Claude PR Review, Copilot, CodeQL). Verified via the GitHub API on
    // 2026-08-04. It is listed so `status` and `--all` acknowledge it, but every
    // release path skips it with a reason rather than pretending it can ship.
    {
        name: 'Vast-Finance',
        localDir: 'vast-finance',
        workflow: null,
        helm: { staging: null, production: null },
        promoteFrom: { ...FRONTEND_PROMOTION },
    },
    // Dead `develop` — no promotion source into staging. Human PRs in these two
    // target `staging` directly.
    // NOTE: vastmenu-api-test and vastmenu-api-rails are also clones of the
    // VastMenu backend; `vastmenu-api` is the working one.
    {
        name: 'VastPay-BackEnd',
        localDir: 'vastpay-api',
        workflow: 'vastpay-backend-ci-new',
        helm: { ...HELM },
        promoteFrom: { staging: null, production: 'staging' },
    },
    {
        name: 'VastMenu-BackEnd',
        localDir: 'vastmenu-api',
        workflow: 'vastmenu-backend-ci-new',
        helm: { ...HELM },
        promoteFrom: { staging: null, production: 'staging' },
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
//# sourceMappingURL=repos.js.map