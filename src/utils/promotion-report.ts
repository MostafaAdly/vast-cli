/**
 * What a promotion did, filled in by `promote()` as it goes so a caller can
 * report it as data. The boolean `promote()` returns stays the success signal;
 * this is the detail behind it.
 */

import type { SlackResult } from './events.js';
import type { ReleaseKind } from './release-branch.js';

export type PromotionResult =
  | 'merged'
  | 'would merge'
  | 'nothing to promote'
  | 'refused'
  | 'pr opened'
  | 'would open pr';

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
export function newReport(): PromotionReport {
  return { commits: null, result: 'refused' };
}
