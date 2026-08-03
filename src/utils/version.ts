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

const TAG = /^(\d+)\.(\d+)\.(\d+)(?:-rc(\d+))?$/;

export function parseTag(tag: string): ParsedVersion {
  const trimmed = tag.trim();
  const m = TAG.exec(trimmed);
  if (!m) {
    throw new Error(
      `Unparseable version tag: "${trimmed}". Expected X.Y.Z or X.Y.Z-rcN. ` +
        `Tags carrying an ad-hoc suffix (e.g. "1.1.3-rc4-health", "4.3.6-test") ` +
        `are ambiguous to increment — pass --target-version explicitly.`,
    );
  }
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    rc: m[4] === undefined ? null : Number(m[4]),
    rcWidth: m[4]?.length ?? 1,
  };
}

const base = (v: ParsedVersion): string => `${v.major}.${v.minor}.${v.patch}`;

/** Next staging candidate. A finalised tag starts a fresh series at rc1. */
export function nextRc(tag: string): string {
  const v = parseTag(tag);
  const next = String((v.rc ?? 0) + 1).padStart(v.rcWidth, '0');
  return `${base(v)}-rc${next}`;
}

/** Production version: the staging series with its candidate suffix dropped. */
export function stripRc(tag: string): string {
  return base(parseTag(tag));
}

export function bump(tag: string, level: 'patch' | 'minor' | 'major'): string {
  const v = parseTag(tag);
  const next =
    level === 'major'
      ? { major: v.major + 1, minor: 0, patch: 0 }
      : level === 'minor'
        ? { major: v.major, minor: v.minor + 1, patch: 0 }
        : { major: v.major, minor: v.minor, patch: v.patch + 1 };
  return `${next.major}.${next.minor}.${next.patch}-rc1`;
}
