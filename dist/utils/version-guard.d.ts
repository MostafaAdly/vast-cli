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
import type { RepoConfig } from '../config/repos.js';
export type ProductionVerdict = {
    kind: 'clear';
} | {
    kind: 'behind';
    production: string;
    corrected: string;
};
/** @throws when either tag is unparseable — callers treat that as "unknown". */
export declare function checkAgainstProduction(candidate: string, production: string): ProductionVerdict;
export interface GuardNotice {
    tone: 'warn' | 'muted';
    text: string;
}
export type GuardResult = {
    ok: true;
    version: string;
    /** Printed before the deploy board. */
    notice?: GuardNotice;
    /** Short form for the summary line. */
    note?: string;
} | {
    ok: false;
    detail: string;
};
export type ReadProduction = (repo: RepoConfig) => Promise<string>;
/** Production's tag from Vast-deployments, the same reader `vast status` uses. */
export declare const readProductionTag: ReadProduction;
/**
 * @param explicit the version came from --target-version: warn, never refuse
 * @param fixVersion --fix-version: replace a behind version with the first one past production
 */
export declare function guardStagingVersion(repo: RepoConfig, dir: string | null, candidate: string, options: {
    explicit: boolean;
    fixVersion: boolean;
}, readProduction?: ReadProduction): Promise<GuardResult>;
//# sourceMappingURL=version-guard.d.ts.map