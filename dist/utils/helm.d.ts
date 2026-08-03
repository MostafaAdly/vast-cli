/**
 * Reads the deployed image tag out of a repo's Helm values.
 *
 * Uses `git show <ref>:<path>` so nothing is checked out — the committed state
 * on the remote branch is what is deployed, and it reflects everyone's deploys,
 * not just this machine's.
 */
/** First uncommented `tag:` value in a Helm values file. */
export declare function extractTag(yaml: string): string;
export declare function readDeployedTag(repoDir: string, ref: string, helmPath: string): string;
//# sourceMappingURL=helm.d.ts.map