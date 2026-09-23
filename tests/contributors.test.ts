import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXCLUDED_CONTRIBUTORS,
  normalizeName,
  contributorKey,
  isExcludedContributor,
  mergeContributors,
  type Contributor,
} from '../src/utils/contributors.js';

const person = (name: string, login: string | null = null, emails: string[] = []): Contributor => ({
  name,
  login,
  emails,
});

test('normalizeName lowercases and keeps only letters and digits', () => {
  assert.equal(normalizeName('Osama Elshimy'), 'osamaelshimy');
  assert.equal(normalizeName('osama-elshimy1'), 'osamaelshimy1');
  assert.equal(normalizeName('  Mahmoud_El.Zahaby! '), 'mahmoudelzahaby');
  assert.equal(normalizeName(''), '');
});

test('the key is the normalized name, falling back to the login', () => {
  assert.equal(contributorKey(person('Osama Elshimy', 'osama-elshimy1')), 'osamaelshimy');
  assert.equal(contributorKey(person('', 'osama-elshimy1')), 'osamaelshimy1');
  assert.equal(contributorKey(person('', null)), '');
});

test('the excluded list holds normalized keys', () => {
  for (const key of ['mahmoudelzahaby', 'mahmoudelzahabi', 'alielhabal', 'youssifelzahaby']) {
    assert.ok(EXCLUDED_CONTRIBUTORS.includes(key), key);
    assert.equal(normalizeName(key), key);
  }
});

test('excluded people are recognised by any spelling of their name', () => {
  assert.ok(isExcludedContributor(person('Mahmoud Elzahaby')));
  assert.ok(isExcludedContributor(person('MahmoudElzahaby')));
  assert.ok(isExcludedContributor(person('MahmoudElzahabi')));
  assert.ok(isExcludedContributor(person('Ali Elhabal')));
  assert.ok(isExcludedContributor(person('Youssif Elzahaby')));
});

test('excluded people are recognised by login even under another display name', () => {
  assert.ok(isExcludedContributor(person('Mahmoud', 'mahmoudelzahaby')));
  assert.ok(isExcludedContributor(person('', 'mahmoudelzahaby')));
});

test('bots are excluded', () => {
  assert.ok(isExcludedContributor(person('', 'dependabot[bot]')));
  assert.ok(isExcludedContributor(person('', 'renovate[bot]')));
  assert.ok(isExcludedContributor(person('github-actions', null)));
  assert.ok(isExcludedContributor(person('github-actions[bot]', null)));
  assert.ok(isExcludedContributor(person('', 'github-actions')));
  assert.ok(isExcludedContributor(person('dependabot', null)));
  // gh reports GitHub App authors of a PR as `app/<name>`.
  assert.ok(isExcludedContributor(person('', 'app/github-actions')));
  assert.ok(isExcludedContributor(person('', 'app/dependabot')));
});

test('ordinary people are not excluded', () => {
  assert.ok(!isExcludedContributor(person('Osama Elshimy', 'osama-elshimy1')));
  assert.ok(!isExcludedContributor(person('Mahmoud Adly', 'mahmoud-adly')));
  // "bot" inside a real name is not a bot.
  assert.ok(!isExcludedContributor(person('Abbott Smith', 'abbott')));
});

test('merging dedupes by key, unions emails, keeps the first non-empty name and login', () => {
  const merged = mergeContributors([
    [person('Osama Elshimy', null, ['o.elshemey@e.vastgroupsa.com'])],
    [
      person('osama elshimy', 'osama-elshimy1', ['osama@vast.com', 'o.elshemey@e.vastgroupsa.com']),
      person('Sara Ali', null, ['sara@vast.com']),
    ],
  ]);
  assert.deepEqual(merged, [
    {
      name: 'Osama Elshimy',
      login: 'osama-elshimy1',
      emails: ['o.elshemey@e.vastgroupsa.com', 'osama@vast.com'],
    },
    { name: 'Sara Ali', login: null, emails: ['sara@vast.com'] },
  ]);
});

test('merging drops excluded people, bots and nameless entries', () => {
  const merged = mergeContributors([
    [person('MahmoudElzahabi', null, ['m@vast.com']), person('Osama Elshimy')],
    [person('', 'dependabot[bot]'), person('', null, ['ghost@vast.com']), person('Ali Elhabal')],
  ]);
  assert.deepEqual(
    merged.map((c) => c.name),
    ['Osama Elshimy'],
  );
});

test('merging does not mutate its input', () => {
  const a = person('Osama Elshimy', null, ['a@vast.com']);
  mergeContributors([[a], [person('Osama Elshimy', 'osama', ['b@vast.com'])]]);
  assert.deepEqual(a, person('Osama Elshimy', null, ['a@vast.com']));
});
