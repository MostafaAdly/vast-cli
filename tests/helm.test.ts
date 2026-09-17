import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractTag, readTagAtRef, PRE_MIGRATION_PRODUCTION_HELM } from '../src/utils/helm.js';

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

test('PRE_MIGRATION_PRODUCTION_HELM points at the app repo values file', () => {
  assert.equal(PRE_MIGRATION_PRODUCTION_HELM, 'Helm/values-prod.yaml');
});

/** A repo whose `production` branch carries a pre-migration Helm values file. */
function helmFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vast-helm-'));
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  };

  git('init', '-q', '-b', 'production');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  mkdirSync(join(dir, 'Helm'));
  writeFileSync(
    join(dir, 'Helm', 'values-prod.yaml'),
    'deployment:\n  containers:\n    - image:\n        tag: "2.2.1"\n',
  );
  git('add', '.');
  git('commit', '-qm', 'helm');

  return dir;
}

function withHelmFixture(fn: (dir: string) => void): void {
  const dir = helmFixture();
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('readTagAtRef reads the committed tag at a ref without checking anything out', () => {
  withHelmFixture((dir) => {
    assert.equal(readTagAtRef(dir, 'production', PRE_MIGRATION_PRODUCTION_HELM), '2.2.1');
  });
});

test('readTagAtRef names the file and ref when the path is not there', () => {
  withHelmFixture((dir) => {
    assert.throws(
      () => readTagAtRef(dir, 'production', 'Helm/values-nope.yaml'),
      /Could not read Helm\/values-nope\.yaml at production/,
    );
  });
});

test('readTagAtRef names the ref when the ref is not fetched', () => {
  withHelmFixture((dir) => {
    assert.throws(
      () => readTagAtRef(dir, 'origin/production', PRE_MIGRATION_PRODUCTION_HELM),
      /at origin\/production/,
    );
  });
});

test('readTagAtRef propagates the no-tag error for a placeholder file', () => {
  withHelmFixture((dir) => {
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
    };
    writeFileSync(join(dir, 'Helm', 'values-prod.yaml'), 'deployment:\n  replicas: 1\n');
    git('commit', '-qam', 'placeholder');
    assert.throws(() => readTagAtRef(dir, 'production', PRE_MIGRATION_PRODUCTION_HELM), /No `tag:` found/);
  });
});
