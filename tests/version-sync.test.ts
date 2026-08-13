import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION } from '../src/version.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')).version as string;

// v1.1.0 shipped an asset that reported 1.0.0, because the CLI hardcoded its
// own version and `npm version` only touches package.json. The update check
// compares this value against the latest release tag, so the drift told every
// user they were permanently out of date — including right after upgrading.
test('the CLI version matches package.json', () => {
  assert.equal(
    VERSION,
    pkgVersion,
    'src/version.ts is stale. Run `npm run build` (or `node scripts/sync-version.mjs`) after bumping.',
  );
});

test('the version is a plain semver, with no leading v', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
});

// The release workflow refuses to publish when the git tag and package.json
// disagree; this covers the other half, tag vs what the binary reports.
test('the generated file is marked as generated', () => {
  const source = readFileSync(join(root, 'src', 'version.ts'), 'utf-8');
  assert.match(source, /GENERATED FILE/);
  assert.match(source, /sync-version\.mjs/);
});
