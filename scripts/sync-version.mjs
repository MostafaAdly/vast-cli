#!/usr/bin/env node
/**
 * Generates src/version.ts from package.json.
 *
 * The CLI used to hardcode its own version string, which `npm version` does not
 * touch. v1.1.0 shipped reporting 1.0.0, and because the update check compares
 * that value against the latest release tag, every user would have been told
 * they were out of date forever — including right after upgrading.
 *
 * Runs before build and bundle. tests/version-sync.test.ts fails if the
 * generated file drifts from package.json, so a bump without a rebuild is
 * caught rather than shipped.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));

const contents = `/**
 * GENERATED FILE — do not edit.
 *
 * Written by scripts/sync-version.mjs from package.json, which runs before
 * build and bundle. Change the version with \`npm version <level>\`.
 */

export const VERSION = '${version}';
`;

const target = join(root, 'src', 'version.ts');
const existing = (() => {
  try {
    return readFileSync(target, 'utf-8');
  } catch {
    return null;
  }
})();

// Only write when it changed, so watch-mode builds do not loop.
if (existing !== contents) {
  writeFileSync(target, contents, 'utf-8');
  console.log(`sync-version: src/version.ts -> ${version}`);
}
