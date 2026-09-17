/**
 * Parses the deployed image tag out of a values file.
 *
 * Staging's file comes from Vast-deployments over the API (see
 * `utils/deployments.ts`), so for staging this module is only the parser.
 * Production has not been migrated yet, and what is actually running there is
 * still recorded in each app repo's own Helm values on `origin/production` —
 * `readTagAtRef` reads that, out of git, without checking anything out.
 */
/**
 * Pre-migration source of production's deployed tag: the app repo's own Helm
 * values. Only two of nine repos have a production file in Vast-deployments,
 * and one of those is a seed with no `tag:` line. This constant — and every
 * fallback that reads it — goes away when `PRODUCTION_PIPELINE_READY` flips
 * and ArgoCD deploys production from Vast-deployments.
 */
export declare const PRE_MIGRATION_PRODUCTION_HELM = "Helm/values-prod.yaml";
/** First uncommented `tag:` value in a values file. */
export declare function extractTag(yaml: string): string;
/**
 * @returns the tag in `helmPath` as committed at `ref`.
 *
 * `git show <ref>:<path>` so nothing is checked out — the committed state on
 * the remote-tracking branch is what is deployed, and it reflects everyone's
 * deploys, not just this machine's.
 */
export declare function readTagAtRef(repoDir: string, ref: string, helmPath: string): string;
//# sourceMappingURL=helm.d.ts.map