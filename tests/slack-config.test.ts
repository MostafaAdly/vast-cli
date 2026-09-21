import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// Point every config read and write at a throwaway directory BEFORE importing
// the module: a crashed test must never write a bot token into the real
// ~/.vast-cli, and must never read a developer's genuine Slack token.
const SANDBOX = mkdtempSync(join(tmpdir(), 'vast-slack-'));
process.env.VAST_CLI_HOME = SANDBOX;
delete process.env.VAST_SLACK_TOKEN;
delete process.env.VAST_SLACK_CHANNEL;

const {
  CLICKUP_WORKSPACE_ID,
  clickupTaskUrl,
  forgetSlack,
  readSlackChannel,
  readSlackConfig,
  readSlackToken,
  saveSlackConfig,
  slackFile,
  slackUserOverride,
} = await import('../src/config/slack.js');

function clean(): void {
  forgetSlack();
  delete process.env.VAST_SLACK_TOKEN;
  delete process.env.VAST_SLACK_CHANNEL;
}

/** Write the config file directly, for the cases a save would never produce. */
function writeRaw(text: string): void {
  const file = slackFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text, 'utf-8');
}

test('the slack config file lives under VAST_CLI_HOME', () => {
  assert.equal(slackFile(), join(SANDBOX, 'slack.json'));
});

test('nothing stored and no env var reads as null', () => {
  clean();
  assert.equal(readSlackToken(), null);
  assert.equal(readSlackChannel(), null);
  assert.deepEqual(readSlackConfig(), {});
});

test('saveSlackConfig writes an owner-only file and the values read back', () => {
  clean();
  saveSlackConfig({ token: 'xoxb-abc', channel: '#releases', team: 'Vast' });

  assert.equal(readSlackToken(), 'xoxb-abc');
  assert.equal(readSlackChannel(), '#releases');
  assert.equal(readSlackConfig().team, 'Vast');

  // 0600: a bot token is a credential, not a preference.
  assert.equal(statSync(slackFile()).mode & 0o777, 0o600);
  assert.ok(readSlackConfig().savedAt, 'savedAt is recorded');
  clean();
});

test('saveSlackConfig merges and keeps fields it was not given', () => {
  clean();
  saveSlackConfig({ token: 'xoxb-abc', channel: '#releases', users: { mostafa: 'U111' } });
  saveSlackConfig({ channel: '#deploys' });

  const config = readSlackConfig();
  assert.equal(config.token, 'xoxb-abc');
  assert.equal(config.channel, '#deploys');
  assert.deepEqual(config.users, { mostafa: 'U111' });
  clean();
});

test('a saved file stays owner-only when it is rewritten', () => {
  clean();
  saveSlackConfig({ token: 'xoxb-abc' });
  // writeFileSync's mode only applies on create, so the second save has to
  // force the permissions back down itself.
  saveSlackConfig({ channel: '#releases' });
  assert.equal(statSync(slackFile()).mode & 0o777, 0o600);
  clean();
});

test('the env vars beat the stored token and channel', () => {
  clean();
  saveSlackConfig({ token: 'from-file', channel: '#from-file' });
  process.env.VAST_SLACK_TOKEN = 'from-env';
  process.env.VAST_SLACK_CHANNEL = '#from-env';
  assert.equal(readSlackToken(), 'from-env');
  assert.equal(readSlackChannel(), '#from-env');
  clean();
});

test('a blank env var falls through to the stored value', () => {
  clean();
  saveSlackConfig({ token: 'from-file', channel: '#from-file' });
  process.env.VAST_SLACK_TOKEN = '   ';
  process.env.VAST_SLACK_CHANNEL = '';
  assert.equal(readSlackToken(), 'from-file');
  assert.equal(readSlackChannel(), '#from-file');
  clean();
});

test('a corrupt config file reads as empty rather than throwing', () => {
  clean();
  writeRaw('{ this is not json');
  assert.deepEqual(readSlackConfig(), {});
  assert.equal(readSlackToken(), null);
  clean();
});

test('forgetSlack removes the file and is idempotent', () => {
  clean();
  saveSlackConfig({ token: 'xoxb-abc' });
  forgetSlack();
  assert.equal(existsSync(slackFile()), false);
  forgetSlack();
  assert.equal(readSlackToken(), null);
});

test('the users map maps a GitHub login to a Slack member id', () => {
  clean();
  saveSlackConfig({ users: { MostafaAdly: 'U0MOSTAFA' } });
  assert.equal(slackUserOverride('MostafaAdly'), 'U0MOSTAFA');
  assert.equal(slackUserOverride('someone-else'), null);
  clean();
  // No file at all is the common case and must not throw.
  assert.equal(slackUserOverride('MostafaAdly'), null);
});

test('the stored token is never written anywhere but the config file', () => {
  clean();
  saveSlackConfig({ token: 'xoxb-secret' });
  const raw = readFileSync(slackFile(), 'utf-8');
  assert.match(raw, /xoxb-secret/);
  clean();
});

test('clickup task urls are built from the Vast workspace id', () => {
  assert.equal(CLICKUP_WORKSPACE_ID, '90121402342');
  assert.equal(clickupTaskUrl('VA-12755'), 'https://app.clickup.com/t/90121402342/VA-12755');
});

// CU-<id> is ClickUp's raw task id (the bugfixer's branch convention), not a
// custom id: it links as /t/<id>, lowercase, without the workspace segment.
// The workspace form with a raw id 404s.
test('a raw CU- task id links without the workspace segment', () => {
  assert.equal(clickupTaskUrl('CU-869E077ZM'), 'https://app.clickup.com/t/869e077zm');
  assert.equal(clickupTaskUrl('cu-869e077zm'), 'https://app.clickup.com/t/869e077zm');
});
