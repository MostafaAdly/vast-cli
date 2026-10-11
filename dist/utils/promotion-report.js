/**
 * What a promotion did, filled in by `promote()` as it goes so a caller can
 * report it as data. The boolean `promote()` returns stays the success signal;
 * this is the detail behind it.
 */
/** Starts as refused: a promotion that returns early without saying more has refused. */
export function newReport() {
    return { commits: null, result: 'refused' };
}
/**
 * Where a promotion stands, as the stream's `plan.promote` says it. One mapping
 * for `release` and `promote`, so the two can never drift as results grow.
 * A repo with no develop is the caller's to say: the report cannot know it.
 */
export function promoteState(result) {
    switch (result) {
        case 'merged':
            return 'merged';
        case 'would merge':
            return 'will merge';
        case 'nothing to promote':
            return 'nothing to promote';
        default:
            return 'not run';
    }
}
//# sourceMappingURL=promotion-report.js.map