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
import { extractTag } from './helm.js';
import { ORG } from './remote.js';
const execFileAsync = promisify(execFile);
export const DEPLOYMENTS_REPO = 'Vast-deployments';
/** @returns the decoded contents of `<path>` on Vast-deployments@main. */
export async function fetchDeploymentsFile(path) {
    let stdout;
    try {
        ({ stdout } = await execFileAsync('gh', [
            'api',
            `repos/${ORG}/${DEPLOYMENTS_REPO}/contents/${path}?ref=main`,
            '--jq',
            '.content',
        ]));
    }
    catch (err) {
        const stderr = String(err.stderr ?? '');
        // A missing file is the one failure callers act on differently (a repo that
        // has not been onboarded yet), so it gets its own message.
        if (stderr.includes('404') || stderr.includes('Not Found')) {
            throw new Error(`no ${path} in ${DEPLOYMENTS_REPO}`);
        }
        const detail = stderr.trim() || err.message;
        throw new Error(`Could not read ${path} from ${DEPLOYMENTS_REPO}: ${detail}`);
    }
    // The contents API base64s the file and wraps the payload across lines.
    return Buffer.from(stdout.replace(/\s+/g, ''), 'base64').toString('utf-8');
}
/** @returns the tag currently deployed to `env`, per Vast-deployments. */
export async function deployedTag(repo, env, fetchFile = fetchDeploymentsFile) {
    const path = deploymentsFile(repo, env);
    if (!path)
        throw new Error(`${repo.name} has no ${env} deployments file`);
    return extractTag(await fetchFile(path));
}
/** Browser link to a values file, for printing next to a deployed tag. */
export function deploymentsFileUrl(path) {
    return `https://github.com/${ORG}/${DEPLOYMENTS_REPO}/blob/main/${path}`;
}
//# sourceMappingURL=deployments.js.map