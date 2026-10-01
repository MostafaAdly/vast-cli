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
 * Production's deployed tag: Vast-deployments, like staging's.
 *
 * DevOps created every releasable repo's production file on 2026-09-23 and the
 * pipelines have committed to them since 2026-09-28, so that file is what
 * ArgoCD deploys. The app repo's `Helm/values-prod.yaml` stopped moving at the
 * same time — on 2026-10-01 VastMenuPwaV2's still said 2.0.11 while
 * Vast-deployments said 2.0.19 — and is only asked when the file is missing or
 * carries no tag.
 *
 * Only those two states fall back. A network or auth failure propagates
 * unchanged: guessing from a possibly-stale checkout because GitHub was down
 * would be a quieter, worse lie.
 *
 * The fallback goes away with `PRE_MIGRATION_PRODUCTION_HELM`.
 */
export declare function productionTag(repo: RepoConfig, dir: string | null, fetchFile?: FetchFile, readAtRef?: typeof readTagAtRef): Promise<ProductionTagSource>;
//# sourceMappingURL=deployments.d.ts.map