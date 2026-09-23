import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { announceRelease, type AnnounceDeps } from '../src/commands/promote.js';
import { getRepo } from '../src/config/repos.js';
import { buildReleaseMessage } from '../src/utils/release-message.js';
import type { ShippedPr } from '../src/utils/shipped.js';

const repo = getRepo('VastPayPwa')!;

/** production + staging, with one real PR merge between them. */
function fixture(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'vast-announce-'));
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: 'pipe' }).trim();

  git('init', '-q', '-b', 'production');
  git('config', 'user.email', 't@e.com');
  git('config', 'user.name', 'T');
  writeFileSync(join(dir, 'f.txt'), 'base\n');
  git('add', '.');
  git('commit', '-qm', 'base');

  git('checkout', '-qb', 'staging');
  git('checkout', '-qb', 'feat/x');
  writeFileSync(join(dir, 'x.txt'), 'x\n');
  git('add', '.');
  git('commit', '-qm', 'feat: the new thing');
  git('checkout', '-q', 'staging');
  git('merge', '-q', '--no-ff', '-m', 'Merge pull request #7 from Vast-Menu/feat/x', 'feat/x');

  // announceRelease reads origin/* refs; local aliases are enough because
  // nothing here fetches.
  git('update-ref', 'refs/remotes/origin/production', 'production');
  git('update-ref', 'refs/remotes/origin/staging', 'staging');
  // The cut release branch, as it exists on a real (non-dry) run.
  git('branch', 'release/1.4.0', 'staging');

  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const shipped = (number: number): ShippedPr => ({
  number,
  title: 'The new thing',
  url: `https://github.com/Vast-menu/VastPayPwa/pull/${number}`,
  branch: 'feat/x',
  contributors: [{ name: 'Dev Eloper', login: 'dev', emails: ['dev@vast.com'] }],
});

interface Post {
  token: string;
  channel: string;
  text: string;
  blocks: unknown[] | undefined;
}

const FAKE_BLOCKS = [{ type: 'rich_text', elements: ['fake'] }];

interface Recorder {
  deps: AnnounceDeps;
  posts: Post[];
  summarized: Array<Array<{ number: number; title: string; branch: string }>>;
  output: () => string;
  restore: () => void;
}

function recorder(over: Partial<AnnounceDeps> = {}, fail?: Error): Recorder {
  const posts: Post[] = [];
  const summarized: Recorder['summarized'] = [];
  const lines: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args: unknown[]): void => void lines.push(args.join(' '));
  console.error = (...args: unknown[]): void => void lines.push(args.join(' '));

  const deps: AnnounceDeps = {
    readSlackToken: () => 'xoxb-test',
    readSlackChannel: () => '#releases',
    slackUserOverride: () => null,
    lookupUserByEmail: async () => 'U_DEV',
    postMessage: async (token, channel, text, blocks) => {
      if (fail) throw fail;
      posts.push({ token, channel, text, blocks });
      return { ts: '1.2', channel };
    },
    shippedPrs: async (_repo, numbers) => numbers.map(shipped),
    summarizePrs: async (prs) => {
      summarized.push(prs);
      return Object.fromEntries(prs.map((p) => [p.number, `summary ${p.number}`]));
    },
    buildReleaseMessage: (input) => ({
      text: [
        `MSG ${input.displayName} ${input.branch} ${input.prUrl}`,
        `prs=${input.prs.map((p) => p.number).join(',')}`,
        `summaries=${JSON.stringify(input.summaries)}`,
        `subjects=${input.fallbackSubjects.length}`,
        `mentions=${JSON.stringify(input.mentions)}`,
      ].join('\n'),
      blocks: FAKE_BLOCKS,
    }),
    ...over,
  };

  return {
    deps,
    posts,
    summarized,
    output: () => lines.join('\n'),
    restore: () => {
      console.log = originalLog;
      console.error = originalError;
    },
  };
}

async function withRecorder(
  r: Recorder,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } finally {
    r.restore();
  }
}

test('a dry run prints the message under a dry-run header and sends nothing', async () => {
  const f = fixture();
  const r = recorder();
  try {
    await withRecorder(r, async () => {
      await announceRelease(repo, f.dir, 'release', '1.4.0', null, { dryRun: true }, r.deps);
    });
    const out = r.output();
    assert.match(out, /Slack message \(dry run\)/);
    assert.match(out, /MSG Vastpay Pwa release\/1\.4\.0 /);
    // The printed line is only the mrkdwn fallback; say what Slack will draw.
    assert.match(
      out,
      /\n {2}\(Slack renders this as a bulleted list item with real mentions and ticket links\)/,
    );
    assert.equal(r.posts.length, 0, 'a dry run must not post');
  } finally {
    f.cleanup();
  }
});

// No branch exists yet on a dry run, so the range has to be the one the cut
// WOULD produce, and the PR link a placeholder.
test('a dry run reads origin/production..origin/staging and links the PR list', async () => {
  const f = fixture();
  const r = recorder();
  try {
    await withRecorder(r, async () => {
      await announceRelease(repo, f.dir, 'release', '1.4.0', null, { dryRun: true }, r.deps);
    });
    const out = r.output();
    assert.match(out, /https:\/\/github\.com\/Vast-menu\/VastPayPwa\/pulls/);
    assert.match(out, /prs=7/);
    assert.match(out, /subjects=1/);
  } finally {
    f.cleanup();
  }
});

test('a real run posts the message and says where it landed', async () => {
  const f = fixture();
  const r = recorder();
  const url = 'https://github.com/Vast-menu/VastPayPwa/pull/99';
  try {
    await withRecorder(r, async () => {
      await announceRelease(repo, f.dir, 'release', '1.4.0', url, { dryRun: false }, r.deps);
    });
    assert.equal(r.posts.length, 1);
    assert.equal(r.posts[0].channel, '#releases');
    assert.equal(r.posts[0].token, 'xoxb-test');
    assert.match(r.posts[0].text, /MSG Vastpay Pwa release\/1\.4\.0 https:\/\/github\.com\/Vast-menu\/VastPayPwa\/pull\/99/);
    // Mentions are keyed by the contributor's normalized name.
    assert.match(r.posts[0].text, /mentions=\{"developer":"U_DEV"\}/);
    assert.match(r.posts[0].text, /summaries=\{"7":"summary 7"\}/);
    assert.match(r.output(), /announced in #releases/);
  } finally {
    f.cleanup();
  }
});

// A real run reads the cut branch, not staging: staging may already have moved
// on by the time the PR is open.
test('a real run reads the range the cut branch actually carries', async () => {
  const f = fixture();
  const r = recorder();
  try {
    await withRecorder(r, async () => {
      await announceRelease(repo, f.dir, 'release', '1.4.0', 'https://x/1', { dryRun: false }, r.deps);
    });
    assert.match(r.posts[0].text, /prs=7/);
  } finally {
    f.cleanup();
  }
});

test('without a token the message is printed and the setup hint shown, nothing posted', async () => {
  const f = fixture();
  const r = recorder({ readSlackToken: () => null });
  try {
    await withRecorder(r, async () => {
      await announceRelease(repo, f.dir, 'release', '1.4.0', 'https://x/1', { dryRun: false }, r.deps);
    });
    const out = r.output();
    assert.match(out, /MSG Vastpay Pwa/);
    assert.match(out, /Slack not configured — run vast slack setup/);
    assert.equal(r.posts.length, 0);
  } finally {
    f.cleanup();
  }
});

test('without a channel the message is printed and the setup hint shown', async () => {
  const f = fixture();
  const r = recorder({ readSlackChannel: () => null });
  try {
    await withRecorder(r, async () => {
      await announceRelease(repo, f.dir, 'release', '1.4.0', 'https://x/1', { dryRun: false }, r.deps);
    });
    assert.match(r.output(), /Slack not configured — run vast slack setup/);
    assert.equal(r.posts.length, 0);
  } finally {
    f.cleanup();
  }
});

// The PR is already open by the time this runs. A Slack failure must leave the
// promotion successful and hand the operator the text to paste.
test('a failed post prints the message and the error without throwing', async () => {
  const f = fixture();
  const r = recorder({}, new Error('channel_not_found'));
  try {
    await withRecorder(r, async () => {
      await announceRelease(repo, f.dir, 'release', '1.4.0', 'https://x/1', { dryRun: false }, r.deps);
    });
    const out = r.output();
    assert.match(out, /channel_not_found/);
    assert.match(out, /MSG Vastpay Pwa/);
    assert.equal(r.posts.length, 0);
  } finally {
    f.cleanup();
  }
});

// A selective promotion ships only what was picked; the range would claim
// everything on staging.
test('a selective promotion announces only the picked PRs', async () => {
  const f = fixture();
  const r = recorder();
  try {
    await withRecorder(r, async () => {
      await announceRelease(
        repo,
        f.dir,
        'hotfix',
        '1.4.1',
        'https://x/1',
        {
          dryRun: false,
          picks: [
            {
              input: '#42',
              sha: 'b'.repeat(40),
              subject: 'Merge pull request #42 from Vast-Menu/fix/urgent',
              isMerge: true,
              timestamp: 0,
            },
          ],
        },
        r.deps,
      );
    });
    assert.match(r.posts[0].text, /prs=42/);
    assert.match(r.posts[0].text, /hotfix\/1\.4\.1/);
  } finally {
    f.cleanup();
  }
});

test('the posted call carries the blocks alongside the text', async () => {
  const f = fixture();
  const r = recorder();
  try {
    await withRecorder(r, async () => {
      await announceRelease(repo, f.dir, 'release', '1.4.0', 'https://x/1', { dryRun: false }, r.deps);
    });
    assert.equal(r.posts.length, 1);
    assert.match(r.posts[0].text, /^MSG /);
    assert.deepEqual(r.posts[0].blocks, FAKE_BLOCKS);
  } finally {
    f.cleanup();
  }
});

test('summarizePrs is handed only the number, title and branch of each PR', async () => {
  const f = fixture();
  const r = recorder();
  try {
    await withRecorder(r, async () => {
      await announceRelease(repo, f.dir, 'release', '1.4.0', 'https://x/1', { dryRun: false }, r.deps);
    });
    assert.deepEqual(r.summarized, [[{ number: 7, title: 'The new thing', branch: 'feat/x' }]]);
  } finally {
    f.cleanup();
  }
});

const pick = (number: number, branch: string) => ({
  input: `#${number}`,
  sha: String(number).padStart(40, 'a'),
  subject: `Merge pull request #${number} from Vast-Menu/${branch}`,
  isMerge: true,
  timestamp: 0,
});

/**
 * The hand-written post, end to end through the real builder: picks arrive
 * newest first, and the posted line still reads in ascending PR order with
 * each person named once and the tickets in PR order.
 */
function hotfixRecorder(): Recorder {
  const prs: Record<number, ShippedPr> = {
    42: {
      number: 42,
      title: 'fix: charge ELM once',
      url: 'https://github.com/Vast-menu/VastPayPwa/pull/42',
      branch: 'fix/VA-13091-elm-single-charge',
      contributors: [{ name: 'Mostafa Adly', login: 'MostafaAdly', emails: ['mostafa@example.com'] }],
    },
    43: {
      number: 43,
      title: 'fix: reuse the guest token',
      url: 'https://github.com/Vast-menu/VastPayPwa/pull/43',
      branch: 'fix/VA-13085-guest-token',
      contributors: [
        { name: 'Osama Elshimy', login: 'osama-elshimy1', emails: ['osama@example.com'] },
        { name: 'Mostafa Adly', login: null, emails: ['mostafa@example.com'] },
        { name: 'Mahmoud Elzahaby', login: null, emails: ['mahmoud@example.com'] },
      ],
    },
  };
  return recorder({
    shippedPrs: async (_repo, numbers) => numbers.map((n) => prs[n]),
    summarizePrs: async () => ({ 42: 'ELM single charge', 43: 'guest token reuse' }),
    lookupUserByEmail: async (_token, email) => (email === 'mostafa@example.com' ? 'U1' : null),
    buildReleaseMessage,
  });
}

test('a pick hotfix posts summaries in ascending PR order with contributors and tickets', async () => {
  const f = fixture();
  const r = hotfixRecorder();
  const url = 'https://github.com/Vast-menu/VastPayPwa/pull/99';
  try {
    await withRecorder(r, async () => {
      await announceRelease(
        repo,
        f.dir,
        'hotfix',
        '1.4.1',
        url,
        { dryRun: false, picks: [pick(43, 'fix/VA-13085-guest-token'), pick(42, 'fix/VA-13091-elm-single-charge')] },
        r.deps,
      );
    });
    assert.equal(r.posts.length, 1);
    assert.equal(
      r.posts[0].text,
      `• <${url}|Vastpay Pwa - hotfix/1.4.1> - ELM single charge, guest token reuse (<@U1>, @Osama Elshimy) ` +
        '(<https://app.clickup.com/t/90121402342/VA-13091|VA-13091>, ' +
        '<https://app.clickup.com/t/90121402342/VA-13085|VA-13085>)',
    );
    const blocks = r.posts[0].blocks as Array<{ type: string; elements: Array<{ type: string }> }>;
    assert.equal(blocks[0].type, 'rich_text');
    assert.equal(blocks[0].elements[0].type, 'rich_text_list');
  } finally {
    f.cleanup();
  }
});

// A dry run has no cut branch, so the range stand-in is all of staging. A pick
// hotfix must not borrow tickets from staging work it does not carry.
test('a dry-run pick hotfix takes no ticket from unpicked staging work', async () => {
  const f = fixture();
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'fix: unrelated VA-99999'], { cwd: f.dir });
  execFileSync('git', ['update-ref', 'refs/remotes/origin/staging', 'staging'], { cwd: f.dir });
  const r = hotfixRecorder();
  try {
    await withRecorder(r, async () => {
      await announceRelease(
        repo,
        f.dir,
        'hotfix',
        '1.4.1',
        null,
        { dryRun: true, picks: [pick(42, 'fix/VA-13091-elm-single-charge')] },
        r.deps,
      );
    });
    const out = r.output();
    assert.match(out, /VA-13091/);
    assert.doesNotMatch(out, /VA-99999/);
  } finally {
    f.cleanup();
  }
});
