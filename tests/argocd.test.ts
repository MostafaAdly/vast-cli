import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  ArgoUnauthorizedError,
  DEFAULT_ROLLOUT_TIMING,
  getApplication,
  login,
  rolloutDone,
  userinfo,
  waitForRollout,
  type ArgoApp,
  type RolloutDeps,
} from '../src/utils/argocd.js';

/**
 * The client is only ever pointed at a throwaway localhost server. The real
 * ArgoCD hosts are never contacted by the suite — staging would need a session
 * token, and production must not be touched at all.
 */
type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void;

async function withServer(handler: Handler, run: (host: string) => Promise<void>): Promise<void> {
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => handler(req, res, body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

test('login posts the credentials and returns the session token', async () => {
  const seen: { url?: string; body?: string; method?: string } = {};
  await withServer(
    (req, res, body) => {
      seen.url = req.url;
      seen.method = req.method;
      seen.body = body;
      json(res, 200, { token: 'session-token-123' });
    },
    async (host) => {
      const token = await login(host, 'mostafa', 'hunter2');
      assert.equal(token, 'session-token-123');
      assert.equal(seen.method, 'POST');
      assert.equal(seen.url, '/api/v1/session');
      assert.deepEqual(JSON.parse(seen.body ?? '{}'), { username: 'mostafa', password: 'hunter2' });
    },
  );
});

test('login surfaces the server message on a rejected password', async () => {
  await withServer(
    (_req, res) => json(res, 401, { error: 'Invalid username or password' }),
    async (host) => {
      await assert.rejects(
        () => login(host, 'mostafa', 'wrong'),
        (error: Error) => {
          assert.match(error.message, /Invalid username or password/);
          // The password must never reach an error message or a log line.
          assert.doesNotMatch(error.message, /wrong/);
          return true;
        },
      );
    },
  );
});

test('login fails clearly when the response carries no token', async () => {
  await withServer(
    (_req, res) => json(res, 200, {}),
    async (host) => {
      await assert.rejects(() => login(host, 'mostafa', 'hunter2'), /no token/i);
    },
  );
});

test('userinfo reports a live session', async () => {
  await withServer(
    (req, res) => {
      assert.equal(req.url, '/api/v1/session/userinfo');
      assert.equal(req.headers.authorization, 'Bearer tok');
      json(res, 200, { loggedIn: true, username: 'mostafa' });
    },
    async (host) => {
      assert.deepEqual(await userinfo(host, 'tok'), { loggedIn: true, username: 'mostafa' });
    },
  );
});

test('userinfo reports an expired token as logged out rather than throwing', async () => {
  await withServer(
    (_req, res) => json(res, 401, { error: 'token expired' }),
    async (host) => {
      assert.deepEqual(await userinfo(host, 'stale'), { loggedIn: false });
    },
  );
});

test('getApplication maps sync, health, images and revision', async () => {
  await withServer(
    (req, res) => {
      assert.equal(req.url, '/api/v1/applications/vastpay-dasaboard');
      assert.equal(req.headers.authorization, 'Bearer tok');
      json(res, 200, {
        status: {
          sync: { status: 'Synced', revision: 'abc123' },
          health: { status: 'Healthy' },
          summary: { images: ['registry/vastpay-dashboard:2.1.3-rc20'] },
        },
      });
    },
    async (host) => {
      assert.deepEqual(await getApplication(host, 'tok', 'vastpay-dasaboard'), {
        syncStatus: 'Synced',
        healthStatus: 'Healthy',
        images: ['registry/vastpay-dashboard:2.1.3-rc20'],
        revision: 'abc123',
      });
    },
  );
});

test('getApplication copes with a half-populated status block', async () => {
  await withServer(
    (_req, res) => json(res, 200, { status: {} }),
    async (host) => {
      assert.deepEqual(await getApplication(host, 'tok', 'pwa'), {
        syncStatus: 'Unknown',
        healthStatus: 'Unknown',
        images: [],
        revision: '',
      });
    },
  );
});

test('getApplication throws ArgoUnauthorizedError on 401 and on 403', async () => {
  for (const status of [401, 403]) {
    await withServer(
      (_req, res) => json(res, status, { error: 'no session' }),
      async (host) => {
        await assert.rejects(() => getApplication(host, 'tok', 'pwa'), ArgoUnauthorizedError);
      },
    );
  }
});

test('getApplication reports a missing application distinctly', async () => {
  await withServer(
    (_req, res) => json(res, 404, { error: 'applications.argoproj.io "nope" not found' }),
    async (host) => {
      await assert.rejects(() => getApplication(host, 'tok', 'nope'), (error: Error) => {
        assert.ok(!(error instanceof ArgoUnauthorizedError));
        assert.match(error.message, /not found/);
        return true;
      });
    },
  );
});

// --- rollout predicate -----------------------------------------------------

function app(partial: Partial<ArgoApp> = {}): ArgoApp {
  return {
    syncStatus: 'Synced',
    healthStatus: 'Healthy',
    images: ['registry/pwa:1.2.3'],
    revision: 'rev',
    ...partial,
  };
}

test('rolloutDone needs the tag, Healthy and Synced together', () => {
  assert.equal(rolloutDone(app(), '1.2.3'), true);
  assert.equal(rolloutDone(app({ images: ['registry/pwa:1.2.2'] }), '1.2.3'), false);
  assert.equal(rolloutDone(app({ healthStatus: 'Progressing' }), '1.2.3'), false);
  assert.equal(rolloutDone(app({ syncStatus: 'OutOfSync' }), '1.2.3'), false);
  assert.equal(rolloutDone(app({ images: [] }), '1.2.3'), false);
});

test('rolloutDone does not match a tag that is only a suffix of another', () => {
  // `:11.2.3` must not satisfy a wait for `1.2.3`.
  assert.equal(rolloutDone(app({ images: ['registry/pwa:11.2.3'] }), '1.2.3'), false);
});

// --- waiter ----------------------------------------------------------------

interface Harness {
  deps: RolloutDeps;
  lines: string[];
  clock: () => number;
}

/** Scripted app reads plus a fake clock that only advances when we sleep. */
function harness(script: Array<ArgoApp | Error>): Harness {
  let t = 0;
  let i = 0;
  const lines: string[] = [];
  return {
    lines,
    clock: () => t,
    deps: {
      getApp: async () => {
        const next = script[Math.min(i, script.length - 1)];
        i++;
        if (next instanceof Error) throw next;
        return next;
      },
      sleep: async (ms: number) => {
        t += ms;
      },
      now: () => t,
      print: (line: string) => {
        lines.push(line);
      },
    },
  };
}

const FAST = { pollMs: 1000, heartbeatMs: 30000, timeoutMs: 600000, maxConsecutiveErrors: 12 };

test('the waiter returns once the tag is live, Synced and Healthy', async () => {
  const h = harness([
    app({ images: ['registry/pwa:1.2.2'], syncStatus: 'OutOfSync', healthStatus: 'Healthy' }),
    app({ images: ['registry/pwa:1.2.3'], syncStatus: 'OutOfSync', healthStatus: 'Progressing' }),
    app({ images: ['registry/pwa:1.2.3'], syncStatus: 'Synced', healthStatus: 'Healthy' }),
  ]);
  const result = await waitForRollout('pwa', 'pwa', '1.2.3', h.deps, FAST);
  assert.equal(result.ok, true);
  assert.equal(result.reason, undefined);
  assert.equal(result.elapsedMs, 2000);
  assert.equal(result.app?.syncStatus, 'Synced');
});

test('the waiter prints the waiting state, then each state change, once each', async () => {
  const h = harness([
    app({ images: ['registry/pwa:1.2.2'], syncStatus: 'Synced', healthStatus: 'Healthy' }),
    app({ images: ['registry/pwa:1.2.2'], syncStatus: 'Synced', healthStatus: 'Healthy' }),
    app({ images: ['registry/pwa:1.2.3'], syncStatus: 'OutOfSync', healthStatus: 'Progressing' }),
    app({ images: ['registry/pwa:1.2.3'], syncStatus: 'OutOfSync', healthStatus: 'Progressing' }),
    app({ images: ['registry/pwa:1.2.3'], syncStatus: 'Synced', healthStatus: 'Healthy' }),
  ]);
  const result = await waitForRollout('VastMenuPwa', 'pwa', '1.2.3', h.deps, FAST);
  assert.equal(result.ok, true);
  assert.deepEqual(h.lines, [
    '  VastMenuPwa  argocd pwa  waiting for 1.2.3  0s',
    '  VastMenuPwa  argocd pwa  OutOfSync/Progressing  2s',
  ]);
});

test('the waiter heartbeats while nothing changes', async () => {
  const h = harness([app({ images: ['registry/pwa:1.2.2'] })]);
  const result = await waitForRollout('pwa', 'pwa', '1.2.3', h.deps, {
    ...FAST,
    pollMs: 10000,
    timeoutMs: 60000,
  });
  assert.equal(result.ok, false);
  // 0s first print, then one every 30s: 30s and 60s.
  assert.deepEqual(h.lines, [
    '  pwa  argocd pwa  waiting for 1.2.3  0s',
    '  pwa  argocd pwa  waiting for 1.2.3  30s',
    '  pwa  argocd pwa  waiting for 1.2.3  1m00s',
  ]);
});

test('the waiter gives up at the ceiling with a spelled-out timeout', async () => {
  const h = harness([app({ images: ['registry/pwa:1.2.2'] })]);
  const result = await waitForRollout('pwa', 'pwa', '1.2.3', h.deps, { ...FAST, pollMs: 60000 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'timed out after 10m00s');
  assert.equal(result.elapsedMs, 600000);
});

test('an unauthorized read short-circuits with the login hint', async () => {
  const h = harness([new ArgoUnauthorizedError('401 from argocd')]);
  const result = await waitForRollout('pwa', 'pwa', '1.2.3', h.deps, FAST);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'argocd unauthorized — run `vast argocd login`');
  assert.equal(result.elapsedMs, 0);
  assert.deepEqual(h.lines, []);
});

test('a streak of read errors gives up at maxConsecutiveErrors', async () => {
  const h = harness([new Error('ECONNRESET')]);
  const result = await waitForRollout('pwa', 'pwa', '1.2.3', h.deps, { ...FAST, maxConsecutiveErrors: 3 });
  assert.equal(result.ok, false);
  assert.match(result.reason ?? '', /ECONNRESET/);
  // One line when the streak starts, not one per retry.
  assert.equal(h.lines.length, 1);
  assert.match(h.lines[0], /read failed, retrying/);
});

test('a good read resets the error streak', async () => {
  const h = harness([
    new Error('ECONNRESET'),
    new Error('ECONNRESET'),
    app({ images: ['registry/pwa:1.2.2'] }),
    new Error('ECONNRESET'),
    new Error('ECONNRESET'),
    app({ images: ['registry/pwa:1.2.3'], syncStatus: 'Synced', healthStatus: 'Healthy' }),
  ]);
  const result = await waitForRollout('pwa', 'pwa', '1.2.3', h.deps, { ...FAST, maxConsecutiveErrors: 3 });
  assert.equal(result.ok, true);
});

test('the shipped timing is a 15 minute ceiling on a 5s poll', () => {
  assert.deepEqual(DEFAULT_ROLLOUT_TIMING, {
    pollMs: 5000,
    heartbeatMs: 30000,
    timeoutMs: 900000,
    maxConsecutiveErrors: 12,
  });
});

// A snapshot predicate cannot tell "it rolled out" from "it was already there".
// `deployOne` re-deploying a live version needs to wait for a NEW sync, so the
// waiter has to take the definition of done from its caller.
test('the waiter honours a custom done predicate', async () => {
  const live = { images: ['registry/pwa:1.2.3'], syncStatus: 'Synced', healthStatus: 'Healthy' };
  const h = harness([
    app({ ...live, revision: 'old' }),
    app({ ...live, revision: 'old' }),
    app({ ...live, revision: 'new' }),
  ]);
  const result = await waitForRollout(
    'pwa',
    'pwa',
    '1.2.3',
    h.deps,
    FAST,
    (a) => rolloutDone(a, '1.2.3') && a.revision !== 'old',
  );
  assert.equal(result.ok, true);
  assert.equal(result.app?.revision, 'new');
  assert.equal(result.elapsedMs, 2000, 'the already-done snapshots must not satisfy the wait');
});

// While the custom predicate says "not yet" the line still describes the app —
// the tag IS present, so "waiting for <tag>" would be a lie.
test('a custom predicate does not change the state text', async () => {
  const h = harness([
    app({ images: ['registry/pwa:1.2.3'], syncStatus: 'Synced', healthStatus: 'Healthy', revision: 'old' }),
    app({ images: ['registry/pwa:1.2.3'], syncStatus: 'OutOfSync', healthStatus: 'Progressing', revision: 'new' }),
    app({ images: ['registry/pwa:1.2.3'], syncStatus: 'Synced', healthStatus: 'Healthy', revision: 'new' }),
  ]);
  const result = await waitForRollout('pwa', 'pwa', '1.2.3', h.deps, FAST, (a) => a.revision === 'new' && rolloutDone(a, '1.2.3'));
  assert.equal(result.ok, true);
  assert.deepEqual(h.lines, [
    '  pwa  argocd pwa  Synced/Healthy  0s',
    '  pwa  argocd pwa  OutOfSync/Progressing  1s',
  ]);
});

// A refresh makes ArgoCD re-read git now instead of on its ~3 minute poll; with
// automated sync on, that alone starts the rollout. It is the difference between
// a 3 minute wait and a 30 second one after every green build.
test('refreshApplication asks ArgoCD for a normal refresh of the app', async () => {
  const { refreshApplication } = await import('../src/utils/argocd.js');
  const urls: string[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    urls.push(String(url));
    assert.equal((init?.headers as Record<string, string>).authorization, 'Bearer tok');
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  await refreshApplication('https://argo.example', 'tok', 'vastpay-pwa', fetchFn);
  assert.deepEqual(urls, ['https://argo.example/api/v1/applications/vastpay-pwa?refresh=normal']);
});

test('refreshApplication reports a rejected token as unauthorized', async () => {
  const { refreshApplication, ArgoUnauthorizedError } = await import('../src/utils/argocd.js');
  const fetchFn = (async () => new Response('{"error":"no session"}', { status: 401 })) as typeof fetch;
  await assert.rejects(
    () => refreshApplication('https://argo.example', 'tok', 'vastpay-pwa', fetchFn),
    ArgoUnauthorizedError,
  );
});
