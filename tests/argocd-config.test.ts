import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// Point every config read and write at a throwaway directory BEFORE importing
// the module: a crashed test must never write a token into the real
// ~/.vast-cli, and must never read a developer's genuine session token.
const SANDBOX = mkdtempSync(join(tmpdir(), 'vast-argocd-'));
process.env.VAST_CLI_HOME = SANDBOX;
delete process.env.VAST_ARGOCD_TOKEN_STAGING;
delete process.env.VAST_ARGOCD_TOKEN_PRODUCTION;

const {
  DEFAULT_ARGOCD_HOSTS,
  argocdFile,
  argocdHost,
  readArgocdToken,
  saveArgocdToken,
  forgetArgocdToken,
  argocdAppUrl,
} = await import('../src/config/argocd.js');

function clean(): void {
  forgetArgocdToken('staging');
  forgetArgocdToken('production');
  delete process.env.VAST_ARGOCD_TOKEN_STAGING;
  delete process.env.VAST_ARGOCD_TOKEN_PRODUCTION;
}

test('the token file lives under VAST_CLI_HOME, one per env', () => {
  assert.equal(argocdFile('staging'), join(SANDBOX, 'argocd', 'staging.json'));
  assert.equal(argocdFile('production'), join(SANDBOX, 'argocd', 'production.json'));
});

test('hosts default to the known ArgoCD servers', () => {
  clean();
  assert.equal(DEFAULT_ARGOCD_HOSTS.staging, 'https://argocd-stg.vastmenu.com');
  assert.equal(DEFAULT_ARGOCD_HOSTS.production, 'https://argocd-prod.vastmenu.com');
  assert.equal(argocdHost('staging'), DEFAULT_ARGOCD_HOSTS.staging);
  assert.equal(argocdHost('production'), DEFAULT_ARGOCD_HOSTS.production);
});

test('a host in the env file overrides the default', () => {
  clean();
  const file = argocdFile('staging');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ host: 'http://127.0.0.1:9999' }), 'utf-8');
  assert.equal(argocdHost('staging'), 'http://127.0.0.1:9999');
  assert.equal(argocdHost('production'), DEFAULT_ARGOCD_HOSTS.production);
  clean();
});

test('no token stored and no env var reads as null', () => {
  clean();
  assert.equal(readArgocdToken('staging'), null);
});

test('saveArgocdToken writes an owner-only file and readArgocdToken returns it', () => {
  clean();
  saveArgocdToken('staging', 'tok-abc', 'mostafa');
  assert.equal(readArgocdToken('staging'), 'tok-abc');

  const file = argocdFile('staging');
  // 0600: a session token is a credential, not a config value.
  assert.equal(statSync(file).mode & 0o777, 0o600);

  const stored = JSON.parse(readFileSync(file, 'utf-8'));
  assert.equal(stored.token, 'tok-abc');
  assert.equal(stored.username, 'mostafa');
  assert.ok(stored.savedAt, 'savedAt is recorded');
  clean();
});

test('saving a token keeps a host override already in the file', () => {
  clean();
  const file = argocdFile('staging');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ host: 'http://127.0.0.1:9999' }), 'utf-8');
  saveArgocdToken('staging', 'tok-abc', 'mostafa');
  assert.equal(argocdHost('staging'), 'http://127.0.0.1:9999');
  assert.equal(readArgocdToken('staging'), 'tok-abc');
  clean();
});

test('the env var beats the stored token', () => {
  clean();
  saveArgocdToken('staging', 'from-file', 'mostafa');
  process.env.VAST_ARGOCD_TOKEN_STAGING = 'from-env';
  assert.equal(readArgocdToken('staging'), 'from-env');
  assert.equal(readArgocdToken('production'), null);
  clean();
});

test('an empty env var falls through to the stored token', () => {
  clean();
  saveArgocdToken('staging', 'from-file', 'mostafa');
  process.env.VAST_ARGOCD_TOKEN_STAGING = '   ';
  assert.equal(readArgocdToken('staging'), 'from-file');
  clean();
});

test('the two envs keep separate tokens', () => {
  clean();
  saveArgocdToken('staging', 'stg-tok', 'mostafa');
  assert.equal(readArgocdToken('production'), null);
  saveArgocdToken('production', 'prod-tok', 'mostafa');
  assert.equal(readArgocdToken('staging'), 'stg-tok');
  assert.equal(readArgocdToken('production'), 'prod-tok');
  clean();
});

test('forgetArgocdToken removes the file and is idempotent', () => {
  clean();
  saveArgocdToken('staging', 'tok-abc', 'mostafa');
  forgetArgocdToken('staging');
  assert.equal(existsSync(argocdFile('staging')), false);
  forgetArgocdToken('staging');
  assert.equal(readArgocdToken('staging'), null);
});

test('a corrupt token file does not brick every command', () => {
  clean();
  const file = argocdFile('staging');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, '{ not json', 'utf-8');
  assert.equal(readArgocdToken('staging'), null);
  assert.equal(argocdHost('staging'), DEFAULT_ARGOCD_HOSTS.staging);
  clean();
});

test('argocdAppUrl points at the env host', () => {
  clean();
  assert.equal(
    argocdAppUrl('staging', 'vastpay-dasaboard'),
    'https://argocd-stg.vastmenu.com/applications/vastpay-dasaboard',
  );
});

process.on('exit', () => rmSync(SANDBOX, { recursive: true, force: true }));
