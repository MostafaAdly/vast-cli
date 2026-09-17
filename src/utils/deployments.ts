/**
 * The deployed image tag now lives in Vast-deployments, not in the app repo.
 *
 * ArgoCD watches `deployments/helm/<env>/<app>/<file>.yaml` on that repo's
 * `main`, and each repo's build-deploy workflow commits the tag there. So the
 * only honest answer to "what is deployed?" is that file's committed state —
 * read over the API rather than from a local checkout, because nobody clones
 * Vast-deployments and a stale local copy would silently lie.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

import { deploymentsFile } from '../config/repos.js';
import type { DeployEnv, RepoConfig } from '../config/repos.js';
import { extractTag, readTagAtRef, PRE_MIGRATION_PRODUCTION_HELM } from './helm.js';
import { productionPipelineReady } from '../config/production-lock.js';
import { ORG } from './remote.js';

const execFileAsync = promisify(execFile);

export const DEPLOYMENTS_REPO = 'Vast-deployments';

/** Reads a file from Vast-deployments@main. Injected in tests so `gh` is never shelled out to. */
export type FetchFile = (path: string) => Promise<string>;

/** @returns the decoded contents of `<path>` on Vast-deployments@main. */
export async function fetchDeploymentsFile(path: string): Promise<string> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync('gh', [
      'api',
      `repos/${ORG}/${DEPLOYMENTS_REPO}/contents/${path}?ref=main`,
      '--jq',
      '.content',
    ]));
  } catch (err) {
    const stderr = String((err as { stderr?: unknown }).stderr ?? '');
    // A missing file is the one failure callers act on differently (a repo that
    // has not been onboarded yet), so it gets its own message.
    if (stderr.includes('404') || stderr.includes('Not Found')) {
      throw new Error(`no ${path} in ${DEPLOYMENTS_REPO}`);
    }
    const detail = stderr.trim() || (err as Error).message;
    throw new Error(`Could not read ${path} from ${DEPLOYMENTS_REPO}: ${detail}`);
  }
  // The contents API base64s the file and wraps the payload across lines.
  return Buffer.from(stdout.replace(/\s+/g, ''), 'base64').toString('utf-8');
}

/** @returns the tag currently deployed to `env`, per Vast-deployments. */
export async function deployedTag(
  repo: RepoConfig,
  env: DeployEnv,
  fetchFile: FetchFile = fetchDeploymentsFile,
): Promise<string> {
  const path = deploymentsFile(repo, env);
  if (!path) throw new Error(`${repo.name} has no ${env} deployments file`);
  return extractTag(await fetchFile(path));
}

/** Where a production tag was actually read from. */
export interface ProductionTagSource {
  tag: string;
  source: 'vast-deployments' | 'app-repo';
}

/** The reader's own wording for "that file is not in Vast-deployments". */
const MISSING_IN_DEPLOYMENTS = new RegExp(`^no .* in ${DEPLOYMENTS_REPO}$`);

/**
 * Production's deployed tag, from wherever it is actually recorded today.
 *
 * Production is not migrated: seven of nine repos have no file in
 * Vast-deployments at all, and the two that do are seeds — one carries no
 * `tag:` line. What is running is still each app repo's `Helm/values-prod.yaml`
 * on `origin/production`, so a missing or placeholder file falls back there
 * rather than failing a hotfix that used to work.
 *
 * Only those two states fall back. A network or auth failure propagates
 * unchanged: guessing from a possibly-stale checkout because GitHub was down
 * would be a quieter, worse lie.
 *
 * The fallback goes away with `PRE_MIGRATION_PRODUCTION_HELM`.
 */
export async function productionTag(
  repo: RepoConfig,
  dir: string | null,
  fetchFile: FetchFile = fetchDeploymentsFile,
  readAtRef: typeof readTagAtRef = readTagAtRef,
  ready: boolean = productionPipelineReady(),
): Promise<ProductionTagSource> {
  // Until production migrates, the file in Vast-deployments is a seed copied at
  // cutover and drifts the moment someone deploys production by hand; the app
  // repo's Helm on origin/production is what is actually running. Verified on
  // 2026-09-17: vast-menu-payments' seed said 1.0.3, the app repo said 1.1.2.
  // So pre-migration the app repo is asked first, and the seed only answers
  // for a repo that is not cloned here.
  if (!ready && dir) {
    try {
      return {
        tag: readAtRef(dir, 'origin/production', PRE_MIGRATION_PRODUCTION_HELM),
        source: 'app-repo',
      };
    } catch {
      // Not fetched, or no Helm file on this branch — try the seed below.
    }
  }

  try {
    return { tag: await deployedTag(repo, 'production', fetchFile), source: 'vast-deployments' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const unmigrated = MISSING_IN_DEPLOYMENTS.test(message) || message.includes('No `tag:` found');
    if (!unmigrated) throw error;

    if (dir) {
      try {
        return {
          tag: readAtRef(dir, 'origin/production', PRE_MIGRATION_PRODUCTION_HELM),
          source: 'app-repo',
        };
      } catch {
        // Fall through to the error naming both places — reporting only the
        // git failure would hide that Vast-deployments was tried first.
      }
    }

    const path = deploymentsFile(repo, 'production') ?? `a production file for ${repo.name}`;
    const where = dir
      ? `${PRE_MIGRATION_PRODUCTION_HELM} at origin/production in ${dir}`
      : `${PRE_MIGRATION_PRODUCTION_HELM} at origin/production (${repo.name} is not cloned)`;
    throw new Error(`no ${path} in ${DEPLOYMENTS_REPO}, and no ${where}`);
  }
}
