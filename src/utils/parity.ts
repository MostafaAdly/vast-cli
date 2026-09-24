/**
 * What one branch has that another lacks, by PR rather than by commit.
 *
 * Comparing commits is useless across these branches: merges, CI bumps and
 * cherry-picked hotfixes make staging and production differ by a hundred
 * commits that say nothing. A PR keeps its "Merge pull request #N" subject on
 * every branch it reaches, including as a cherry-picked copy, so PR numbers
 * are compared first. Whatever is left on one side is then checked by code:
 *
 *   1. patch-id against the other side's leftovers — a fix ported back under
 *      a new commit;
 *   2. patch-id against the other branch's history, for commits sharing an
 *      author date (cherry-picks and rebases keep it) — a duplicate of a
 *      change both branches already have;
 *   3. containment — the item's diff reverse-applies to the other branch's
 *      tip, so its exact post-image is there — a multi-commit PR ported
 *      commit by commit, or a change that arrived some other way.
 *
 * Any of the three marks the item ported. None of them is proof of absence:
 * a port that needed conflict fixes, or a change the other branch modified
 * further, still reads "not found".
 *
 * Git only: no network, and nothing written but a temporary index file.
 */

import { execFile } from 'child_process';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { isPipelineNoise, isVehicleBranch, parsePrSubject } from './pr-subject.js';

export interface PrUnit {
  number: number;
  branch: string;
  /** The merge commit, or the cherry-picked copy of it, on this side. */
  sha: string;
  landedAt: Date;
  /** Computed only for PRs left unmatched by number; null otherwise. */
  patchId: string | null;
}

export interface DirectCommit {
  sha: string;
  subject: string;
  landedAt: Date;
  patchId: string | null;
}

export interface Side {
  prs: PrUnit[];
  direct: DirectCommit[];
  /** SHAs of items whose code is already on the other side under another commit. */
  ported: Set<string>;
}

export interface Parity {
  source: string;
  target: string;
  onlySource: Side;
  onlyTarget: Side;
  sharedPrs: number[];
}

interface RawCommit {
  sha: string;
  parents: string[];
  landedAt: Date;
  /** Author time in seconds; a cherry-pick or rebase keeps it. */
  authoredAt: number;
  subject: string;
  files: string[];
}

/** What a side's items need for the code checks, keyed by SHA. */
interface SideRead {
  prs: PrUnit[];
  direct: DirectCommit[];
  commits: Map<string, RawCommit>;
}

const FIELD = '\x1f';
const RECORD = '\x1e';
const HELM_VALUES = /^Helm\/values-[^/]+\.ya?ml$/;
const SHA_LINE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
/** Parallel `git apply --check` runs; each is short and CPU-light. */
const APPLY_CONCURRENCY = 8;

interface RunResult {
  code: number;
  stdout: string;
}

/** git, async so a sweep's repos compare concurrently. Never throws. */
function run(dir: string, args: string[], input?: string, env?: NodeJS.ProcessEnv): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = execFile(
      'git',
      args,
      { cwd: dir, encoding: 'utf-8', maxBuffer: 512 * 1024 * 1024, env: env ? { ...process.env, ...env } : process.env },
      (error, stdout) => {
        const code = error ? (typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : 1) : 0;
        resolve({ code, stdout: String(stdout ?? '') });
      },
    );
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(input ?? '');
  });
}

/** git that must succeed: an unknown ref is an error, not an empty difference. */
async function git(dir: string, args: string[], input?: string): Promise<string> {
  const r = await run(dir, args, input);
  if (r.code !== 0) throw new Error(`git ${args[0]} failed (exit ${r.code})`);
  return r.stdout;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Every commit in the range with the files it touched, in one git call. */
async function commitsIn(dir: string, base: string, head: string): Promise<RawCommit[]> {
  const out = await git(dir, [
    'log',
    '--no-show-signature',
    '--no-color',
    '--name-only',
    `--format=${RECORD}%H${FIELD}%P${FIELD}%ct${FIELD}%at${FIELD}%s`,
    `${base}..${head}`,
  ]);
  const commits: RawCommit[] = [];
  for (const chunk of out.split(RECORD)) {
    if (!chunk.trim()) continue;
    const [header, ...rest] = chunk.split('\n');
    const [sha, parents, ct, at, ...subject] = header.split(FIELD);
    commits.push({
      sha,
      parents: parents ? parents.split(' ') : [],
      landedAt: new Date(Number(ct) * 1000),
      authoredAt: Number(at),
      subject: subject.join(FIELD),
      files: rest.map((s) => s.trim()).filter(Boolean),
    });
  }
  return commits;
}

/** Ancestors of `start` inside the range (itself included), by walking parents. */
function ancestorsInRange(start: string, commits: Map<string, RawCommit>): Set<string> {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length > 0) {
    const sha = stack.pop()!;
    if (seen.has(sha)) continue;
    const c = commits.get(sha);
    // Outside the range means reachable from the base, and so are all its
    // ancestors: nothing past it can be in the range.
    if (!c) continue;
    seen.add(sha);
    stack.push(...c.parents);
  }
  return seen;
}

/**
 * Split `git diff-tree --stdin` output into one patch per commit. Each patch
 * starts with the commit id line diff-tree echoes back.
 */
function splitBySha(out: string, wanted: Set<string>): Map<string, string> {
  const patches = new Map<string, string>();
  let current: string | null = null;
  let lines: string[] = [];
  const flush = (): void => {
    if (current) patches.set(current, lines.join('\n') + (lines.length > 0 ? '\n' : ''));
  };
  for (const line of out.split('\n')) {
    if (SHA_LINE.test(line) && wanted.has(line)) {
      flush();
      current = line;
      lines = [];
    } else if (current) {
      lines.push(line);
    }
  }
  flush();
  return patches;
}

/**
 * Patches for many commits in one call. A merge's patch is its whole change
 * against the branch it landed on (first parent); `diff-tree` is plumbing, so
 * no user diff config can reshape it.
 */
async function patchesOf(
  dir: string,
  items: Array<{ sha: string; base?: string }>,
  extraArgs: string[] = [],
  paths: string[] = [],
): Promise<Map<string, string>> {
  if (items.length === 0) return new Map();
  const input = items.map((i) => (i.base ? `${i.sha} ${i.base}` : i.sha)).join('\n') + '\n';
  const out = await git(
    dir,
    ['diff-tree', '--stdin', '--root', '-p', '--no-color', '--no-ext-diff', ...extraArgs, ...(paths.length ? ['--', ...paths] : [])],
    input,
  );
  const patches = splitBySha(out, new Set(items.map((i) => i.sha)));
  for (const i of items) if (!patches.has(i.sha)) patches.set(i.sha, '');
  return patches;
}

/** Patch-ids of patches already in hand, in one pipe. */
async function patchIdsOf(dir: string, patches: Map<string, string>): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  const input = [...patches].filter(([, p]) => p.trim()).map(([sha, p]) => `${sha}\n${p}`).join('');
  if (!input) return ids;
  for (const line of (await git(dir, ['patch-id', '--stable'], input)).split('\n')) {
    const [patchId, sha] = line.trim().split(/\s+/);
    if (patchId && sha) ids.set(sha, patchId);
  }
  return ids;
}

/**
 * Version bumps and deploy-tag edits that carry no product change: commits
 * touching only Helm values files, or only package.json's version line.
 */
async function bookkeepingShas(dir: string, candidates: RawCommit[]): Promise<Set<string>> {
  const out = new Set<string>();
  const versionOnly: RawCommit[] = [];
  for (const c of candidates) {
    if (c.files.length === 0) continue;
    if (c.files.every((f) => HELM_VALUES.test(f))) out.add(c.sha);
    else if (c.files.every((f) => f === 'package.json' || f === 'package-lock.json') && c.files.includes('package.json')) {
      versionOnly.push(c);
    }
  }
  const diffs = await patchesOf(dir, versionOnly.map((c) => ({ sha: c.sha })), ['-U0'], ['package.json']);
  for (const [sha, diff] of diffs) {
    const changed = diff.split('\n').filter((l) => /^[+-](?![+-])/.test(l));
    if (changed.length > 0 && changed.every((l) => /"version"\s*:/.test(l))) out.add(sha);
  }
  return out;
}

async function readSide(dir: string, base: string, head: string): Promise<SideRead> {
  const list = await commitsIn(dir, base, head);
  const commits = new Map(list.map((c) => [c.sha, c]));

  // Commits a PR merge brought in belong to that PR, not to the direct list:
  // those reachable from its second parent but not its first, walked in
  // memory over the range's own parent graph. Vehicles own nothing: a
  // hotfix's picks are PRs in their own right, and a fix typed straight onto
  // the hotfix branch is genuine direct work.
  const owned = new Set<string>();
  const prs = new Map<number, PrUnit>();
  for (const c of list) {
    const pr = parsePrSubject(c.subject);
    if (!pr || isVehicleBranch(pr.branch)) continue;
    if (c.parents.length >= 2) {
      const mainline = ancestorsInRange(c.parents[0], commits);
      for (const sha of ancestorsInRange(c.parents[1], commits)) if (!mainline.has(sha)) owned.add(sha);
    }
    const unit: PrUnit = { number: pr.number, branch: pr.branch, sha: c.sha, landedAt: c.landedAt, patchId: null };
    // A PR merged and later cherry-picked onto the same branch is one PR,
    // landed when it first arrived.
    const seen = prs.get(pr.number);
    if (!seen || unit.landedAt < seen.landedAt) prs.set(pr.number, unit);
  }

  const candidates = list.filter(
    (c) =>
      c.parents.length < 2 && // PR merges handled above; other merges carry no work of their own
      !parsePrSubject(c.subject) && // cherry-picked PR merges, vehicles included
      !owned.has(c.sha) &&
      !isPipelineNoise(c.subject),
  );
  const bookkeeping = await bookkeepingShas(dir, candidates);
  const direct: DirectCommit[] = candidates
    .filter((c) => !bookkeeping.has(c.sha))
    .map((c) => ({ sha: c.sha, subject: c.subject, landedAt: c.landedAt, patchId: null }));

  return {
    prs: [...prs.values()].sort((a, b) => a.number - b.number),
    direct: direct.sort((a, b) => a.landedAt.getTime() - b.landedAt.getTime()),
    commits,
  };
}

/** Run `fn` with a throwaway index holding `ref`'s tree; the real index is never touched. */
async function withIndexOf<T>(dir: string, ref: string, fn: (env: NodeJS.ProcessEnv) => Promise<T>): Promise<T> {
  const tmp = await mkdtemp(join(tmpdir(), 'vast-parity-'));
  const env = { GIT_INDEX_FILE: join(tmp, 'index') };
  try {
    const r = await run(dir, ['read-tree', ref], undefined, env);
    if (r.code !== 0) throw new Error(`git read-tree ${ref} failed`);
    return await fn(env);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/**
 * The SHAs whose patch reverse-applies cleanly to `ref`'s tree: every line the
 * change added is there, in context, so the change itself is there.
 */
async function containedPatches(dir: string, ref: string, patches: Map<string, string>): Promise<Set<string>> {
  const found = new Set<string>();
  const entries = [...patches].filter(([, p]) => p.trim());
  if (entries.length === 0) return found;
  await withIndexOf(dir, ref, (env) =>
    mapLimit(entries, APPLY_CONCURRENCY, async ([sha, patch]) => {
      const r = await run(dir, ['apply', '--cached', '--check', '-R', '--whitespace=nowarn'], patch, env);
      if (r.code === 0) found.add(sha);
    }),
  );
  return found;
}

/**
 * Which of these plain (non-merge) commits have their change present in
 * `ref`'s tree. Used for direct commits carried by an open release branch.
 */
export async function containedIn(dir: string, ref: string, shas: string[]): Promise<Set<string>> {
  if (shas.length === 0) return new Set();
  const patches = await patchesOf(dir, shas.map((sha) => ({ sha })), ['--binary']);
  return containedPatches(dir, ref, patches);
}

/**
 * Commits in `ref`'s history whose patch-id matches one of these, looking
 * only at commits sharing an author time with an item: cherry-pick, rebase
 * and am all keep the author time, so a duplicate carries it too, and the
 * rest of history is never diffed.
 */
async function duplicatesInHistory(
  dir: string,
  ref: string,
  items: Array<{ sha: string; authoredAt: number; patchId: string }>,
): Promise<Set<string>> {
  const found = new Set<string>();
  if (items.length === 0) return found;
  const times = new Set(items.map((i) => i.authoredAt));
  const since = Math.min(...times);
  // A duplicate was committed no earlier than it was authored, so the
  // committer-date cut-off loses nothing.
  const out = await git(dir, ['log', '--no-merges', '--no-show-signature', '--no-color', '--format=%H %at', `--since=@${since}`, ref]);
  const own = new Set(items.map((i) => i.sha));
  const candidates = out
    .split('\n')
    .map((l) => l.split(' '))
    .filter(([sha, at]) => sha && !own.has(sha) && times.has(Number(at)))
    .map(([sha]) => ({ sha }));
  if (candidates.length === 0) return found;
  const ids = new Set((await patchIdsOf(dir, await patchesOf(dir, candidates))).values());
  for (const i of items) if (ids.has(i.patchId)) found.add(i.sha);
  return found;
}

/**
 * Mark the side's items whose code is on the other branch, by the three
 * checks in the header. `patches` and `ids` cover both sides' leftovers.
 */
async function portedOf(
  dir: string,
  side: SideRead,
  items: Array<PrUnit | DirectCommit>,
  otherItems: Array<PrUnit | DirectCommit>,
  otherRef: string,
  patches: Map<string, string>,
): Promise<Set<string>> {
  const otherIds = new Set(otherItems.map((i) => i.patchId).filter((p): p is string => p !== null));
  const ported = new Set(items.filter((i) => i.patchId !== null && otherIds.has(i.patchId)).map((i) => i.sha));

  const plain = items
    .filter((i) => !ported.has(i.sha) && i.patchId !== null && (side.commits.get(i.sha)?.parents.length ?? 0) < 2)
    .map((i) => ({ sha: i.sha, authoredAt: side.commits.get(i.sha)!.authoredAt, patchId: i.patchId! }));
  for (const sha of await duplicatesInHistory(dir, otherRef, plain)) ported.add(sha);

  const rest = new Map(items.filter((i) => !ported.has(i.sha)).map((i) => [i.sha, patches.get(i.sha) ?? '']));
  for (const sha of await containedPatches(dir, otherRef, rest)) ported.add(sha);
  return ported;
}

function diffBase(side: SideRead, sha: string): { sha: string; base?: string } {
  const c = side.commits.get(sha);
  return c && c.parents.length >= 2 ? { sha, base: c.parents[0] } : { sha };
}

export async function compareBranches(dir: string, source: string, target: string): Promise<Parity> {
  const [src, tgt] = await Promise.all([readSide(dir, target, source), readSide(dir, source, target)]);
  const inTarget = new Set(tgt.prs.map((p) => p.number));
  const inSource = new Set(src.prs.map((p) => p.number));
  const onlySrc = { prs: src.prs.filter((p) => !inTarget.has(p.number)), direct: src.direct };
  const onlyTgt = { prs: tgt.prs.filter((p) => !inSource.has(p.number)), direct: tgt.direct };

  // Code is read only for what number matching left over — shared PRs never
  // cost a diff.
  const srcItems = [...onlySrc.prs, ...onlySrc.direct];
  const tgtItems = [...onlyTgt.prs, ...onlyTgt.direct];
  const [srcPatches, tgtPatches] = await Promise.all([
    patchesOf(dir, srcItems.map((i) => diffBase(src, i.sha)), ['--binary']),
    patchesOf(dir, tgtItems.map((i) => diffBase(tgt, i.sha)), ['--binary']),
  ]);
  const [srcIds, tgtIds] = await Promise.all([patchIdsOf(dir, srcPatches), patchIdsOf(dir, tgtPatches)]);
  for (const i of srcItems) i.patchId = srcIds.get(i.sha) ?? null;
  for (const i of tgtItems) i.patchId = tgtIds.get(i.sha) ?? null;

  const [srcPorted, tgtPorted] = await Promise.all([
    portedOf(dir, src, srcItems, tgtItems, target, srcPatches),
    portedOf(dir, tgt, tgtItems, srcItems, source, tgtPatches),
  ]);

  return {
    source,
    target,
    onlySource: { ...onlySrc, ported: srcPorted },
    onlyTarget: { ...onlyTgt, ported: tgtPorted },
    sharedPrs: src.prs.filter((p) => inTarget.has(p.number)).map((p) => p.number),
  };
}
