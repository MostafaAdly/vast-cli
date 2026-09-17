/**
 * Parses the deployed image tag out of a values file.
 *
 * Staging's file comes from Vast-deployments over the API (see
 * `utils/deployments.ts`), so for staging this module is only the parser.
 * Production has not been migrated yet, and what is actually running there is
 * still recorded in each app repo's own Helm values on `origin/production` —
 * `readTagAtRef` reads that, out of git, without checking anything out.
 */
import { execFileSync } from 'child_process';
/**
 * Pre-migration source of production's deployed tag: the app repo's own Helm
 * values. Only two of nine repos have a production file in Vast-deployments,
 * and one of those is a seed with no `tag:` line. This constant — and every
 * fallback that reads it — goes away when `PRODUCTION_PIPELINE_READY` flips
 * and ArgoCD deploys production from Vast-deployments.
 */
export const PRE_MIGRATION_PRODUCTION_HELM = 'Helm/values-prod.yaml';
/** First uncommented `tag:` value in a values file. */
export function extractTag(yaml) {
    for (const line of yaml.split('\n')) {
        const stripped = line.trim();
        if (stripped.startsWith('#'))
            continue;
        const m = /^tag:\s*["']?([^"'\s#]+)["']?/.exec(stripped);
        if (m)
            return m[1];
    }
    throw new Error('No `tag:` found in Helm values file');
}
/**
 * @returns the tag in `helmPath` as committed at `ref`.
 *
 * `git show <ref>:<path>` so nothing is checked out — the committed state on
 * the remote-tracking branch is what is deployed, and it reflects everyone's
 * deploys, not just this machine's.
 */
export function readTagAtRef(repoDir, ref, helmPath) {
    let yaml;
    try {
        yaml = execFileSync('git', ['show', `${ref}:${helmPath}`], {
            cwd: repoDir,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });
    }
    catch {
        throw new Error(`Could not read ${helmPath} at ${ref}. Is the ref fetched?`);
    }
    return extractTag(yaml);
}
//# sourceMappingURL=helm.js.map