import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChangelog, parseSubject, tidy } from '../src/utils/changelog.js';

test('parses a conventional subject', () => {
  assert.deepEqual(parseSubject('feat(orders): add branch filter'), {
    type: 'feat',
    scope: 'orders',
    text: 'add branch filter',
  });
});

test('parses a subject with no scope', () => {
  assert.deepEqual(parseSubject('fix: correct totals'), {
    type: 'fix',
    scope: null,
    text: 'correct totals',
  });
});

test('handles a breaking-change marker', () => {
  assert.equal(parseSubject('feat!: drop v1 API').type, 'feat');
});

test('falls back gracefully on a non-conventional subject', () => {
  assert.deepEqual(parseSubject('Updated the readme'), {
    type: null,
    scope: null,
    text: 'Updated the readme',
  });
});

test('tidy sentence-cases without mangling identifiers', () => {
  assert.equal(tidy('add branch filter'), 'Add branch filter');
  assert.equal(tidy('iOS build fix'), 'iOS build fix');
  assert.equal(tidy('  spaced   out.  '), 'Spaced out');
});

test('groups subjects into sections', () => {
  const out = buildChangelog([
    'feat: add branch filter',
    'fix: correct totals',
    'chore: bump eslint',
    'refactor: simplify guard',
  ]);
  assert.match(out, /### Features\n- Add branch filter/);
  assert.match(out, /### Fixes\n- Correct totals/);
  assert.match(out, /### Improvements\n- Simplify guard/);
  assert.match(out, /### Maintenance\n- Bump eslint/);
});

test('sections appear in a stable order', () => {
  const out = buildChangelog(['chore: c', 'fix: b', 'feat: a']);
  assert.ok(out.indexOf('Features') < out.indexOf('Fixes'));
  assert.ok(out.indexOf('Fixes') < out.indexOf('Maintenance'));
});

test('unrecognised types fall into Other changes', () => {
  assert.match(buildChangelog(['Updated the readme']), /### Other changes\n- Updated the readme/);
});

test('scope is kept as a prefix on the bullet', () => {
  assert.match(buildChangelog(['feat(orders): add filter']), /- Orders: add filter/);
});

// Deploy bookkeeping describes the pipeline, not the product.
test('drops version-bump and merge noise', () => {
  const out = buildChangelog([
    'chore: bump version to 2.1.5-rc6 in stage environment',
    'chore: align package.json version with staging (2.1.5-rc6)',
    'Merge pull request #796 from Vast-Menu/bump-stage',
    'Merge branch develop into staging',
    'feat: a real change',
  ]);
  assert.doesNotMatch(out, /bump version/);
  assert.doesNotMatch(out, /align package\.json/);
  assert.doesNotMatch(out, /Merge /);
  assert.match(out, /- A real change/);
});

test('returns empty when everything was noise', () => {
  assert.equal(buildChangelog(['chore: bump version to 1.0.0 in stage environment']), '');
});

test('deduplicates identical subjects', () => {
  const out = buildChangelog(['fix: same thing', 'fix: same thing']);
  assert.equal(out.match(/- Same thing/g)?.length, 1);
});

test('caps long sections and reports the remainder', () => {
  const many = Array.from({ length: 20 }, (_, i) => `feat: change number ${i}`);
  const out = buildChangelog(many);
  assert.equal(out.match(/^- /gm)?.length, 16, 'expected 15 bullets plus the overflow line');
  assert.match(out, /_…and 5 more_/);
});

// The body is read by the whole team; it must not advertise the tool.
// Matched on word boundaries — a plain includes('AI') would fail on the
// "Maintenance" heading, and includes('vast') on any repo name.
test('carries no tool instructions or provenance', () => {
  const out = buildChangelog([
    'feat: a feature',
    'fix: a fix',
    'chore: maintenance work with detail remaining',
  ]);
  for (const banned of ['vast', 'vast-cli', 'Claude', 'AI', 'Generated with', 'Co-Authored']) {
    const pattern = new RegExp(`\\b${banned.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}\\b`, 'i');
    assert.ok(!pattern.test(out), `changelog leaked "${banned}" in:\n${out}`);
  }
  // Guard the guard: the Maintenance heading must be present, so this test
  // would actually catch a naive substring check regressing back in.
  assert.match(out, /### Maintenance/);
});
