import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTag, nextRc, stripRc, bump } from '../src/utils/version.js';

test('parses an rc tag', () => {
  assert.deepEqual(parseTag('2.1.0-rc45'), { major: 2, minor: 1, patch: 0, rc: 45, rcWidth: 2 });
});

test('parses a finalised tag', () => {
  assert.deepEqual(parseTag('2.1.0'), { major: 2, minor: 1, patch: 0, rc: null, rcWidth: 1 });
});

test('rejects a malformed tag', () => {
  assert.throws(() => parseTag('latest'), /Unparseable version tag: "latest"/);
  assert.throws(() => parseTag(''), /Unparseable version tag/);
});

// Real tags found in these repos on 2026-08-04. Incrementing them is ambiguous
// — is the next one rc5 or rc5-health? — so refuse rather than guess.
test('refuses tags with an ad-hoc suffix, pointing at --target-version', () => {
  assert.throws(() => parseTag('1.1.3-rc4-health'), /pass --target-version explicitly/);
  assert.throws(() => parseTag('4.3.6-test'), /pass --target-version explicitly/);
});

test('increments the rc', () => {
  assert.equal(nextRc('2.1.0-rc45'), '2.1.0-rc46');
  assert.equal(nextRc('1.5.5-rc9'), '1.5.5-rc10');
});

// VastMenuPwa ships 1.6.9-rc03 and VastPay-BackEnd 4.2.15-rc04 — renumbering
// those to rc4 and rc5 would silently break their convention.
test('preserves zero padding in the rc suffix', () => {
  assert.equal(nextRc('1.6.9-rc03'), '1.6.9-rc04');
  assert.equal(nextRc('4.2.15-rc04'), '4.2.15-rc05');
});

test('padding never truncates when the number outgrows it', () => {
  assert.equal(nextRc('1.0.0-rc09'), '1.0.0-rc10');
  assert.equal(nextRc('1.0.0-rc99'), '1.0.0-rc100');
});

test('a finalised tag starts a new rc series at 1', () => {
  assert.equal(nextRc('2.1.0'), '2.1.0-rc1');
});

test('strips the rc for production', () => {
  assert.equal(stripRc('2.1.0-rc45'), '2.1.0');
  assert.equal(stripRc('2.1.0'), '2.1.0');
});

test('bumping resets the rc to 1', () => {
  assert.equal(bump('2.1.0-rc45', 'patch'), '2.1.1-rc1');
  assert.equal(bump('2.1.0-rc45', 'minor'), '2.2.0-rc1');
  assert.equal(bump('2.1.0-rc45', 'major'), '3.0.0-rc1');
});

// Selective promotions advance production's own tag — staging's version would
// claim content production did not receive.
test('nextPatch bumps a finalised tag without an rc', async () => {
  const { nextPatch } = await import('../src/utils/version.js');
  assert.equal(nextPatch('2.4.0'), '2.4.1');
  assert.equal(nextPatch('2.4.9'), '2.4.10');
  assert.equal(nextPatch('2.4.0-rc3'), '2.4.1', 'a stray rc is stripped, not preserved');
});
