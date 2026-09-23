/**
 * Shared fixtures for the `vast pending` renderer tests. Not a *.test.ts
 * file, so the runner never executes it on its own.
 */

import type { PendingPr, PendingReport, RepoPending } from '../src/utils/pending-report.js';
import type { Contributor } from '../src/utils/contributors.js';

export const NOW = new Date('2026-09-24T12:00:00Z');
export const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * 86_400_000);
export const REPO_URL = 'https://github.com/Vast-menu/VastPayPwaV2';
export const OSAMA: Contributor = { name: 'Osama Elshimy', login: null, emails: ['o@e.com'] };
export const MOSTAFA: Contributor = { name: 'Mostafa Adly', login: 'MostafaAdly', emails: ['m@e.com'] };

export function pr(number: number, over: Partial<PendingPr> = {}): PendingPr {
  return {
    number,
    title: `Change ${number}`,
    url: `${REPO_URL}/pull/${number}`,
    branch: `fix/change-${number}`,
    contributors: [OSAMA],
    tickets: [],
    phrase: null,
    landedAt: daysAgo(3),
    ported: false,
    detailsUnavailable: false,
    ...over,
  };
}

export function fixtureRepo(): RepoPending {
  return {
    repo: 'VastPayPwaV2',
    displayName: 'Vastpay Pwa V2',
    compareUrl: `${REPO_URL}/compare/production...staging`,
    problem: null,
    notes: [],
    forward: {
      source: 'staging',
      target: 'production',
      inFlight: [
        {
          number: 334,
          url: `${REPO_URL}/pull/334`,
          branch: 'hotfix/2.1.15',
          prs: [pr(301, { title: 'One create-charge per sheet', phrase: 'ELM single charge', contributors: [MOSTAFA], landedAt: daysAgo(13) })],
        },
      ],
      waiting: [
        pr(298, { title: 'Old change', landedAt: daysAgo(21) }),
        pr(313, {
          title: 'Reuse guest tokens without overriding customer sessions',
          phrase: 'guest token reuse',
          tickets: ['VA-13091'],
          landedAt: daysAgo(9),
        }),
      ],
      direct: [
        { sha: '46d26d9' + 'a'.repeat(33), subject: 'fix(pwa): preserve disabled plugin lifecycle', landedAt: daysAgo(3), ported: false },
      ],
    },
    reverse: {
      source: 'production',
      target: 'staging',
      inFlight: [],
      waiting: [
        pr(270, { title: 'Include guest token in send-OTP request', ported: true, landedAt: daysAgo(30) }),
        pr(332, { title: 'Raise pwa-v2 memory request', landedAt: daysAgo(5) }),
      ],
      direct: [],
    },
  };
}

export function fixtureReport(repos: RepoPending[] = [fixtureRepo()], parity = true): PendingReport {
  return { to: 'production', generatedAt: NOW, parity, repos };
}
