import { test } from 'node:test';
import assert from 'node:assert/strict';
import { doneMessage, shouldAnnounce, desktopNotify, NOTIFY_AFTER_MS } from '../src/utils/done-notify.js';
import type { DeployOutcome } from '../src/commands/deploy.js';

const live = (repo: string, version: string): DeployOutcome => ({
  repo,
  version,
  status: 'released',
  detail: `${version} live on app — https://argocd/app`,
});
const unconfirmed = (repo: string, version: string): DeployOutcome => ({
  repo,
  version,
  status: 'released',
  detail: `${version} tag committed — rollout not confirmed (no ArgoCD token; \`vast argocd login\` to confirm next time)`,
});
const failed = (repo: string): DeployOutcome => ({ repo, version: '1.0.0-rc2', status: 'failed', detail: 'build failed' });
const skipped = (repo: string): DeployOutcome => ({ repo, version: '—', status: 'skipped', detail: 'not cloned' });

// --- what it says ---

test('one repo live', () => {
  assert.deepEqual(doneMessage([live('VastPayPwa', '1.5.7-rc14')], 'staging'), {
    title: 'vast · staging',
    body: 'VastPayPwa 1.5.7-rc14 is live',
  });
});

// An unconfirmed rollout must never read as "live".
test('one repo whose rollout was not confirmed says so', () => {
  assert.deepEqual(doneMessage([unconfirmed('VastPayPwa', '1.5.7-rc14')], 'staging'), {
    title: 'vast · staging',
    body: 'VastPayPwa 1.5.7-rc14 tag committed, rollout not confirmed',
  });
});

test('one repo failed', () => {
  assert.deepEqual(doneMessage([failed('VastPayPwa')], 'staging'), {
    title: 'vast · staging — failed',
    body: 'VastPayPwa failed',
  });
});

test('a sweep counts each outcome and names the failures', () => {
  const msg = doneMessage(
    [
      live('VastPayPwa', '1.5.7-rc14'),
      unconfirmed('VastMenuPwa', '1.6.13-rc1'),
      failed('VastMenu-DashBoard'),
      skipped('VastPay-BackEnd'),
    ],
    'staging',
  );
  assert.deepEqual(msg, {
    title: 'vast · staging — 1 failed',
    body: '1 live, 1 not confirmed, 1 failed: VastMenu-DashBoard',
  });
});

test('nothing dispatched means nothing to announce', () => {
  assert.equal(doneMessage([skipped('VastPayPwa')], 'staging'), null);
});

// --- when it says it ---

test('announces a real run that took longer than a minute', () => {
  assert.equal(shouldAnnounce({ dryRun: false, elapsedMs: NOTIFY_AFTER_MS + 1, env: {} }), true);
});

test('stays quiet for a quick run, a dry run, or VAST_NOTIFY=0', () => {
  assert.equal(shouldAnnounce({ dryRun: false, elapsedMs: NOTIFY_AFTER_MS - 1, env: {} }), false);
  assert.equal(shouldAnnounce({ dryRun: true, elapsedMs: NOTIFY_AFTER_MS * 10, env: {} }), false);
  assert.equal(shouldAnnounce({ dryRun: false, elapsedMs: NOTIFY_AFTER_MS * 10, env: { VAST_NOTIFY: '0' } }), false);
});

// --- how it says it ---

// The text travels as argv, never spliced into the AppleScript, so a repo name
// or error message can never run as script.
test('macOS: osascript gets the text as arguments, not inside the script', () => {
  const calls: Array<[string, string[]]> = [];
  desktopNotify({ title: 'vast · staging', body: 'a "quoted" & odd name' }, {
    platform: 'darwin',
    run: (cmd, args) => calls.push([cmd, args]),
    has: () => true,
  });
  assert.equal(calls.length, 1);
  const [cmd, args] = calls[0];
  assert.equal(cmd, 'osascript');
  const script = args.filter((_, i) => args[i - 1] === '-e').join('\n');
  assert.ok(!script.includes('quoted'), 'the body must not appear inside the script');
  assert.deepEqual(args.slice(-2), ['vast · staging', 'a "quoted" & odd name']);
});

test('Linux: notify-send when it is installed, nothing when it is not', () => {
  const calls: Array<[string, string[]]> = [];
  const run = (cmd: string, args: string[]): void => {
    calls.push([cmd, args]);
  };
  desktopNotify({ title: 't', body: 'b' }, { platform: 'linux', run, has: () => true });
  assert.deepEqual(calls, [['notify-send', ['t', 'b']]]);
  calls.length = 0;
  desktopNotify({ title: 't', body: 'b' }, { platform: 'linux', run, has: () => false });
  assert.deepEqual(calls, []);
});

test('a notifier that throws never escapes', () => {
  assert.doesNotThrow(() =>
    desktopNotify({ title: 't', body: 'b' }, {
      platform: 'darwin',
      run: () => {
        throw new Error('osascript: not allowed');
      },
      has: () => true,
    }),
  );
});
