import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  prNumbersInRange,
  prNumbersOfPicks,
  shippedPrs,
  resolveMentions,
  type PrLookup,
} from '../src/utils/shipped.js';
import type { ResolvedPick } from '../src/utils/picks.js';
import type { ShippedPr } from '../src/utils/release-message.js';

/**
 * A real repo with real merge commits: `git log --merges` matches on parent
 * count, so `--allow-empty` commits that merely carry a merge-shaped subject
 * would be invisible to it and the test would pass against nothing.
 *
 * base..head holds three merges — two real PRs and one CI version bump, which
 * the announcement must not mention.
 */
function fixture(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'vast-shipped-'));
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: 'pipe' }).trim();

  git('init', '-q', '-b', 'production');
  git('config', 'user.email', 't@e.com');
  git('config', 'user.name', 'T');
  writeFileSync(join(dir, 'f.txt'), 'base\n');
  git('add', '.');
  git('commit', '-qm', 'base');

  git('checkout', '-qb', 'staging');

  const mergeBranch = (branch: string, file: string, subject: string): void => {
    git('checkout', '-qb', branch);
    writeFileSync(join(dir, file), `${file}\n`);
    git('add', '.');
    git('commit', '-qm', `feat: ${file}`);
    git('checkout', '-q', 'staging');
    git('merge', '-q', '--no-ff', '-m', subject, branch);
  };

  mergeBranch('feat/x', 'x.txt', 'Merge pull request #7 from Vast-Menu/feat/x');
  mergeBranch('bump', 'b.txt', 'Merge pull request #8 from Vast-Menu/bump-stage-1.0.0-rc1');
  mergeBranch('fix/y', 'y.txt', 'Merge pull request #12 from Vast-Menu/fix/y');

  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function withFixture(fn: (dir: string) => void): void {
  const f = fixture();
  try {
    fn(f.dir);
  } finally {
    f.cleanup();
  }
}

const pick = (subject: string): ResolvedPick => ({
  input: subject,
  sha: 'a'.repeat(40),
  subject,
  isMerge: true,
  timestamp: 0,
});

test('reads PR numbers off the merge commits in a range', () => {
  withFixture((dir) => {
    assert.deepEqual(prNumbersInRange(dir, 'production', 'staging'), [7, 12]);
  });
});

// The CI's own bump-stage-* / bump-prod-* PRs describe the pipeline, not
// shipped work — there is nothing in them for the team to read about.
test("the CI's version-bump PR is left out", () => {
  withFixture((dir) => {
    assert.ok(!prNumbersInRange(dir, 'production', 'staging').includes(8));
  });
});

test('an empty range yields no PR numbers', () => {
  withFixture((dir) => {
    assert.deepEqual(prNumbersInRange(dir, 'staging', 'staging'), []);
  });
});

test('an unknown ref yields no PR numbers rather than throwing', () => {
  withFixture((dir) => {
    assert.deepEqual(prNumbersInRange(dir, 'production', 'no-such-branch'), []);
  });
});

test('PR numbers come back unique and ascending', () => {
  const picks = [
    pick('Merge pull request #12 from Vast-Menu/fix/y'),
    pick('Merge pull request #7 from Vast-Menu/feat/x'),
    pick('Merge pull request #12 from Vast-Menu/fix/y'),
  ];
  assert.deepEqual(prNumbersOfPicks(picks), [7, 12]);
});

test('a picked commit that is not a PR merge contributes no number', () => {
  assert.deepEqual(prNumbersOfPicks([pick('fix: a bare commit')]), []);
});

test('picked bump PRs are excluded too', () => {
  assert.deepEqual(
    prNumbersOfPicks([pick('Merge pull request #8 from Vast-Menu/bump-prod-1.0.0')]),
    [],
  );
});

const fakePr = (number: number, over: Partial<ShippedPr> = {}): ShippedPr => ({
  number,
  title: `PR ${number}`,
  url: `https://github.com/Vast-menu/Repo/pull/${number}`,
  authorLogin: `dev${number}`,
  authorName: `Dev ${number}`,
  authorEmails: [`dev${number}@vast.com`],
  branch: `feat/${number}`,
  ...over,
});

test('looks PRs up concurrently and keeps the order asked for', async () => {
  const seen: number[] = [];
  const lookup: PrLookup = async (_repo, number) => {
    seen.push(number);
    // The slowest lookup is first, so a sequential implementation and a
    // concurrent one differ visibly in the resulting order.
    await new Promise((r) => setTimeout(r, number === 7 ? 20 : 1));
    return fakePr(number);
  };
  const prs = await shippedPrs('Repo', [7, 12], lookup);
  assert.deepEqual(prs.map((p) => p.number), [7, 12]);
  assert.deepEqual(seen, [7, 12]);
});

test('a PR that cannot be looked up is dropped, not faked', async () => {
  const lookup: PrLookup = async (_repo, number) => (number === 7 ? null : fakePr(number));
  const prs = await shippedPrs('Repo', [7, 12], lookup);
  assert.deepEqual(prs.map((p) => p.number), [12]);
});

test('no PR numbers means no lookups at all', async () => {
  let calls = 0;
  const lookup: PrLookup = async () => {
    calls += 1;
    return null;
  };
  assert.deepEqual(await shippedPrs('Repo', [], lookup), []);
  assert.equal(calls, 0);
});

const deps = (
  over: Partial<{
    token: string | null;
    lookup: (token: string, email: string) => Promise<string | null>;
    override: (login: string) => string | null;
  }> = {},
): {
  token: string | null;
  lookup: (token: string, email: string) => Promise<string | null>;
  override: (login: string) => string | null;
} => ({
  token: 'xoxb-test',
  lookup: async () => null,
  override: () => null,
  ...over,
});

test('a configured override wins over the email lookup', async () => {
  let looked = 0;
  const mentions = await resolveMentions(
    [fakePr(7, { authorLogin: 'mostafa' })],
    deps({
      override: (login) => (login === 'mostafa' ? 'U_OVERRIDE' : null),
      lookup: async () => {
        looked += 1;
        return 'U_LOOKED_UP';
      },
    }),
  );
  assert.deepEqual(mentions, { mostafa: 'U_OVERRIDE' });
  assert.equal(looked, 0, 'an override must not spend a Slack API call');
});

test('falls through to the second email when the first does not resolve', async () => {
  const tried: string[] = [];
  const mentions = await resolveMentions(
    [fakePr(7, { authorLogin: 'dev', authorEmails: ['old@old.com', 'real@vast.com'] })],
    deps({
      lookup: async (_token, email) => {
        tried.push(email);
        return email === 'real@vast.com' ? 'U_REAL' : null;
      },
    }),
  );
  assert.deepEqual(mentions, { dev: 'U_REAL' });
  assert.deepEqual(tried, ['old@old.com', 'real@vast.com']);
});

// The PR is already open by the time mentions are resolved — a Slack outage
// must cost the announcement its @-mentions, nothing more.
test('a throwing lookup resolves to no mention rather than failing', async () => {
  const mentions = await resolveMentions(
    [fakePr(7, { authorLogin: 'dev' })],
    deps({
      lookup: async () => {
        throw new Error('slack is down');
      },
    }),
  );
  assert.deepEqual(mentions, { dev: null });
});

test('without a token nobody is mentioned and nothing is looked up', async () => {
  let looked = 0;
  const mentions = await resolveMentions(
    [fakePr(7, { authorLogin: 'a' }), fakePr(12, { authorLogin: 'b' })],
    deps({
      token: null,
      override: () => 'U_OVERRIDE',
      lookup: async () => {
        looked += 1;
        return 'U_LOOKED_UP';
      },
    }),
  );
  assert.deepEqual(mentions, { a: null, b: null });
  assert.equal(looked, 0);
});

test('an author with no usable email resolves to no mention', async () => {
  const mentions = await resolveMentions(
    [fakePr(7, { authorLogin: 'dev', authorEmails: [] })],
    deps({ lookup: async () => 'U_NEVER' }),
  );
  assert.deepEqual(mentions, { dev: null });
});

test('an author appearing on several PRs is resolved once', async () => {
  let looked = 0;
  const mentions = await resolveMentions(
    [
      fakePr(7, { authorLogin: 'dev', authorEmails: ['dev@vast.com'] }),
      fakePr(12, { authorLogin: 'dev', authorEmails: ['dev@vast.com'] }),
    ],
    deps({
      lookup: async () => {
        looked += 1;
        return 'U_DEV';
      },
    }),
  );
  assert.deepEqual(mentions, { dev: 'U_DEV' });
  assert.equal(looked, 1);
});
