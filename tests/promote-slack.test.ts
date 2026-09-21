import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { announceRelease, type AnnounceDeps } from '../src/commands/promote.js';
import { getRepo } from '../src/config/repos.js';
import type { ShippedPr } from '../src/utils/release-message.js';

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
  authorLogin: 'dev',
  authorName: 'Dev Eloper',
  authorEmails: ['dev@vast.com'],
  branch: 'feat/x',
});

interface Recorder {
  deps: AnnounceDeps;
  posts: Array<{ token: string; channel: string; text: string }>;
  output: () => string;
  restore: () => void;
}

function recorder(over: Partial<AnnounceDeps> = {}, fail?: Error): Recorder {
  const posts: Array<{ token: string; channel: string; text: string }> = [];
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
    postMessage: async (token, channel, text) => {
      if (fail) throw fail;
      posts.push({ token, channel, text });
      return { ts: '1.2', channel };
    },
    shippedPrs: async (_repo, numbers) => numbers.map(shipped),
    buildReleaseMessage: (input) =>
      [
        `MSG ${input.displayName} ${input.branch} ${input.prUrl}`,
        `prs=${input.prs.map((p) => p.number).join(',')}`,
        `subjects=${input.fallbackSubjects.length}`,
        `mentions=${JSON.stringify(input.mentions)}`,
      ].join('\n'),
    ...over,
  };

  return {
    deps,
    posts,
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
    assert.match(r.posts[0].text, /mentions=\{"dev":"U_DEV"\}/);
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
