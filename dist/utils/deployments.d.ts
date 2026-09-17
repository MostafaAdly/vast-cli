/**
 * The deployed image tag now lives in Vast-deployments, not in the app repo.
 *
 * ArgoCD watches `deployments/helm/<env>/<app>/<file>.yaml` on that repo's
 * `main`, and each repo's build-deploy workflow commits the tag there. So the
 * only honest answer to "what is deployed?" is that file's committed state —
 * read over the API rather than from a local checkout, because nobody clones
 * Vast-deployments and a stale local copy would silently lie.
 */
import type { DeployEnv, RepoConfig } from '../config/repos.js';
import { readTagAtRef } from './helm.js';
export declare const DEPLOYMENTS_REPO = "Vast-deployments";
/** Reads a file from Vast-deployments@main. Injected in tests so `gh` is never shelled out to. */
export type FetchFile = (path: string) => Promise<string>;
/** @returns the decoded contents of `<path>` on Vast-deployments@main. */
export declare function fetchDeploymentsFile(path: string): Promise<string>;
/** @returns the tag currently deployed to `env`, per Vast-deployments. */
export declare function deployedTag(repo: RepoConfig, env: DeployEnv, fetchFile?: FetchFile): Promise<string>;
/** Where a production tag was actually read from. */
export interface ProductionTagSource {
    tag: string;
    source: 'vast-deployments' | 'app-repo';
}
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
export declare function productionTag(repo: RepoConfig, dir: string | null, fetchFile?: FetchFile, readAtRef?: typeof readTagAtRef, ready?: boolean): Promise<ProductionTagSource>;
//# sourceMappingURL=deployments.d.ts.map