/**
 * Version derivation.
 *
 * Staging carries an rc suffix and increments per deploy; production drops the
 * suffix entirely. Both derive from the tag already recorded in the repo's Helm
 * values, so the number is never chosen by hand.
 */
export interface ParsedVersion {
    major: number;
    minor: number;
    patch: number;
    /** null for a finalised X.Y.Z. */
    rc: number | null;
    /**
     * Digit width of the rc suffix, so zero padding survives a round trip.
     * Real tags in these repos include both `2.1.0-rc48` and `1.6.9-rc03`.
     */
    rcWidth: number;
}
export declare function parseTag(tag: string): ParsedVersion;
/** Next staging candidate. A finalised tag starts a fresh series at rc1. */
export declare function nextRc(tag: string): string;
/** Production version: the staging series with its candidate suffix dropped. */
export declare function stripRc(tag: string): string;
export declare function bump(tag: string, level: 'patch' | 'minor' | 'major'): string;
//# sourceMappingURL=version.d.ts.map