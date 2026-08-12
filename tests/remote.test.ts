import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRemote, canonicalRepoName } from '../src/utils/remote.js';

// These are the exact forms found on the real machine: lowercase HTTPS, no .git
test('parses the HTTPS form actually in use', () => {
  assert.deepEqual(parseRemote('https://github.com/vast-menu/vastpaypwa'), {
    owner: 'vast-menu',
    name: 'vastpaypwa',
  });
});

test('parses HTTPS with a .git suffix', () => {
  assert.deepEqual(parseRemote('https://github.com/Vast-menu/VastPayPwa.git'), {
    owner: 'Vast-menu',
    name: 'VastPayPwa',
  });
});

test('parses the scp-like SSH form', () => {
  assert.deepEqual(parseRemote('git@github.com:Vast-menu/VastPayPwa.git'), {
    owner: 'Vast-menu',
    name: 'VastPayPwa',
  });
});

test('parses the ssh:// form', () => {
  assert.deepEqual(parseRemote('ssh://git@github.com/Vast-menu/VastPayPwa.git'), {
    owner: 'Vast-menu',
    name: 'VastPayPwa',
  });
});

test('tolerates a trailing slash and surrounding whitespace', () => {
  assert.deepEqual(parseRemote('  https://github.com/vast-menu/vast-finance/  '), {
    owner: 'vast-menu',
    name: 'vast-finance',
  });
});

test('returns null for something that is not a repo URL', () => {
  assert.equal(parseRemote(''), null);
  assert.equal(parseRemote('not a url'), null);
  assert.equal(parseRemote('https://github.com/'), null);
});

// Case-insensitivity is mandatory, not a nicety: every real origin is lowercase
// while the canonical names are mixed case.
test('maps a lowercase remote to the canonical name', () => {
  assert.equal(canonicalRepoName('https://github.com/vast-menu/vastpaypwa'), 'VastPayPwa');
  assert.equal(canonicalRepoName('https://github.com/vast-menu/vastmenu-backend'), 'VastMenu-BackEnd');
  assert.equal(canonicalRepoName('https://github.com/vast-menu/vastmenupwav2'), 'VastMenuPwaV2');
});

test('ignores repos from another org', () => {
  assert.equal(canonicalRepoName('https://github.com/someone-else/vastpaypwa'), null);
});

test('ignores a repo this CLI does not know', () => {
  assert.equal(canonicalRepoName('https://github.com/vast-menu/some-other-repo'), null);
});
