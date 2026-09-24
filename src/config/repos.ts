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
export const RELEASE_TEAMS: ReleaseTeam[] = ['frontend', 'backend'];

/** The environments a repo can be deployed to, in promotion order. */
export type DeployEnv = 'staging' | 'production';
export const DEPLOY_ENVS: DeployEnv[] = ['staging', 'production'];

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
  workflow: { staging: string | null; production: string | null };
  /**
   * Values file in Vast-deployments holding the deployed image tag, per env.
   * null means the repo is not deployed to that env.
   */
  deployments: { staging: string | null; production: string | null };
  /**
   * Branch a promotion into each env merges FROM.
   * null means promotion into that env is unsupported for this repo — both
   * *-BackEnd repos have a dead `develop` (weeks stale, hundreds of commits
   * behind staging), so merging it into staging would be destructive.
   */
  promoteFrom: { staging: string | null; production: string | null };
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

/**
 * Every releasable repo builds and commits its tag through the same workflow,
 * dispatched by its FILE. DevOps renamed each one to "<Repo> Pipeline" on
 * 2026-09-24 (e.g. "VastPayPwaV2 Pipeline") and the old name "build-deploy"
 * stopped resolving; the file build-deploy.yml did not move, and gh accepts a
 * file wherever it accepts a name, so the next rename cannot break deploys.
 */
const BUILD_DEPLOY = { staging: 'build-deploy.yml', production: 'build-deploy.yml' } as const;

const NO_DEPLOY = { staging: null, production: null } as const;

/**
 * Staging folder names are ArgoCD app names hand-written in Vast-deployments,
 * not derived from the repo name — `vastpay-dasaboard` is misspelled upstream
 * and must stay that way here, or the app lookup misses.
 */
const deployments = (name: string, stagingFolder: string) => ({
  staging: `deployments/helm/staging/${stagingFolder}/stage.yaml`,
  production: `deployments/helm/production/${name}/prod.yaml`,
});

const FRONTEND_PROMOTION = { staging: 'develop', production: 'staging' } as const;

/** Frontend repo: develop -> staging -> production. */
const fe = (
  name: string,
  displayName: string,
  stagingFolder: string,
  teams: string[] = ['frontend'],
  releaseTeam: ReleaseTeam | null = 'frontend',
): RepoConfig => ({
  name,
  displayName,
  workflow: { ...BUILD_DEPLOY },
  deployments: deployments(name, stagingFolder),
  promoteFrom: { ...FRONTEND_PROMOTION },
  teams,
  releaseTeam,
});

export const REPOS: RepoConfig[] = [
  fe('VastPayPwaV2', 'Vastpay Pwa V2', 'vastpay-pwa-v2'),
  fe('VastPay-DashBoard', 'Vastpay Dashboard', 'vastpay-dasaboard'),
  fe('VastMenuPwa', 'Vastmenu Pwa', 'pwa'),
  fe('VastMenuPwaV2', 'Vastmenu Pwa V2', 'pwav2'),
  fe('VastPayPwa', 'Vastpay Pwa', 'vastpay-pwa'),
  fe('VastMenu-DashBoard', 'Vastmenu Dashboard', 'vastmenu-dashboard'),
  // Cloned with the frontend but deliberately out of the frontend release
  // train — it ships on its own cadence and is released by name only.
  fe('vast-menu-payments', 'Vastmenu Payments', 'vastmenu-payments', ['frontend'], null),

  // Vast-Finance has no deployments folder and no build-deploy workflow — only
  // review bots (Claude PR Review, Copilot, CodeQL). Verified via the GitHub
  // API. It is listed so `status` and `--all` acknowledge it, but every
  // release path skips it with a reason rather than pretending it can ship.
  {
    name: 'Vast-Finance',
    displayName: 'Vast Finance',
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
    displayName: 'Vastpay Backend',
    workflow: { ...BUILD_DEPLOY },
    deployments: deployments('VastPay-BackEnd', 'vastpay-backend'),
    promoteFrom: { staging: null, production: 'staging' },
    teams: ['backend'],
    releaseTeam: 'backend',
  },
  {
    name: 'VastMenu-BackEnd',
    displayName: 'Vastmenu Backend',
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
    displayName: 'Vastpay Payment Odoo',
    workflow: { ...NO_DEPLOY },
    deployments: { ...NO_DEPLOY },
    promoteFrom: { staging: null, production: null },
    teams: ['backend'],
    releaseTeam: null,
  },
  {
    name: 'Terraform',
    displayName: 'Terraform',
    workflow: { ...NO_DEPLOY },
    deployments: { ...NO_DEPLOY },
    promoteFrom: { staging: null, production: null },
    teams: ['infra'],
    releaseTeam: null,
  },
];

/** Case-insensitive lookup that returns the canonically-spelled config. */
export function getRepo(name: string): RepoConfig | undefined {
  const needle = name.toLowerCase();
  return REPOS.find((r) => r.name.toLowerCase() === needle);
}

/** Canonical names, for help text and --all iteration. */
export function repoNames(): string[] {
  return REPOS.map((r) => r.name);
}

/** Team profiles offered to `vast clone --team`. */
export const TEAMS = ['frontend', 'backend', 'infra', 'all'];

/** Repos belonging to a team profile. `all` is every repo tagged with any team. */
export function reposForTeam(team: string): RepoConfig[] {
  if (team === 'all') return REPOS.filter((r) => r.teams.length > 0);
  return REPOS.filter((r) => r.teams.includes(team));
}

/** Repos a `vast release --<team>` sweep acts on, in REPOS order. */
export function reposForRelease(team: ReleaseTeam): RepoConfig[] {
  return REPOS.filter((r) => r.releaseTeam === team);
}

/** Path in Vast-deployments holding this repo's deployed tag for an env. */
export function deploymentsFile(repo: RepoConfig, env: DeployEnv): string | null {
  return repo.deployments[env];
}

/**
 * The ArgoCD application name for an env: the folder the values file sits in.
 * Derived from the path so the two can never disagree.
 */
export function argoApp(repo: RepoConfig, env: DeployEnv): string | null {
  const file = deploymentsFile(repo, env);
  if (!file) return null;
  const parts = file.split('/');
  return parts[parts.length - 2] ?? null;
}

/**
 * Whether the release commands can act on this repo.
 *
 * Derived rather than declared, so widening the list for `vast clone` never
 * makes a docs or infra repo show up in `status --all` or become promotable.
 */
export function isReleasable(repo: RepoConfig): boolean {
  return Boolean(repo.workflow.staging && repo.deployments.staging);
}
