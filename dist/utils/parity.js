/**
 * What one branch has that another lacks, by PR rather than by commit.
 *
 * Comparing commits is useless across these branches: merges, CI bumps and
 * cherry-picked hotfixes make staging and production differ by a hundred
 * commits that say nothing. A PR keeps its "Merge pull request #N" subject on
 * every branch it reaches, including as a cherry-picked copy, so PR numbers
 * are compared first. Whatever is left on one side is then checked by code
 * content (patch-id), which catches a fix ported back under a new commit.
 *
 * Git only: no network, nothing written.
 */
import { execFileSync } from 'child_process';
import { isPipelineNoise, isVehicleBranch, parsePrSubject } from './pr-subject.js';
const FIELD = '\x1f';
const RECORD = '\x1e';
const HELM_VALUES = /^Helm\/values-[^/]+\.ya?ml$/;
function git(dir, args, input) {
    return execFileSync('git', args, {
        cwd: dir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        input,
        maxBuffer: 256 * 1024 * 1024,
    });
}
function commitsIn(dir, base, head) {
    const out = git(dir, ['log', `${base}..${head}`, `--format=%H${FIELD}%P${FIELD}%ct${FIELD}%s`]);
    return out
        .split('\n')
        .filter(Boolean)
        .map((line) => {
        const [sha, parents, ct, ...rest] = line.split(FIELD);
        return {
            sha,
            parents: parents ? parents.split(' ') : [],
            landedAt: new Date(Number(ct) * 1000),
            subject: rest.join(FIELD),
        };
    });
}
/** Files each non-merge commit touched, in one git call rather than one per commit. */
function filesByCommit(dir, base, head) {
    const out = git(dir, ['log', '--no-merges', `--format=${RECORD}%H`, '--name-only', `${base}..${head}`]);
    const map = new Map();
    for (const chunk of out.split(RECORD)) {
        const [sha, ...files] = chunk.split('\n').map((s) => s.trim()).filter(Boolean);
        if (sha)
            map.set(sha, files);
    }
    return map;
}
/** Patch-ids of every non-merge commit in the range, in one pipe. */
function patchIdsOfCommits(dir, base, head) {
    const map = new Map();
    const log = git(dir, ['log', '-p', '--format=commit %H', '--no-merges', '--no-color', `${base}..${head}`]);
    if (!log.trim())
        return map;
    for (const line of git(dir, ['patch-id', '--stable'], log).split('\n')) {
        const [patchId, sha] = line.trim().split(/\s+/);
        if (patchId && sha)
            map.set(sha, patchId);
    }
    return map;
}
/** A merge's patch-id is that of its whole change against the branch it landed on. */
function patchIdOfMerge(dir, merge) {
    const diff = git(dir, ['diff', '--no-color', '--no-ext-diff', merge.parents[0], merge.sha]);
    if (!diff.trim())
        return null;
    return git(dir, ['patch-id', '--stable'], diff).trim().split(/\s+/)[0] || null;
}
/**
 * Version bumps and deploy-tag edits that carry no product change: commits
 * touching only Helm values files, or only package.json's version line.
 */
function isBookkeeping(dir, sha, files) {
    if (files.length === 0)
        return false;
    if (files.every((f) => HELM_VALUES.test(f)))
        return true;
    if (files.every((f) => f === 'package.json' || f === 'package-lock.json') && files.includes('package.json')) {
        const diff = git(dir, ['diff-tree', '--no-commit-id', '-p', '-U0', sha, '--', 'package.json']);
        const changed = diff.split('\n').filter((l) => /^[+-](?![+-])/.test(l));
        return changed.length > 0 && changed.every((l) => /"version"\s*:/.test(l));
    }
    return false;
}
function readSide(dir, base, head) {
    const commits = commitsIn(dir, base, head);
    const files = filesByCommit(dir, base, head);
    const patchIds = patchIdsOfCommits(dir, base, head);
    // Commits a PR merge brought in belong to that PR, not to the direct list.
    // Vehicles own nothing: a hotfix's picks are PRs in their own right, and a
    // fix typed straight onto the hotfix branch is genuine direct work.
    const owned = new Set();
    const prs = new Map();
    for (const c of commits) {
        const pr = parsePrSubject(c.subject);
        if (!pr || isVehicleBranch(pr.branch))
            continue;
        const isMerge = c.parents.length >= 2;
        if (isMerge) {
            for (const sha of git(dir, ['rev-list', `${c.parents[0]}..${c.parents[1]}`]).split('\n')) {
                if (sha)
                    owned.add(sha);
            }
        }
        const unit = {
            number: pr.number,
            branch: pr.branch,
            sha: c.sha,
            landedAt: c.landedAt,
            patchId: isMerge ? patchIdOfMerge(dir, c) : (patchIds.get(c.sha) ?? null),
        };
        // A PR merged and later cherry-picked onto the same branch is one PR,
        // landed when it first arrived.
        const seen = prs.get(pr.number);
        if (!seen || unit.landedAt < seen.landedAt)
            prs.set(pr.number, unit);
    }
    const direct = [];
    for (const c of commits) {
        if (c.parents.length >= 2)
            continue; // PR merges handled above; other merges carry no work of their own
        if (parsePrSubject(c.subject))
            continue; // cherry-picked PR merges, vehicles included
        if (owned.has(c.sha))
            continue;
        if (isPipelineNoise(c.subject) || isBookkeeping(dir, c.sha, files.get(c.sha) ?? []))
            continue;
        direct.push({ sha: c.sha, subject: c.subject, landedAt: c.landedAt, patchId: patchIds.get(c.sha) ?? null });
    }
    return {
        prs: [...prs.values()].sort((a, b) => a.number - b.number),
        direct: direct.sort((a, b) => a.landedAt.getTime() - b.landedAt.getTime()),
    };
}
function withPorted(side, other) {
    const otherIds = new Set([...other.prs, ...other.direct].map((i) => i.patchId).filter((p) => p !== null));
    const ported = new Set([...side.prs, ...side.direct].filter((i) => i.patchId !== null && otherIds.has(i.patchId)).map((i) => i.sha));
    return { ...side, ported };
}
export function compareBranches(dir, source, target) {
    const src = readSide(dir, target, source);
    const tgt = readSide(dir, source, target);
    const inTarget = new Set(tgt.prs.map((p) => p.number));
    const inSource = new Set(src.prs.map((p) => p.number));
    const onlySrc = { prs: src.prs.filter((p) => !inTarget.has(p.number)), direct: src.direct };
    const onlyTgt = { prs: tgt.prs.filter((p) => !inSource.has(p.number)), direct: tgt.direct };
    return {
        source,
        target,
        onlySource: withPorted(onlySrc, onlyTgt),
        onlyTarget: withPorted(onlyTgt, onlySrc),
        sharedPrs: src.prs.filter((p) => inTarget.has(p.number)).map((p) => p.number),
    };
}
//# sourceMappingURL=parity.js.map