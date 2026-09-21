import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  REPOS,
  DEPLOY_ENVS,
  getRepo,
  isReleasable,
  deploymentsFile,
  argoApp,
  reposForTeam,
  TEAMS,
  RELEASE_TEAMS,
  reposForRelease,
} from '../src/config/repos.js';

test('covers every configured repo', () => {
  assert.equal(REPOS.length, 12);
});

test('lookup is case-insensitive but preserves canonical spelling', () => {
  assert.equal(getRepo('vastpay-dashboard')?.name, 'VastPay-DashBoard');
  assert.equal(getRepo('VASTPAYPWAV2')?.name, 'VastPayPwaV2');
});

test('unknown repo returns undefined', () => {
  assert.equal(getRepo('NotARepo'), undefined);
});

test('backend repos have no staging promotion source', () => {
  assert.equal(getRepo('VastPay-BackEnd')?.promoteFrom.staging, null);
  assert.equal(getRepo('VastMenu-BackEnd')?.promoteFrom.staging, null);
});

test('frontend repos promote into staging from develop', () => {
  assert.equal(getRepo('VastPayPwaV2')?.promoteFrom.staging, 'develop');
  assert.equal(getRepo('VastMenuPwa')?.promoteFrom.staging, 'develop');
});

// Vast-Finance has no deployments folder and no build-deploy workflow —
// verified against the GitHub API. It must be unreleasable rather than
// silently attempted.
test('Vast-Finance is configured as unreleasable', () => {
  const finance = getRepo('Vast-Finance')!;
  assert.equal(finance.workflow.staging, null);
  assert.equal(finance.workflow.production, null);
  assert.equal(finance.deployments.staging, null);
  assert.equal(finance.deployments.production, null);
});

// The remaining exceptions are the repos added for `vast clone` that were
// never meant to be releasable: no deployments file, no deploy workflow.
const KNOWN_UNRELEASABLE = ['Vast-Finance', 'vastpay-payment-odoo', 'Terraform'];

test('every other repo has a build-deploy workflow and a staging deployments file', () => {
  for (const repo of REPOS.filter((r) => !KNOWN_UNRELEASABLE.includes(r.name))) {
    assert.equal(repo.workflow.staging, 'build-deploy', `${repo.name} staging workflow`);
    assert.equal(repo.workflow.production, 'build-deploy', `${repo.name} production workflow`);
    assert.ok(repo.deployments.staging, `${repo.name} is missing a staging deployments file`);
  }
});

test('unreleasable repos carry nulls in every deploy field', () => {
  for (const name of KNOWN_UNRELEASABLE) {
    const repo = getRepo(name)!;
    for (const env of DEPLOY_ENVS) {
      assert.equal(repo.workflow[env], null, `${name} ${env} workflow`);
      assert.equal(repo.deployments[env], null, `${name} ${env} deployments`);
      assert.equal(deploymentsFile(repo, env), null, `${name} ${env} file`);
      assert.equal(argoApp(repo, env), null, `${name} ${env} argo app`);
    }
  }
});

test('DEPLOY_ENVS lists the two environments in promotion order', () => {
  assert.deepEqual(DEPLOY_ENVS, ['staging', 'production']);
});

// The staging folder names are ArgoCD app names read off Vast-deployments on
// 2026-09-17, not derived from the repo name — `vastpay-dasaboard` is
// misspelled upstream and must stay misspelled here or the app is not found.
test('every releasable repo points at its staging file in Vast-deployments', () => {
  const folders: Record<string, string> = {
    VastPayPwa: 'vastpay-pwa',
    VastPayPwaV2: 'vastpay-pwa-v2',
    'VastPay-DashBoard': 'vastpay-dasaboard',
    VastMenuPwa: 'pwa',
    VastMenuPwaV2: 'pwav2',
    'VastMenu-DashBoard': 'vastmenu-dashboard',
    'vast-menu-payments': 'vastmenu-payments',
    'VastPay-BackEnd': 'vastpay-backend',
    'VastMenu-BackEnd': 'vastmenu-backend',
  };
  assert.equal(Object.keys(folders).length, 9);
  for (const [name, folder] of Object.entries(folders)) {
    const repo = getRepo(name)!;
    assert.equal(
      deploymentsFile(repo, 'staging'),
      `deployments/helm/staging/${folder}/stage.yaml`,
      `${name} staging file`,
    );
    assert.equal(argoApp(repo, 'staging'), folder, `${name} staging argo app`);
  }
});

test('the misspelled dashboard folder is preserved verbatim', () => {
  assert.equal(argoApp(getRepo('VastPay-DashBoard')!, 'staging'), 'vastpay-dasaboard');
});

test('an unreleasable repo has no argo app', () => {
  assert.equal(argoApp(getRepo('Terraform')!, 'staging'), null);
});

// Production folders in Vast-deployments are named after the repo, unlike
// staging's hand-written app names.
test('production files are keyed by the canonical repo name', () => {
  for (const repo of REPOS.filter(isReleasable)) {
    assert.equal(
      deploymentsFile(repo, 'production'),
      `deployments/helm/production/${repo.name}/prod.yaml`,
      `${repo.name} production file`,
    );
    assert.equal(argoApp(repo, 'production'), repo.name, `${repo.name} production argo app`);
  }
});

// Drift guard against the reviewer manifest, the upstream source of truth for
// repo names. The config now deliberately exceeds the manifest (repos that
// are cloneable but not releasable), so this is a one-way containment check
// rather than an exact match. Skips off the author's machine rather than
// failing.
test('every repo in the reviewer manifest is present in the config', (t) => {
  const manifest = join(homedir(), '.claude/vast-routines/scripts/repos.txt');
  if (!existsSync(manifest)) return t.skip('manifest not present on this machine');

  const expected = readFileSync(manifest, 'utf-8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => l.split(':')[0]);

  const names = REPOS.map((r) => r.name);
  for (const name of expected) {
    assert.ok(names.includes(name), `${name} is in repos.txt but missing from config`);
  }
});

test('every repo declares its teams', () => {
  for (const r of REPOS) {
    assert.ok(Array.isArray(r.teams), `${r.name} is missing teams`);
  }
});

test('team profiles expand to repos', () => {
  const frontend = reposForTeam('frontend').map((r) => r.name);
  assert.ok(frontend.includes('VastPayPwa'));
  assert.ok(frontend.includes('vast-menu-payments'));
  assert.ok(!frontend.includes('VastPay-BackEnd'), 'backend repo leaked into frontend');

  const backend = reposForTeam('backend').map((r) => r.name);
  assert.deepEqual(backend.sort(), ['VastMenu-BackEnd', 'VastPay-BackEnd', 'vastpay-payment-odoo']);

  assert.deepEqual(reposForTeam('infra').map((r) => r.name), ['Terraform']);
});

test('the all profile is every repo that belongs to some team', () => {
  const all = reposForTeam('all').map((r) => r.name).sort();
  const tagged = REPOS.filter((r) => r.teams.length > 0).map((r) => r.name).sort();
  assert.deepEqual(all, tagged);
});

test('an unknown team expands to nothing', () => {
  assert.deepEqual(reposForTeam('nope'), []);
});

// Releasable is derived, so cloneable-but-not-deployable repos can join the
// list without ever reaching status, promote, or deploy.
test('releasable means it has a staging workflow and a staging deployments file', () => {
  assert.equal(isReleasable(getRepo('VastPayPwa')!), true);
  assert.equal(isReleasable(getRepo('Terraform')!), false);
  assert.equal(isReleasable(getRepo('vastpay-payment-odoo')!), false);
  assert.equal(isReleasable(getRepo('Vast-Finance')!), false);
});

test('nine of the twelve repos are releasable', () => {
  assert.equal(
    REPOS.filter(isReleasable).length,
    9,
    'Vast-Finance has no workflow and no deployments file',
  );
});

// Copy before sorting: TEAMS is exported module state, and sorting it in place
// reorders it for every test that runs after this one.
test('TEAMS lists the profiles offered', () => {
  assert.deepEqual([...TEAMS].sort(), ['all', 'backend', 'frontend', 'infra']);
});

// The release trains `vast release --frontend` / `--backend` sweep. These are
// declared per repo, not derived from `teams`, so the two lists are asserted
// exactly: a repo silently joining or leaving a train is a release-scope bug.
test('the frontend release train is exactly the six frontend apps', () => {
  const names = reposForRelease('frontend').map((r) => r.name);
  assert.deepEqual(
    [...names].sort(),
    [
      'VastMenu-DashBoard',
      'VastMenuPwa',
      'VastMenuPwaV2',
      'VastPay-DashBoard',
      'VastPayPwa',
      'VastPayPwaV2',
    ].sort(),
  );
});

test('the backend release train is exactly the two backend services', () => {
  const names = reposForRelease('backend').map((r) => r.name);
  assert.deepEqual([...names].sort(), ['VastMenu-BackEnd', 'VastPay-BackEnd'].sort());
});

// Deliberate per the release-train spec: vast-menu-payments is cloned with the
// frontend and can be released by name, but it must never ride a `--frontend`
// sweep. releaseTeam is what separates the two, which is why it is null here
// while teams still says 'frontend'.
test('vast-menu-payments is releasable by name only, never in a sweep', () => {
  const payments = getRepo('vast-menu-payments')!;
  assert.equal(isReleasable(payments), true);
  assert.equal(payments.releaseTeam, null);
  assert.ok(payments.teams.includes('frontend'), 'still cloned with the frontend');
});

// Guards against ever putting a workflow-less repo in a sweep: everything a
// sweep touches must be something the release commands can actually act on.
test('every repo in a release train is releasable', () => {
  for (const repo of REPOS.filter((r) => r.releaseTeam !== null)) {
    assert.ok(isReleasable(repo), `${repo.name} rides a sweep but is not releasable`);
  }
});

// Copy before sorting is unnecessary here — the order itself is the contract,
// since it decides the order the flags are documented and offered in.
test('RELEASE_TEAMS lists the sweep flags', () => {
  assert.deepEqual(RELEASE_TEAMS, ['frontend', 'backend']);
});

// The Slack announcement addresses a human audience, so it uses a human name
// rather than the GitHub spelling. The names are declared, not derived: the
// dashboards' canonical spellings ("VastPay-DashBoard") would produce
// something nobody calls them.
test('every repo carries a non-empty human display name', () => {
  for (const r of REPOS) {
    assert.equal(typeof r.displayName, 'string', `${r.name} is missing displayName`);
    assert.ok(r.displayName.trim().length > 0, `${r.name} has an empty displayName`);
  }
});

test('the dashboard display names are the human ones, not the repo spellings', () => {
  assert.equal(getRepo('VastPay-DashBoard')?.displayName, 'Vastpay Dashboard');
  assert.equal(getRepo('VastMenu-DashBoard')?.displayName, 'Vastmenu Dashboard');
});

test('every display name is the one the team uses in Slack', () => {
  const expected: Record<string, string> = {
    VastPayPwa: 'Vastpay Pwa',
    VastPayPwaV2: 'Vastpay Pwa V2',
    'VastPay-DashBoard': 'Vastpay Dashboard',
    VastMenuPwa: 'Vastmenu Pwa',
    VastMenuPwaV2: 'Vastmenu Pwa V2',
    'VastMenu-DashBoard': 'Vastmenu Dashboard',
    'vast-menu-payments': 'Vastmenu Payments',
    'Vast-Finance': 'Vast Finance',
    'VastPay-BackEnd': 'Vastpay Backend',
    'VastMenu-BackEnd': 'Vastmenu Backend',
    'vastpay-payment-odoo': 'Vastpay Payment Odoo',
    Terraform: 'Terraform',
  };
  assert.equal(Object.keys(expected).length, REPOS.length);
  for (const [name, displayName] of Object.entries(expected)) {
    assert.equal(getRepo(name)?.displayName, displayName, `${name} display name`);
  }
});
