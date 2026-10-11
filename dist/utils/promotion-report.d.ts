/**
 * What a promotion did, filled in by `promote()` as it goes so a caller can
 * report it as data. The boolean `promote()` returns stays the success signal;
 * this is the detail behind it.
 */
import type { PromoteState, SlackResult } from './events.js';
import type { ReleaseKind } from './release-branch.js';
export type PromotionResult = 'merged' | 'would merge' | 'nothing to promote' | 'refused' | 'pr opened' | 'would open pr';
export interface PromotionReport {
    /** Commits the promotion carries: develop → staging, staging → production, or picks. */
    commits: number | null;
    result: PromotionResult;
    /** Production only. */
    version?: string;
    kind?: ReleaseKind;
    branch?: string;
    url?: string | null;
    slack?: SlackResult | null;
    /** Why it stopped, when result is 'refused'. */
    error?: string;
}
/** Starts as refused: a promotion that returns early without saying more has refused. */
export declare function newReport(): PromotionReport;
/**
 * Where a promotion stands, as the stream's `plan.promote` says it. One mapping
 * for `release` and `promote`, so the two can never drift as results grow.
 * A repo with no develop is the caller's to say: the report cannot know it.
 */
export declare function promoteState(result: PromotionResult | undefined): PromoteState;
//# sourceMappingURL=promotion-report.d.ts.map