/**
 * Identifies a checkout by its `origin` remote rather than its path.
 *
 * Directory names do not track repo names — on the author's machine
 * `vastmenu-api` is VastMenu-BackEnd and `vastpay-api` is VastPay-BackEnd — and
 * remote URLs are lowercase while canonical names are mixed case. The remote is
 * the only reliable identity.
 */
import { getRepo } from '../config/repos.js';
export const ORG = 'Vast-menu';
export function parseRemote(url) {
    const trimmed = url.trim().replace(/\/+$/, '').replace(/\.git$/, '');
    if (!trimmed)
        return null;
    // scp-like: git@github.com:Owner/Name
    const scp = /^[^@\s]+@[^:\s]+:(.+)$/.exec(trimmed);
    // protocol form: https://github.com/Owner/Name, ssh://git@github.com/Owner/Name
    const path = scp ? scp[1] : trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?[^/]+\//i, '');
    // If neither pattern applied, `path` still holds the original string.
    if (path === trimmed && !scp)
        return null;
    const parts = path.split('/').filter(Boolean);
    if (parts.length < 2)
        return null;
    return { owner: parts[parts.length - 2], name: parts[parts.length - 1] };
}
/** @returns the canonical repo name, or null if this is not one of ours. */
export function canonicalRepoName(url) {
    const id = parseRemote(url);
    if (!id)
        return null;
    if (id.owner.toLowerCase() !== ORG.toLowerCase())
        return null;
    return getRepo(id.name)?.name ?? null;
}
//# sourceMappingURL=remote.js.map