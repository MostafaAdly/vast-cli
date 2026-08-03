/**
 * Version derivation.
 *
 * Staging carries an rc suffix and increments per deploy; production drops the
 * suffix entirely. Both derive from the tag already recorded in the repo's Helm
 * values, so the number is never chosen by hand.
 */
const TAG = /^(\d+)\.(\d+)\.(\d+)(?:-rc(\d+))?$/;
export function parseTag(tag) {
    const trimmed = tag.trim();
    const m = TAG.exec(trimmed);
    if (!m) {
        throw new Error(`Unparseable version tag: "${trimmed}". Expected X.Y.Z or X.Y.Z-rcN. ` +
            `Tags carrying an ad-hoc suffix (e.g. "1.1.3-rc4-health", "4.3.6-test") ` +
            `are ambiguous to increment — pass --target-version explicitly.`);
    }
    return {
        major: Number(m[1]),
        minor: Number(m[2]),
        patch: Number(m[3]),
        rc: m[4] === undefined ? null : Number(m[4]),
        rcWidth: m[4]?.length ?? 1,
    };
}
const base = (v) => `${v.major}.${v.minor}.${v.patch}`;
/** Next staging candidate. A finalised tag starts a fresh series at rc1. */
export function nextRc(tag) {
    const v = parseTag(tag);
    const next = String((v.rc ?? 0) + 1).padStart(v.rcWidth, '0');
    return `${base(v)}-rc${next}`;
}
/** Production version: the staging series with its candidate suffix dropped. */
export function stripRc(tag) {
    return base(parseTag(tag));
}
export function bump(tag, level) {
    const v = parseTag(tag);
    const next = level === 'major'
        ? { major: v.major + 1, minor: 0, patch: 0 }
        : level === 'minor'
            ? { major: v.major, minor: v.minor + 1, patch: 0 }
            : { major: v.major, minor: v.minor, patch: v.patch + 1 };
    return `${next.major}.${next.minor}.${next.patch}-rc1`;
}
//# sourceMappingURL=version.js.map