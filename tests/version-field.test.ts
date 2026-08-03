import { test } from 'node:test';
import assert from 'node:assert/strict';
import { __testing } from '../src/utils/release-branch.js';

const { readVersionField, setVersionField } = __testing;

const PKG = `{
  "name": "vastpay-dashboard",
  "version": "2.2.2",
  "private": true,
  "scripts": {
    "build": "vite build"
  }
}
`;

test('reads the version field', () => {
  assert.equal(readVersionField(PKG), '2.2.2');
});

test('returns null when there is no version field', () => {
  assert.equal(readVersionField('{"name":"x"}'), null);
});

test('replaces only the version value', () => {
  const out = setVersionField(PKG, '2.2.3-rc1');
  assert.equal(readVersionField(out), '2.2.3-rc1');
  assert.ok(out.includes('"name": "vastpay-dashboard"'), 'name must survive');
  assert.ok(out.includes('"build": "vite build"'), 'scripts must survive');
});

// The whole point of a targeted replace rather than JSON.parse/stringify:
// reformatting a committed file would produce a huge, unreviewable diff.
test('preserves formatting exactly apart from the version', () => {
  const out = setVersionField(PKG, '9.9.9');
  assert.equal(out, PKG.replace('"version": "2.2.2"', '"version": "9.9.9"'));
});

test('replaces only the first version field, not nested ones', () => {
  const nested = '{\n  "version": "1.0.0",\n  "dependencies": { "version": "3.3.3" }\n}';
  const out = setVersionField(nested, '2.0.0');
  assert.ok(out.includes('"version": "2.0.0"'));
  assert.ok(out.includes('"version": "3.3.3"'), 'nested dependency pin must survive');
});
