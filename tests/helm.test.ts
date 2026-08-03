import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractTag } from '../src/utils/helm.js';

test('extracts a quoted tag', () => {
  assert.equal(extractTag('image:\n  repository: foo\n  tag: "2.1.0-rc45"\n'), '2.1.0-rc45');
});

test('extracts an unquoted tag', () => {
  assert.equal(extractTag('image:\n  tag: 2.1.0-rc45\n'), '2.1.0-rc45');
});

test('extracts a single-quoted tag', () => {
  assert.equal(extractTag("image:\n  tag: '1.5.5-rc12'\n"), '1.5.5-rc12');
});

test('ignores a commented-out tag', () => {
  assert.equal(extractTag('# tag: "9.9.9"\nimage:\n  tag: "2.1.0-rc45"\n'), '2.1.0-rc45');
});

test('throws when no tag is present', () => {
  assert.throws(() => extractTag('image:\n  repository: foo\n'), /No `tag:` found/);
});
