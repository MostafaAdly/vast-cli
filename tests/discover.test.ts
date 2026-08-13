import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  findCheckouts,
  originOf,
  discover,
  clearDiscoveryCache,
  pickShortest,
  PRUNE,
} from '../src/utils/discover.js';

// Sweeps are memoized per process; every case below builds its checkouts fresh.
beforeEach(() => clearDiscoveryCache());

/** A directory that is a real git repo with the given origin. */
function makeRepo(parent: string, name: string, origin: string): string {
  const dir = join(parent, name);
  mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['remote', 'add', 'origin', origin], { cwd: dir, stdio: 'pipe' });
  return dir;
}

function sandbox(): string {
  return mkdtempSync(join(tmpdir(), 'vast-disc-'));
}

test('reads the origin remote of a checkout', () => {
  const root = sandbox();
  try {
    const dir = makeRepo(root, 'anything', 'https://github.com/vast-menu/vastpaypwa');
    assert.equal(originOf(dir), 'https://github.com/vast-menu/vastpaypwa');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('returns null for a directory with no origin', () => {
  const root = sandbox();
  try {
    mkdirSync(join(root, 'plain'));
    assert.equal(originOf(join(root, 'plain')), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('finds checkouts nested at different depths', () => {
  const root = sandbox();
  try {
    makeRepo(root, 'top', 'https://github.com/vast-menu/vastpaypwa');
    mkdirSync(join(root, 'a', 'b'), { recursive: true });
    makeRepo(join(root, 'a', 'b'), 'deep', 'https://github.com/vast-menu/vastmenupwa');
    const found = findCheckouts(root, 4);
    assert.equal(found.length, 2, `got ${JSON.stringify(found)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('does not descend into pruned directories', () => {
  const root = sandbox();
  try {
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    makeRepo(join(root, 'node_modules'), 'dep', 'https://github.com/vast-menu/vastpaypwa');
    assert.deepEqual(findCheckouts(root, 4), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('respects the depth limit', () => {
  const root = sandbox();
  try {
    mkdirSync(join(root, 'a', 'b', 'c', 'd'), { recursive: true });
    makeRepo(join(root, 'a', 'b', 'c', 'd'), 'buried', 'https://github.com/vast-menu/vastpaypwa');
    assert.deepEqual(findCheckouts(root, 2), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('groups checkouts by canonical repo name, ignoring foreign repos', () => {
  const root = sandbox();
  try {
    makeRepo(root, 'whatever-i-named-it', 'https://github.com/vast-menu/vastpaypwa');
    makeRepo(root, 'someone-elses', 'https://github.com/other-org/vastpaypwa');
    const map = discover([root]);
    assert.deepEqual([...map.keys()], ['VastPayPwa']);
    assert.equal(map.get('VastPayPwa')?.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Two clones of one repo is a real state: vastmenu-api and vastmenu-api-test
// both point at VastMenu-BackEnd on the author's machine.
test('records every candidate when two checkouts claim one repo', () => {
  const root = sandbox();
  try {
    makeRepo(root, 'vastmenu-api', 'https://github.com/vast-menu/vastmenu-backend');
    makeRepo(root, 'vastmenu-api-test', 'https://github.com/vast-menu/vastmenu-backend');
    const candidates = discover([root]).get('VastMenu-BackEnd');
    assert.equal(candidates?.length, 2, 'both candidates must be recorded, not silently one');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// A sweep walks every root and spawns a `git remote get-url` per checkout, and
// `vast clone --team all` resolves twelve repos in one run. Without the memo
// that is twelve full sweeps of the disk.
test('sweeps the same roots only once per process', () => {
  const root = sandbox();
  try {
    makeRepo(root, 'first', 'https://github.com/vast-menu/vastpaypwa');
    assert.deepEqual([...discover([root]).keys()], ['VastPayPwa']);

    makeRepo(root, 'second', 'https://github.com/vast-menu/vastmenupwa');
    assert.deepEqual([...discover([root]).keys()], ['VastPayPwa'], 'second call must not re-walk');

    clearDiscoveryCache();
    assert.deepEqual([...discover([root]).keys()].sort(), ['VastMenuPwa', 'VastPayPwa']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('root order does not defeat the memo', () => {
  const root = sandbox();
  const other = sandbox();
  try {
    makeRepo(root, 'one', 'https://github.com/vast-menu/vastpaypwa');
    const first = discover([root, other]);
    assert.equal(discover([other, root]), first, 'same roots, either order, one sweep');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
});

// Shared with `vast init` so a lazy repair can never pick a different checkout
// than init would have.
test('picks the shortest path when several checkouts claim one repo', () => {
  assert.equal(
    pickShortest(['/a/very/long/path/vastmenu-api-test', '/a/vastmenu-api']),
    '/a/vastmenu-api',
  );
});

test('ties break deterministically on sort order, never at random', () => {
  const a = pickShortest(['/x/bbb', '/x/aaa']);
  const b = pickShortest(['/x/aaa', '/x/bbb']);
  assert.equal(a, b);
  assert.equal(a, '/x/aaa');
});

test('a single candidate is returned as-is', () => {
  assert.equal(pickShortest(['/only/one']), '/only/one');
});

test('prune list covers the obvious noise', () => {
  for (const d of ['node_modules', 'Library', '.Trash', 'dist', 'build']) {
    assert.ok(PRUNE.has(d), `${d} should be pruned`);
  }
});
