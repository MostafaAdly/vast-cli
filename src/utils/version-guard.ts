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
import { deployedTag } from './deployments.js';
import { nextPatch, parseTag, type ParsedVersion } from './version.js';

export type ProductionVerdict =
  | { kind: 'clear' }
  | { kind: 'behind'; production: string; corrected: string };

function compareBase(a: ParsedVersion, b: ParsedVersion): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/** @throws when either tag is unparseable — callers treat that as "unknown". */
export function checkAgainstProduction(candidate: string, production: string): ProductionVerdict {
  if (compareBase(parseTag(candidate), parseTag(production)) > 0) return { kind: 'clear' };
  return { kind: 'behind', production, corrected: `${nextPatch(production)}-rc1` };
}

export interface GuardNotice {
  tone: 'warn' | 'muted';
  text: string;
}

export type GuardResult =
  | {
      ok: true;
      version: string;
      /** Printed before the deploy board. */
      notice?: GuardNotice;
      /** Short form for the summary line. */
      note?: string;
    }
  | { ok: false; detail: string };

export type ReadProduction = (repo: RepoConfig) => Promise<string>;

/** Production's tag from Vast-deployments, the same reader `vast status` uses. */
export const readProductionTag: ReadProduction = (repo) => deployedTag(repo, 'production');

/**
 * @param explicit the version came from --target-version: warn, never refuse
 * @param fixVersion --fix-version: replace a behind version with the first one past production
 */
export async function guardStagingVersion(
  repo: RepoConfig,
  dir: string | null,
  candidate: string,
  options: { explicit: boolean; fixVersion: boolean },
  readProduction: ReadProduction = readProductionTag,
): Promise<GuardResult> {
  let verdict: ProductionVerdict;
  try {
    verdict = checkAgainstProduction(candidate, await readProduction(repo));
  } catch {
    // Missing data never blocks a release that worked before this guard existed.
    return {
      ok: true,
      version: candidate,
      notice: { tone: 'muted', text: `${repo.name}: could not read production's tag — ${candidate} not checked against production` },
    };
  }

  if (verdict.kind === 'clear') return { ok: true, version: candidate };

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
    detail:
      `${candidate} is not above production ${production} — its release would take production backwards. ` +
      `Rerun with --fix-version (→ ${corrected}) or --target-version`,
  };
}
