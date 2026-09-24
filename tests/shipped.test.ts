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
  parseGhPrView,
  parseGhPrGraphql,
  buildPrQuery,
  prQueryArgs,
  type PrLookup,
  type ShippedPr,
} from '../src/utils/shipped.js';
import type { ResolvedPick } from '../src/utils/picks.js';
import type { Contributor } from '../src/utils/contributors.js';

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

/**
 * A hotfix built with `--pick` carries each PR as a cherry-pick of its merge
 * commit: an ordinary one-parent commit whose subject still reads "Merge pull
 * request #328 from …". Built for real — a `git merge --no-ff` on staging,
 * then `git cherry-pick -m 1` of it onto a branch cut from production — so the
 * test fails against anything that only reads `--merges`.
 */
function cherryPickFixture(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'vast-shipped-pick-'));
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: 'pipe' }).trim();

  git('init', '-q', '-b', 'production');
  git('config', 'user.email', 't@e.com');
  git('config', 'user.name', 'T');
  writeFileSync(join(dir, 'f.txt'), 'base\n');
  git('add', '.');
  git('commit', '-qm', 'base');

  git('checkout', '-qb', 'staging');
  const merge = (branch: string, file: string, subject: string): string => {
    git('checkout', '-qb', branch);
    writeFileSync(join(dir, file), `${file}\n`);
    git('add', '.');
    git('commit', '-qm', `fix: ${file}`);
    git('checkout', '-q', 'staging');
    git('merge', '-q', '--no-ff', '-m', subject, branch);
    return git('rev-parse', 'HEAD');
  };
  const pr328 = merge('fix/cancelled', 'c.txt', 'Merge pull request #328 from Vast-Menu/fix/cancelled');
  const bump = merge('bump', 'b.txt', 'Merge pull request #329 from Vast-Menu/bump-prod-1.5.7');
  const pr321 = merge('feat/dialog', 'd.txt', 'Merge pull request #321 from Vast-Menu/feat/dialog');

  git('checkout', '-q', 'production');
  git('checkout', '-qb', 'hotfix/1.5.7');
  // Picked newest first, so the ascending order below is the code's doing.
  for (const sha of [pr321, bump, pr328]) git('cherry-pick', '-m', '1', sha);

  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('reads PR numbers off cherry-picked merge commits, which are not merges', () => {
  const f = cherryPickFixture();
  try {
    const git = (...args: string[]): string =>
      execFileSync('git', args, { cwd: f.dir, encoding: 'utf-8', stdio: 'pipe' }).trim();
    // The premise of the bug: git sees no merges at all on the hotfix branch.
    assert.equal(git('log', 'production..hotfix/1.5.7', '--merges', '--oneline'), '');
    assert.deepEqual(prNumbersInRange(f.dir, 'production', 'hotfix/1.5.7'), [321, 328]);
  } finally {
    f.cleanup();
  }
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

const osama = (over: Partial<Contributor> = {}): Contributor => ({
  name: 'Osama Elshimy',
  login: 'osama-elshimy1',
  emails: ['o.elshemey@e.vastgroupsa.com'],
  ...over,
});

const fakePr = (number: number, over: Partial<ShippedPr> = {}): ShippedPr => ({
  number,
  title: `PR ${number}`,
  url: `https://github.com/Vast-menu/Repo/pull/${number}`,
  branch: `feat/${number}`,
  contributors: [{ name: `Dev ${number}`, login: `dev${number}`, emails: [`dev${number}@vast.com`] }],
  ...over,
});

test('looks PRs up concurrently and keeps the order asked for', async () => {
  const seen: number[] = [];
  const lookup: PrLookup = async (_repo, number) => {
    seen.push(number);
    // The slowest lookup is first, so a sequential implementation and a
    // concurrent one differ visibly in the resulting order.
    await new Promise((r) => setTimeout(r, number === 7 ? 20 : 1));
    const { number: _n, ...rest } = fakePr(number);
    return rest;
  };
  const prs = await shippedPrs('Repo', [7, 12], lookup);
  assert.deepEqual(prs.map((p) => p.number), [7, 12]);
  assert.deepEqual(seen, [7, 12]);
  assert.equal(prs[0].contributors[0].login, 'dev7');
});

test('a PR that cannot be looked up is dropped, not faked', async () => {
  const lookup: PrLookup = async (_repo, number) => {
    if (number === 7) return null;
    const { number: _n, ...rest } = fakePr(number);
    return rest;
  };
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

/** The shape `gh pr view --json number,title,url,author,headRefName,commits` returns. */
const ghCommit = (authors: Array<{ name: string; email: string; login: string }>) => ({
  oid: 'a'.repeat(40),
  messageHeadline: 'fix: something',
  authors: authors.map((a) => ({ id: '', ...a })),
});

const realView = {
  number: 328,
  title: 'fix: detect cancelled orders by backend code',
  url: 'https://github.com/Vast-Menu/VastPayPwa/pull/328',
  author: { id: 'U_1', is_bot: false, login: 'osama-elshimy1', name: '' },
  headRefName: 'fix/VA-12755-cancelled-orders',
  commits: [
    ghCommit([{ name: 'Osama Elshimy', email: 'o.elshemey@e.vastgroupsa.com', login: '' }]),
    ghCommit([{ name: 'Osama Elshimy', email: 'o.elshemey@e.vastgroupsa.com', login: '' }]),
    ghCommit([{ name: 'MahmoudElzahabi', email: 'm.elzahaby@vastgroupsa.com', login: '' }]),
    ghCommit([{ name: 'Sara Ali', email: '12345+sara@users.noreply.github.com', login: '' }]),
    ghCommit([{ name: 'Sara Ali', email: 'sara@vastgroupsa.com', login: 'sara-ali' }]),
  ],
};

test('parses a real gh pr view: an unnamed PR author takes the name of their commits', () => {
  const pr = parseGhPrView(JSON.stringify(realView));
  assert.deepEqual(pr, {
    title: 'fix: detect cancelled orders by backend code',
    url: 'https://github.com/Vast-Menu/VastPayPwa/pull/328',
    branch: 'fix/VA-12755-cancelled-orders',
    contributors: [
      { name: 'Osama Elshimy', login: 'osama-elshimy1', emails: ['o.elshemey@e.vastgroupsa.com'] },
      // Commit co-workers follow the PR author; the noreply address is gone,
      // and the excluded person never appears.
      { name: 'Sara Ali', login: 'sara-ali', emails: ['sara@vastgroupsa.com'] },
    ],
  });
});

test('a named PR author keeps their GitHub name', () => {
  const view = { ...realView, author: { login: 'osama-elshimy1', name: 'Osama E.' } };
  const pr = parseGhPrView(JSON.stringify(view));
  assert.equal(pr?.contributors[0].name, 'Osama E.');
  assert.equal(pr?.contributors[0].login, 'osama-elshimy1');
});

test('a PR author with no name and no commits is named by their login', () => {
  const view = { ...realView, commits: [] };
  assert.deepEqual(parseGhPrView(JSON.stringify(view))?.contributors, [
    { name: 'osama-elshimy1', login: 'osama-elshimy1', emails: [] },
  ]);
});

test('an excluded PR author is dropped but their co-workers are kept', () => {
  const view = {
    ...realView,
    author: { login: 'mahmoudelzahaby', name: '' },
    commits: [
      ghCommit([{ name: 'MahmoudElzahaby', email: 'm@vastgroupsa.com', login: '' }]),
      ghCommit([{ name: 'MahmoudElzahaby', email: 'm@vastgroupsa.com', login: '' }]),
      ghCommit([{ name: 'Osama Elshimy', email: 'o.elshemey@e.vastgroupsa.com', login: '' }]),
    ],
  };
  assert.deepEqual(parseGhPrView(JSON.stringify(view))?.contributors, [
    { name: 'Osama Elshimy', login: null, emails: ['o.elshemey@e.vastgroupsa.com'] },
  ]);
});

// Someone who merely opened a PR of another person's commits must not be
// renamed after them.
test('the PR author is not given the name of a commit author with a different login', () => {
  const view = {
    ...realView,
    author: { login: 'osama-elshimy1', name: '' },
    commits: [ghCommit([{ name: 'Sara Ali', email: 'sara@vastgroupsa.com', login: 'sara-ali' }])],
  };
  assert.deepEqual(parseGhPrView(JSON.stringify(view))?.contributors, [
    { name: 'osama-elshimy1', login: 'osama-elshimy1', emails: [] },
    { name: 'Sara Ali', login: 'sara-ali', emails: ['sara@vastgroupsa.com'] },
  ]);
});

test('bot PR authors and bot commits are dropped', () => {
  const view = {
    ...realView,
    author: { login: 'app/github-actions', name: '' },
    commits: [ghCommit([{ name: 'github-actions[bot]', email: '41898282+github-actions[bot]@users.noreply.github.com', login: 'github-actions[bot]' }])],
  };
  assert.deepEqual(parseGhPrView(JSON.stringify(view))?.contributors, []);
});

test('unparseable gh output is null, not a throw', () => {
  assert.equal(parseGhPrView('not json'), null);
  assert.equal(parseGhPrView(''), null);
});

type MentionDeps = Parameters<typeof resolveMentions>[1];

const deps = (over: Partial<MentionDeps> = {}): MentionDeps => ({
  token: 'xoxb-test',
  lookup: async () => null,
  override: () => null,
  ...over,
});

test('mentions are keyed by contributor key', async () => {
  const mentions = await resolveMentions(
    [osama()],
    deps({ lookup: async (_t, email) => (email === 'o.elshemey@e.vastgroupsa.com' ? 'U_OSAMA' : null) }),
  );
  assert.deepEqual(mentions, { osamaelshimy: 'U_OSAMA' });
});

test('a login override wins over the email lookup', async () => {
  let looked = 0;
  const mentions = await resolveMentions(
    [osama()],
    deps({
      override: (key) => (key === 'osama-elshimy1' ? 'U_OVERRIDE' : null),
      lookup: async () => {
        looked += 1;
        return 'U_LOOKED_UP';
      },
    }),
  );
  assert.deepEqual(mentions, { osamaelshimy: 'U_OVERRIDE' });
  assert.equal(looked, 0, 'an override must not spend a Slack API call');
});

// Commit-only contributors have no login, so the name key is the only handle
// an override can be configured against.
test('a contributor without a login can be overridden by their key', async () => {
  const tried: string[] = [];
  const mentions = await resolveMentions(
    [osama({ login: null })],
    deps({
      override: (key) => {
        tried.push(key);
        return key === 'osamaelshimy' ? 'U_BY_KEY' : null;
      },
    }),
  );
  assert.deepEqual(mentions, { osamaelshimy: 'U_BY_KEY' });
  assert.deepEqual(tried, ['osamaelshimy']);
});

test('the login override is tried before the key override', async () => {
  const tried: string[] = [];
  await resolveMentions(
    [osama()],
    deps({
      override: (key) => {
        tried.push(key);
        return null;
      },
    }),
  );
  assert.deepEqual(tried, ['osama-elshimy1', 'osamaelshimy']);
});

test('falls through to the second email when the first does not resolve', async () => {
  const tried: string[] = [];
  const mentions = await resolveMentions(
    [osama({ emails: ['old@old.com', 'real@vast.com'] })],
    deps({
      lookup: async (_token, email) => {
        tried.push(email);
        return email === 'real@vast.com' ? 'U_REAL' : null;
      },
    }),
  );
  assert.deepEqual(mentions, { osamaelshimy: 'U_REAL' });
  assert.deepEqual(tried, ['old@old.com', 'real@vast.com']);
});

// The PR is already open by the time mentions are resolved — a Slack outage
// must cost the announcement its @-mentions, nothing more.
test('a throwing lookup or override resolves to no mention rather than failing', async () => {
  const mentions = await resolveMentions(
    [osama(), { name: 'Sara Ali', login: null, emails: ['sara@vast.com'] }],
    deps({
      override: (key) => {
        if (key === 'saraali') throw new Error('bad config');
        return null;
      },
      lookup: async () => {
        throw new Error('slack is down');
      },
    }),
  );
  assert.deepEqual(mentions, { osamaelshimy: null, saraali: null });
});

test('without a token nobody is mentioned and nothing is looked up', async () => {
  let looked = 0;
  const mentions = await resolveMentions(
    [osama(), { name: 'Sara Ali', login: null, emails: ['sara@vast.com'] }],
    deps({
      token: null,
      override: () => 'U_OVERRIDE',
      lookup: async () => {
        looked += 1;
        return 'U_LOOKED_UP';
      },
    }),
  );
  assert.deepEqual(mentions, { osamaelshimy: null, saraali: null });
  assert.equal(looked, 0);
});

test('a contributor with no usable email resolves to no mention', async () => {
  const mentions = await resolveMentions(
    [osama({ emails: [] })],
    deps({ lookup: async () => 'U_NEVER' }),
  );
  assert.deepEqual(mentions, { osamaelshimy: null });
});

test('a contributor appearing on several PRs is resolved once, with every email pooled', async () => {
  const tried: string[] = [];
  const mentions = await resolveMentions(
    [osama({ login: null, emails: ['a@vast.com'] }), osama({ emails: ['b@vast.com'] })],
    deps({
      lookup: async (_t, email) => {
        tried.push(email);
        return email === 'b@vast.com' ? 'U_OSAMA' : null;
      },
    }),
  );
  assert.deepEqual(mentions, { osamaelshimy: 'U_OSAMA' });
  assert.deepEqual(tried, ['a@vast.com', 'b@vast.com']);
});

test('excluded contributors are never looked up', async () => {
  let looked = 0;
  const mentions = await resolveMentions(
    [{ name: 'Mahmoud Elzahaby', login: 'mahmoudelzahaby', emails: ['m@vast.com'] }],
    deps({
      lookup: async () => {
        looked += 1;
        return 'U_M';
      },
    }),
  );
  assert.deepEqual(mentions, {});
  assert.equal(looked, 0);
});

/** `realView` as `gh api graphql` returns it for `buildPrQuery`. */
const graphqlOf = (view: typeof realView, typename = 'User') => ({
  title: view.title,
  url: view.url,
  headRefName: view.headRefName,
  author: { __typename: typename, login: view.author.login, ...(typename === 'User' ? { name: view.author.name || null } : {}) },
  commits: {
    nodes: view.commits.map((c) => ({
      commit: {
        authors: { nodes: c.authors.map((a) => ({ name: a.name, email: a.email, user: a.login ? { login: a.login } : null })) },
      },
    })),
  },
});

test('a batched GraphQL lookup yields exactly what gh pr view does', () => {
  const variants = [
    realView,
    { ...realView, author: { ...realView.author, name: 'Osama E.' } },
    { ...realView, commits: [] },
    {
      ...realView,
      author: { ...realView.author, login: 'mahmoudelzahaby' },
      commits: [
        ghCommit([{ name: 'MahmoudElzahaby', email: 'm@vastgroupsa.com', login: '' }]),
        ghCommit([{ name: 'Osama Elshimy', email: 'o.elshemey@e.vastgroupsa.com', login: '' }]),
      ],
    },
  ];
  const body = { data: { repository: Object.fromEntries(variants.map((v, i) => [`pr${i + 1}`, graphqlOf(v)])) } };
  const got = parseGhPrGraphql(JSON.stringify(body));
  variants.forEach((v, i) => assert.deepEqual(got.get(i + 1), parseGhPrView(JSON.stringify(v)), `variant ${i + 1}`));
});

test('a GraphQL app author is a bot, as gh pr view reports it', () => {
  const view = { ...realView, author: { ...realView.author, login: 'github-actions' }, commits: [] };
  const got = parseGhPrGraphql(JSON.stringify({ data: { repository: { pr9: graphqlOf(view, 'Bot') } } }));
  assert.deepEqual(got.get(9)?.contributors, []);
});

test('a PR GitHub cannot resolve is absent; the rest of its batch is kept', () => {
  const body = { data: { repository: { pr1: graphqlOf(realView), pr2: null } }, errors: [{ type: 'NOT_FOUND' }] };
  const got = parseGhPrGraphql(JSON.stringify(body));
  assert.deepEqual([...got.keys()], [1]);
  assert.equal(parseGhPrGraphql('not json').size, 0);
});

test('the batch query aliases each PR by number', () => {
  const q = buildPrQuery([7, 12]);
  assert.match(q, /pr7: pullRequest\(number: 7\)/);
  assert.match(q, /pr12: pullRequest\(number: 12\)/);
  assert.match(q, /repository\(owner: \$owner, name: \$name\)/);
});

// `-F` would type a variable: a repo or owner named "123", "true" or "@x" would
// reach GitHub as a number, a boolean or a file's contents instead of a name.
test('the GraphQL call passes owner and repo name as strings', () => {
  const args = prQueryArgs('123', [7]);
  assert.deepEqual(args.slice(0, 2), ['api', 'graphql']);
  assert.ok(args.includes('owner=Vast-menu') && args[args.indexOf('owner=Vast-menu') - 1] === '-f', args.join(' '));
  assert.equal(args[args.indexOf('name=123') - 1], '-f');
  assert.equal(args.includes('-F'), false);
  assert.equal(args[args.indexOf(`query=${buildPrQuery([7])}`) - 1], '-f');
});

// Live, VastPayPwaV2 #306: GitHub lists the Co-Authored-By trailer as a commit
// author ("Claude Opus 5", noreply@anthropic.com, login "claude"). The email
// must be seen before the no-reply filter throws it away.
test('an AI co-author from a commit trailer is not a contributor, via view or GraphQL', () => {
  const view = {
    ...realView,
    author: { id: 'U_2', is_bot: false, login: 'MostafaAdly', name: '' },
    commits: [
      ghCommit([
        { name: 'MostafaAdly', email: 'adly@e.vastgroupsa.com', login: 'MostafaAdly' },
        { name: 'Claude Opus 5', email: 'noreply@anthropic.com', login: 'claude' },
      ]),
    ],
  };
  const names = (c: { name: string }[] | undefined) => (c ?? []).map((p) => p.name);
  assert.deepEqual(names(parseGhPrView(JSON.stringify(view))?.contributors), ['MostafaAdly']);
  const body = { data: { repository: { pr306: graphqlOf(view) } } };
  assert.deepEqual(names(parseGhPrGraphql(JSON.stringify(body)).get(306)?.contributors), ['MostafaAdly']);
});
