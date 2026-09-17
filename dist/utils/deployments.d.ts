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
export declare const DEPLOYMENTS_REPO = "Vast-deployments";
/** Reads a file from Vast-deployments@main. Injected in tests so `gh` is never shelled out to. */
export type FetchFile = (path: string) => Promise<string>;
/** @returns the decoded contents of `<path>` on Vast-deployments@main. */
export declare function fetchDeploymentsFile(path: string): Promise<string>;
/** @returns the tag currently deployed to `env`, per Vast-deployments. */
export declare function deployedTag(repo: RepoConfig, env: DeployEnv, fetchFile?: FetchFile): Promise<string>;
/** Browser link to a values file, for printing next to a deployed tag. */
export declare function deploymentsFileUrl(path: string): string;
//# sourceMappingURL=deployments.d.ts.map