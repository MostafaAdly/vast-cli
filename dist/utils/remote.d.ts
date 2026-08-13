/**
 * Identifies a checkout by its `origin` remote rather than its path.
 *
 * Directory names do not track repo names — on the author's machine
 * `vastmenu-api` is VastMenu-BackEnd and `vastpay-api` is VastPay-BackEnd — and
 * remote URLs are lowercase while canonical names are mixed case. The remote is
 * the only reliable identity.
 */
export declare const ORG = "Vast-menu";
export interface RemoteId {
    owner: string;
    name: string;
}
export declare function parseRemote(url: string): RemoteId | null;
/** @returns the canonical repo name, or null if this is not one of ours. */
export declare function canonicalRepoName(url: string): string | null;
//# sourceMappingURL=remote.d.ts.map