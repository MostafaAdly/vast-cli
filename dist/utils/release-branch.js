/**
 * The production code path: a reviewed release/X.Y.Z or hotfix/X.Y.Z pull
 * request.
 *
 * Production is never merged into directly. The branch is cut from production,
 * staging is merged into it, and a PR is opened for review. Merging that PR is
 * a human action — nothing here does it, and nothing here can.
 *
 * Preparing a release is deliberately NOT gated on the production lock: cutting
 * a branch and opening a PR ships nothing. The lock guards the deploy that
 * comes after the PR is merged.
 */
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { stripRc } from './version.js';
import { trialMerge } from './git.js';
import { releaseBody } from './changelog.js';
import { log } from './ui.js';
const ORG_NAME = 'Vast-menu';
/**
 * staging and production always disagree on package.json's `version`, because
 * the deploy workflow rewrites it independently on each branch
 * (`jq '.version = "<input>"'`). Every staging -> production merge therefore
 * conflicts on exactly that one line, forever.
 *
 * This is generated metadata, not source. Rather than discard either side with
 * --ours/--theirs — which would silently drop real changes — the version line
 * on the release branch is aligned to staging's value BEFORE merging, so the
 * line is identical and git merges it cleanly. Any other conflict, including
 * anywhere else in package.json, still refuses.
 */
const GENERATED_VERSION_FILE = 'package.json';
function readVersionField(json) {
    return /"version"\s*:\s*"([^"]+)"/.exec(json)?.[1] ?? null;
}
function setVersionField(json, version) {
    return json.replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`);
}
/** Exported for tests only — these are internals, not API. */
export const __testing = { readVersionField, setVersionField };
export const RELEASE_KINDS = ['release', 'hotfix'];
function git(dir, args) {
    return execFileSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
}
export function releaseBranchName(kind, version) {
    return `${kind}/${stripRc(version)}`;
}
/** @returns the PR URL, or null if nothing was opened. */
export function cutReleaseBranch(dir, repo, kind, version, dryRun, bodyMode = 'changelog') {
    const branch = releaseBranchName(kind, version);
    const finalVersion = stripRc(version);
    const trial = trialMerge(dir, 'origin/production', 'origin/staging');
    // The version-field conflict is expected and is resolved by aligning, not by
    // discarding. Anything else is a real conflict and refuses.
    const onlyVersionConflict = !trial.clean &&
        trial.conflicts.length === 1 &&
        trial.conflicts[0] === GENERATED_VERSION_FILE;
    if (!trial.clean && !onlyVersionConflict) {
        log.error(`staging → production conflicts in ${trial.conflicts.length} file(s):`);
        for (const f of trial.conflicts)
            log.error(`  • ${f}`);
        return null;
    }
    if (dryRun) {
        if (onlyVersionConflict) {
            log.muted(`  (would align ${GENERATED_VERSION_FILE} version, then merge cleanly)`);
        }
        log.muted(`  (dry run — would cut ${branch} and open a PR into production)`);
        return null;
    }
    git(dir, ['checkout', '-B', branch, 'origin/production']);
    if (onlyVersionConflict) {
        const stagingVersion = readVersionField(git(dir, ['show', `origin/staging:${GENERATED_VERSION_FILE}`]));
        if (!stagingVersion) {
            log.error(`Could not read the version field from staging's ${GENERATED_VERSION_FILE}.`);
            return null;
        }
        const path = join(dir, GENERATED_VERSION_FILE);
        writeFileSync(path, setVersionField(readFileSync(path, 'utf-8'), stagingVersion), 'utf-8');
        git(dir, ['add', GENERATED_VERSION_FILE]);
        git(dir, [
            'commit',
            '-m',
            `chore: align ${GENERATED_VERSION_FILE} version with staging (${stagingVersion})`,
        ]);
        log.muted(`  aligned ${GENERATED_VERSION_FILE} to ${stagingVersion} so the merge is clean`);
    }
    git(dir, ['merge', '--no-edit', 'origin/staging']);
    git(dir, ['push', '-u', 'origin', branch]);
    const url = execFileSync('gh', [
        'pr',
        'create',
        '--repo',
        `${ORG_NAME}/${repo}`,
        '--base',
        'production',
        '--head',
        branch,
        '--title',
        `${kind}: ${finalVersion} to production`,
        '--body',
        // The audience is every reviewer on the team, most of whom do not use
        // this CLI. No tool instructions, no branding, no provenance note.
        releaseBody(dir, 'origin/production', branch, bodyMode),
    ], { encoding: 'utf-8' }).trim();
    log.success(`${repo}: opened ${url}`);
    return url;
}
//# sourceMappingURL=release-branch.js.map