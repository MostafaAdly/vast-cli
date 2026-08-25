/**
 * Selective promotion: resolve user-supplied refs into cherry-pickable commits.
 *
 * A "ref" is anything a teammate would naturally paste: a commit SHA, a PR
 * number, or a GitHub link to either. Parsing is pure and lives here so the
 * ambiguity rules are testable; resolution (gh/git) is I/O and kept thin.
 *
 * The one deliberate ambiguity rule: a bare number is ALWAYS a PR number,
 * never a short SHA. An all-digit SHA prefix like `123456` is genuinely
 * ambiguous, so digits-only means PR, and a SHA must contain a letter or be
 * given as a commit link.
 */

import { execFileSync } from 'child_process';
import { isAncestor, refExists } from './git.js';

export type ParsedPick =
  | { kind: 'pr'; number: number; repo?: string }
  | { kind: 'sha'; sha: string; repo?: string }
  | { kind: 'branch'; name: string; repo?: string };

export function parsePickRef(input: string): ParsedPick | null {
  const s = input.trim().replace(/\/+$/, '');
  if (!s) return null;

  const pull = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i.exec(s);
  if (pull) return { kind: 'pr', number: Number(pull[3]), repo: `${pull[1]}/${pull[2]}` };

  const commit = /github\.com\/([^/]+)\/([^/]+)\/commit\/([0-9a-f]{7,40})/i.exec(s);
  if (commit) return { kind: 'sha', sha: commit[3].toLowerCase(), repo: `${commit[1]}/${commit[2]}` };

  const hash = /^#(\d+)$/.exec(s);
  if (hash) return { kind: 'pr', number: Number(hash[1]) };

  if (/^\d+$/.test(s)) return { kind: 'pr', number: Number(s) };

  // A SHA must contain at least one letter — digits-only always means PR.
  if (/^[0-9a-f]{7,40}$/i.test(s) && /[a-f]/i.test(s)) {
    return { kind: 'sha', sha: s.toLowerCase() };
  }

  const tree = /github\.com\/([^/]+)\/([^/]+)\/tree\/(.+)$/i.exec(s);
  if (tree) return { kind: 'branch', name: tree[3], repo: `${tree[1]}/${tree[2]}` };

  // Anything else that LOOKS like a git ref name is a branch candidate —
  // whether it actually exists on origin is resolution's job, which produces
  // a far better error ("no branch 'x' on origin") than a parse refusal would.
  // A name that parses as a SHA above resolves as a commit first; branch names
  // that are pure hex are practically nonexistent here.
  if (/^[\w][\w./-]*$/.test(s) && !/^https?:/i.test(s)) {
    return { kind: 'branch', name: s };
  }

  return null;
}

/** A branch that will be truly MERGED into the release branch (case 1). */
export interface BranchMerge {
  /** What the user typed. */
  input: string;
  name: string;
  /** The remote-tracking ref the merge uses. */
  ref: string;
  /** Commits this merge brings that production lacks. */
  commits: number;
}

export interface ResolvedPick {
  /** What the user typed, for error messages. */
  input: string;
  sha: string;
  subject: string;
  /** Merge commits need `cherry-pick -m 1`. */
  isMerge: boolean;
  /** Commit time, used to apply picks in history order. */
  timestamp: number;
}

function git(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
}

/** PR number -> merge commit SHA via gh. Throws with a readable message. */
function mergeCommitOfPr(org: string, repo: string, number: number): string {
  const out = execFileSync(
    'gh',
    ['pr', 'view', String(number), '--repo', `${org}/${repo}`, '--json', 'state,mergeCommit'],
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const parsed = JSON.parse(out) as { state?: string; mergeCommit?: { oid?: string } };
  if (parsed.state !== 'MERGED') {
    throw new Error(`PR #${number} is ${parsed.state ?? 'in an unknown state'}, not merged`);
  }
  const oid = parsed.mergeCommit?.oid;
  if (!oid) throw new Error(`PR #${number} has no merge commit (rebase-merged?) — pick its commits by SHA instead`);
  return oid;
}

/**
 * Resolve, validate, and order picks. Returns every error at once rather than
 * failing on the first — a teammate fixing a list wants the whole list.
 *
 * Validations, in order of what they protect:
 * - a link's owner/repo must match the repo being promoted (paste guard)
 * - a PR must be merged and have a merge commit
 * - the commit must exist locally (fetch first)
 * - the commit must be reachable from origin/staging — production only ever
 *   receives staging-baked changes, and --pick does not get to break that
 * - the commit must NOT already be on origin/production (nothing to ship)
 */
export function resolvePicks(
  dir: string,
  org: string,
  repoName: string,
  inputs: string[],
): { picks: ResolvedPick[]; merges: BranchMerge[]; warnings: string[]; errors: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const picks: ResolvedPick[] = [];
  const merges: BranchMerge[] = [];
  const seen = new Set<string>();

  const count = (ref: string, exclude: string[]): number =>
    Number(git(dir, ['rev-list', '--count', ref, ...exclude.map((e) => `^${e}`)]).trim());

  for (const input of inputs) {
    const parsed = parsePickRef(input);
    if (!parsed) {
      errors.push(`${input}: not a SHA, PR number, branch, or GitHub link (digits-only means PR; a SHA needs a letter or a /commit/ link)`);
      continue;
    }
    if (parsed.repo && parsed.repo.toLowerCase() !== `${org}/${repoName}`.toLowerCase()) {
      errors.push(`${input}: link points at ${parsed.repo}, not ${org}/${repoName}`);
      continue;
    }

    if (parsed.kind === 'branch') {
      // Classify by where the branch came from. Three cases, three treatments —
      // because `git merge` brings a branch's entire ancestry, not just its own
      // work, and only a branch cut from production has no foreign ancestry.
      const ref = `origin/${parsed.name}`;
      if (!refExists(dir, ref)) {
        errors.push(`${input}: no branch '${parsed.name}' on origin`);
        continue;
      }

      // Order matters: production is itself an ancestor of staging, so the
      // already-shipped check must run before the landed-on-staging one.
      if (isAncestor(dir, ref, 'origin/production')) {
        errors.push(`${input}: '${parsed.name}' is already on origin/production — nothing to ship`);
        continue;
      }

      if (isAncestor(dir, ref, 'origin/staging')) {
        // Case 2: already landed on staging. Merging it again would drag its
        // ancestry in; its landing merge commit is the equivalent, safe pick.
        const landing = git(dir, [
          'rev-list',
          '--ancestry-path',
          '--merges',
          '--reverse',
          `${ref}..origin/staging`,
        ])
          .trim()
          .split('\n')
          .filter(Boolean)[0];
        if (!landing) {
          errors.push(
            `${input}: '${parsed.name}' was fast-forwarded into staging — pick its commits by SHA, or its PR`,
          );
          continue;
        }
        if (seen.has(landing)) continue;
        seen.add(landing);
        picks.push({
          input,
          sha: landing,
          subject: git(dir, ['show', '-s', '--format=%s', landing]).trim(),
          isMerge: true,
          timestamp: Number(git(dir, ['show', '-s', '--format=%ct', landing]).trim()),
        });
        continue;
      }

      const beyondProd = count(ref, ['origin/production']);
      const exclude = ['origin/production', 'origin/staging'];
      if (refExists(dir, 'origin/develop')) exclude.push('origin/develop');
      const own = count(ref, exclude);
      if (own !== beyondProd) {
        // Case 3: forked off develop/staging and not landed. Merging would drag
        // that foreign history into production.
        errors.push(
          `${input}: merging '${parsed.name}' would drag ${beyondProd - own} commit(s) of staging/develop history into production — land it on staging first, or pick exact commits`,
        );
        continue;
      }

      // Case 1: cut from production. A true merge is correct — and it bypasses
      // staging, which is the one loudly-permitted exception to the rule.
      merges.push({ input, name: parsed.name, ref, commits: beyondProd });
      warnings.push(
        `${parsed.name}: ${beyondProd} commit(s) have never been through staging — QC has not seen them`,
      );
      continue;
    }

    let sha: string;
    try {
      sha = parsed.kind === 'pr' ? mergeCommitOfPr(org, repoName, parsed.number) : parsed.sha;
      sha = git(dir, ['rev-parse', '--verify', `${sha}^{commit}`]).trim();
    } catch (error) {
      errors.push(`${input}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
      continue;
    }

    if (seen.has(sha)) continue;
    seen.add(sha);

    if (!isAncestor(dir, sha, 'origin/staging')) {
      errors.push(`${input}: ${sha.slice(0, 7)} is not on origin/staging — production only receives staging-baked changes`);
      continue;
    }
    if (isAncestor(dir, sha, 'origin/production')) {
      errors.push(`${input}: ${sha.slice(0, 7)} is already on origin/production — nothing to ship`);
      continue;
    }

    const parents = git(dir, ['rev-list', '--parents', '-n', '1', sha]).trim().split(/\s+/).length - 1;
    picks.push({
      input,
      sha,
      subject: git(dir, ['show', '-s', '--format=%s', sha]).trim(),
      isMerge: parents > 1,
      timestamp: Number(git(dir, ['show', '-s', '--format=%ct', sha]).trim()),
    });
  }

  // History order, oldest first — cherry-picks are order-sensitive, and the
  // order they landed in is the one that applies cleanly. Ancestry is the
  // truth; commit timestamps only break ties between parallel branches, since
  // two commits in the same second are common (and broke the first version of
  // this sort).
  picks.sort((a, b) => {
    if (a.sha === b.sha) return 0;
    if (isAncestor(dir, a.sha, b.sha)) return -1;
    if (isAncestor(dir, b.sha, a.sha)) return 1;
    return a.timestamp - b.timestamp;
  });
  // Branch merges keep the order the user gave; they apply after all
  // cherry-picks.
  return { picks, merges, warnings, errors };
}
