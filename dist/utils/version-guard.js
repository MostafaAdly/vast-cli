/**
 * Refuse a staging version that production would have to go backwards to take.
 *
 * Staging continues its own rc series, but hotfixes advance production's patch
 * on their own (2.4.0 -> 2.4.1, see `nextPatch`). So the two drift: on
 * 2026-10-01 VastMenu-DashBoard's next staging build derived as 2.1.12-rc31
 * while production ran 2.1.36. Shipped as-is, the next release PR would be
 * release/2.1.12, landing on top of 2.1.36.
 *
 * Only X.Y.Z is compared: that is what production is labelled with once the
 * rc suffix is stripped, so a higher rc never rescues a lower base.
 */
import { productionTag } from './deployments.js';
import { nextPatch, parseTag } from './version.js';
function compareBase(a, b) {
    return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}
/** @throws when either tag is unparseable — callers treat that as "unknown". */
export function checkAgainstProduction(candidate, production) {
    if (compareBase(parseTag(candidate), parseTag(production)) > 0)
        return { kind: 'clear' };
    return { kind: 'behind', production, corrected: `${nextPatch(production)}-rc1` };
}
/** Production's tag from Vast-deployments, the same reader `vast status` uses. */
export const readProductionTag = async (repo, dir) => (await productionTag(repo, dir)).tag;
/**
 * @param explicit the version came from --target-version: warn, never refuse
 * @param fixVersion --fix-version: replace a behind version with the first one past production
 */
export async function guardStagingVersion(repo, dir, candidate, options, readProduction = readProductionTag) {
    let verdict;
    try {
        verdict = checkAgainstProduction(candidate, await readProduction(repo, dir));
    }
    catch {
        // Missing data never blocks a release that worked before this guard existed.
        return {
            ok: true,
            version: candidate,
            notice: { tone: 'muted', text: `${repo.name}: could not read production's tag — ${candidate} not checked against production` },
        };
    }
    if (verdict.kind === 'clear')
        return { ok: true, version: candidate };
    const { production, corrected } = verdict;
    if (options.explicit) {
        return {
            ok: true,
            version: candidate,
            notice: {
                tone: 'warn',
                text: `${repo.name}: ${candidate} is not above production ${production} — its release would take production backwards`,
            },
            note: `not above production ${production}`,
        };
    }
    if (options.fixVersion) {
        return {
            ok: true,
            version: corrected,
            notice: {
                tone: 'warn',
                text: `${repo.name} auto-corrected ${candidate} → ${corrected} (production is ${production})`,
            },
            note: `auto-corrected from ${candidate} (production ${production})`,
        };
    }
    return {
        ok: false,
        detail: `${candidate} is not above production ${production} — its release would take production backwards. ` +
            `Rerun with --fix-version (→ ${corrected}) or --target-version`,
    };
}
//# sourceMappingURL=version-guard.js.map