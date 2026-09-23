/**
 * Promote Command
 *
 * The merge half of the release chain: fast-forward both branches, verify the
 * merge is clean without touching the working tree, then merge and push.
 *
 * Refuses on conflict. It never attempts a resolution — a stranded half-merged
 * checkout is the exact failure this replaces.
 *
 * Production is different in kind: it opens a reviewed release/X.Y.Z pull
 * request and stops. Nothing here merges it, and it is gated on the production
 * lock being lifted.
 */
import { Option } from 'commander';
import { existsSync } from 'fs';
import { join } from 'path';
import { getRepo } from '../config/repos.js';
import { repoDir } from '../config/workspace.js';
import { isClean, fetch as gitFetch, aheadBehind, trialMerge, mergeAndPush, syncLocalBranch, } from '../utils/git.js';
import { deployedTag, productionTag } from '../utils/deployments.js';
import { cutReleaseBranch, cutPickedBranch, releaseBranchName, RELEASE_KINDS, } from '../utils/release-branch.js';
import { resolvePicks } from '../utils/picks.js';
import { nextPatch, stripRc } from '../utils/version.js';
import { ORG } from '../utils/remote.js';
import { commitSubjects } from '../utils/changelog.js';
import { prNumbersInRange, prNumbersOfPicks, shippedPrs, resolveMentions, } from '../utils/shipped.js';
import { summarizePrs } from '../utils/pr-summary.js';
import { readSlackToken, readSlackChannel, slackUserOverride } from '../config/slack.js';
import { lookupUserByEmail, postMessage } from '../utils/slack.js';
import { buildReleaseMessage, releaseContributors } from '../utils/release-message.js';
import { createHeader, createErrorBox, log } from '../utils/ui.js';
/**
 * Fast-forward the local branches this promotion reads, and say what came in.
 *
 * A branch that has diverged locally is reported and skipped rather than
 * aborting: the promotion merges `origin/*`, so its correctness never depended
 * on the local ref being current.
 */
function syncBranches(repo, dir, to) {
    const branches = to === 'production'
        ? ['staging', 'production']
        : [repo.promoteFrom.staging, 'staging'].filter((b) => Boolean(b));
    for (const branch of branches) {
        try {
            const gained = syncLocalBranch(dir, branch);
            if (gained > 0)
                log.muted(`  pulled ${gained} new commit(s) into ${branch}`);
        }
        catch {
            log.warn(`${branch} has local commits that are not on origin/${branch} — leaving it alone. ` +
                `The promotion still uses origin/${branch}.`);
        }
    }
}
const defaultAnnounceDeps = {
    readSlackToken,
    readSlackChannel,
    slackUserOverride,
    lookupUserByEmail: (token, email) => lookupUserByEmail(token, email),
    postMessage: (token, channel, text, blocks) => postMessage(token, channel, text, fetch, blocks),
    shippedPrs: (repo, numbers) => shippedPrs(repo, numbers),
    summarizePrs,
    buildReleaseMessage,
};
/**
 * Tell the team a release PR is open.
 *
 * Runs only AFTER the PR exists, and never fails the promotion: by this point
 * the branch is pushed and the PR is open, so a missing token or an unreachable
 * Slack costs the announcement and nothing else. Every path that cannot post
 * prints the message instead, so the operator can paste it by hand.
 */
export async function announceRelease(repo, dir, kind, version, url, opts, deps = defaultAnnounceDeps) {
    const branch = releaseBranchName(kind, version);
    const picks = opts.picks ?? [];
    // On a dry run the branch was never cut, so the closest honest stand-in for
    // what it would carry is staging itself.
    const head = opts.dryRun ? 'origin/staging' : branch;
    const numbers = picks.length > 0 ? prNumbersOfPicks(picks) : prNumbersInRange(dir, 'origin/production', head);
    const prs = await deps.shippedPrs(repo.name, numbers);
    // Commit subjects back the message up when a PR could not be read — or when
    // the work landed without going through a PR at all. A dry-run pick has no
    // cut branch, and staging stands in for far more than was picked, so the
    // picks' own subjects are the honest fallback there.
    const fallbackSubjects = opts.dryRun && picks.length > 0
        ? picks.map((p) => p.subject)
        : commitSubjects(dir, 'origin/production', head);
    // Only what a summary needs: the model is never shown who wrote the PR.
    const summaries = await deps.summarizePrs(prs.map(({ number, title, branch }) => ({ number, title, branch })));
    const contributors = releaseContributors(prs);
    const mentions = await resolveMentions(contributors, {
        token: deps.readSlackToken(),
        lookup: deps.lookupUserByEmail,
        override: deps.slackUserOverride,
    });
    const { text, blocks } = deps.buildReleaseMessage({
        displayName: repo.displayName,
        branch,
        // No PR exists on a dry run; the repo's PR list is the nearest real link.
        prUrl: url ?? `https://github.com/${ORG}/${repo.name}/pulls`,
        prs,
        summaries,
        fallbackSubjects,
        mentions,
    });
    if (opts.dryRun) {
        console.log(createHeader('Slack message (dry run)', `${repo.displayName} | ${branch}`));
        console.log(text);
        // What is printed is the plain fallback; the post itself is a rich_text
        // bullet, and a reader of the dry run should not expect a typed "•".
        console.log('  (Slack renders this as a bulleted list item with real mentions and ticket links)');
        return;
    }
    const token = deps.readSlackToken();
    const channel = deps.readSlackChannel();
    if (!token || !channel) {
        console.log(text);
        log.warn('Slack not configured — run vast slack setup');
        return;
    }
    try {
        await deps.postMessage(token, channel, text, blocks);
        log.success(`announced in ${channel}`);
    }
    catch (error) {
        // Deliberately not a failure: the release PR is already open, and the
        // operator now has the exact text to post by hand.
        log.error(`could not announce in Slack: ${error instanceof Error ? error.message : String(error)}`);
        console.log(text);
    }
}
/**
 * @returns true when the promotion completed (or would have, under dryRun).
 *
 * Async because a production promotion derives its version from the live tag,
 * read over the API from Vast-deployments — or, while production is not
 * migrated, from the app repo's own Helm on `origin/production`.
 */
export async function promote(repo, dir, to, dryRun, kind = 'release', targetVersion, bodyMode = 'changelog', pickRefs = [], slack = false) {
    // Deliberately NOT gated on the production lock. Cutting a branch and opening
    // a PR ships nothing; the lock guards the deploy that follows the merge.
    if (!existsSync(join(dir, '.git'))) {
        console.log(createErrorBox(`${repo.name} is not cloned`, `Expected a checkout at ${dir}`));
        return false;
    }
    if (!isClean(dir)) {
        console.log(createErrorBox(`${repo.name} has uncommitted changes`, 'Commit or stash them before promoting.'));
        return false;
    }
    gitFetch(dir);
    // Bring the local branches up to date with what was just fetched. The merge
    // below reads origin/* either way, so this is about not leaving the checkout
    // sitting on a stale develop after the promotion.
    syncBranches(repo, dir, to);
    if (to === 'production') {
        if (!repo.deployments.staging) {
            console.log(createErrorBox(`${repo.name}: no staging deployments file`, 'Cannot derive a release version.'));
            return false;
        }
        if (pickRefs.length > 0) {
            const { picks, merges, warnings, errors } = resolvePicks(dir, ORG, repo.name, pickRefs);
            if (errors.length > 0) {
                console.log(createErrorBox(`${repo.name}: ${errors.length} pick(s) cannot be promoted`, errors.map((e) => `• ${e}`).join('\n')));
                return false;
            }
            if (picks.length === 0 && merges.length === 0) {
                console.log(createErrorBox(`${repo.name}: nothing to pick`, 'Every ref resolved to nothing.'));
                return false;
            }
            // The one loudly-permitted exception to the staging-only rule: a branch
            // cut from production skipped staging by definition.
            for (const w of warnings)
                log.warn(w);
            let version;
            // Production is not migrated, so the tag may come from the app repo's own
            // Helm; the line below says which, because the two can disagree.
            let versionNote = '';
            if (targetVersion) {
                version = targetVersion;
            }
            else {
                if (!repo.deployments.production) {
                    console.log(createErrorBox(`${repo.name}: no production deployments file`, 'Pass --target-version explicitly.'));
                    return false;
                }
                try {
                    // A selective promotion advances production's OWN tag — staging's
                    // version would claim content production did not receive.
                    const { tag, source } = await productionTag(repo, dir);
                    version = nextPatch(tag);
                    if (source === 'app-repo')
                        versionNote = ' (from app-repo Helm, production not migrated)';
                }
                catch (error) {
                    console.log(createErrorBox(`${repo.name}: cannot derive a hotfix version`, `${error instanceof Error ? error.message : String(error)}\n\n` +
                        `Re-run with an explicit version:\n` +
                        `    vast promote ${repo.name} --to production --pick ... --target-version X.Y.Z`));
                    return false;
                }
            }
            const what = [
                picks.length ? `${picks.length} pick(s)` : '',
                merges.length ? `${merges.length} branch merge(s)` : '',
            ]
                .filter(Boolean)
                .join(' + ');
            log.info(`${repo.name}: ${what} → production, ${kind} ${version}${versionNote}`);
            const url = cutPickedBranch(dir, repo.name, kind, version, picks, dryRun, bodyMode, merges);
            // A dry run never returns a URL, but it still has a message to show.
            if (slack && (url !== null || dryRun)) {
                await announceRelease(repo, dir, kind, version, url, { dryRun, picks });
            }
            if (url !== null) {
                // Deliberately not a `vast deploy` hint any more: production has not
                // moved to the new pipeline, so that command would only refuse.
                log.muted(`  after the PR is merged, deploy ${version} to production by hand`);
                if (merges.length > 0) {
                    log.warn(`port the fix back: merge ${merges.map((m) => m.name).join(', ')} into develop/staging too, or the bug stays there`);
                }
            }
            return url !== null || dryRun;
        }
        const { ahead } = aheadBehind(dir, 'origin/staging', 'origin/production');
        if (ahead === 0) {
            log.info(`${repo.name}: production already contains staging. Nothing to release.`);
            return true;
        }
        let version;
        if (targetVersion) {
            version = targetVersion;
        }
        else {
            try {
                version = stripRc(await deployedTag(repo, 'staging'));
            }
            catch (error) {
                console.log(createErrorBox(`${repo.name}: cannot derive a release version`, `${error instanceof Error ? error.message : String(error)}\n\n` +
                    `Re-run with an explicit version:\n` +
                    `    vast promote ${repo.name} --to production --target-version X.Y.Z`));
                return false;
            }
        }
        log.info(`${repo.name}: ${ahead} commit(s) staging → production, ${kind} ${version}`);
        const url = cutReleaseBranch(dir, repo.name, kind, version, dryRun, bodyMode);
        if (slack && (url !== null || dryRun)) {
            await announceRelease(repo, dir, kind, version, url, { dryRun });
        }
        return url !== null || dryRun;
    }
    const from = repo.promoteFrom.staging;
    if (!from) {
        console.log(createErrorBox(`Cannot promote ${repo.name} into staging`, `No promotion source is configured. ${repo.name} has no usable \`develop\` — ` +
            `human PRs there target \`staging\` directly, so merging \`develop\` would ` +
            `regress it by hundreds of commits.`));
        return false;
    }
    const { ahead } = aheadBehind(dir, `origin/${from}`, 'origin/staging');
    if (ahead === 0) {
        log.info(`${repo.name}: staging already contains ${from}. Nothing to promote.`);
        return true;
    }
    const trial = trialMerge(dir, 'origin/staging', `origin/${from}`);
    if (!trial.clean) {
        console.log(createErrorBox(`${repo.name}: ${from} → staging conflicts`, `${trial.conflicts.length} conflicting file(s):\n` +
            trial.conflicts.map((f) => `  • ${f}`).join('\n') +
            `\n\nNothing was changed. Resolve these before promoting.`));
        return false;
    }
    log.info(`${repo.name}: ${ahead} commit(s) from ${from} → staging, merge is clean`);
    if (dryRun) {
        log.muted('  (dry run — no merge performed)');
        return true;
    }
    mergeAndPush(dir, 'staging', `origin/${from}`);
    log.success(`${repo.name}: ${from} → staging pushed`);
    return true;
}
async function executePromote(repoName, options) {
    const repo = getRepo(repoName);
    if (!repo) {
        log.error(`Unknown repository: ${repoName}`);
        process.exit(1);
    }
    if (options.to !== 'staging' && options.to !== 'production') {
        log.error(`Invalid --to value: ${options.to}. Use staging or production.`);
        process.exit(1);
    }
    if (options.as !== undefined && !RELEASE_KINDS.includes(options.as)) {
        log.error(`Invalid --as value: ${options.as}. Use ${RELEASE_KINDS.join(' or ')}.`);
        process.exit(1);
    }
    if (options.pick?.length && options.to !== 'production') {
        log.error('--pick is production-only. Staging always promotes all of develop.');
        process.exit(1);
    }
    // There is nothing to announce about a staging promotion: it opens no PR,
    // and staging moves many times a day.
    if (options.slack && options.to !== 'production') {
        log.error('--slack is production-only. A staging promotion opens no release PR to announce.');
        process.exit(1);
    }
    // A selective promotion is definitionally a hotfix, so --pick flips the
    // default; --as still overrides either way.
    const kind = options.as ?? (options.pick?.length ? 'hotfix' : 'release');
    const label = options.to === 'production' ? `→ production (${kind})` : '→ staging';
    console.log(createHeader('Promote', `${repo.name} | ${label}`));
    // --no-changelog wins over --summarize: asking for no description at all is
    // the more specific request.
    const bodyMode = !options.changelog
        ? 'bare'
        : options.summarize || options.llm
            ? 'summarize'
            : 'changelog';
    const dir = repoDir(repo, options.dir);
    if (!dir) {
        console.log(createErrorBox(`${repo.name} is not cloned`, 'Run `vast init`, or clone it with `vast clone`.'));
        process.exit(1);
    }
    const ok = await promote(repo, dir, options.to, options.dryRun, kind, options.targetVersion, bodyMode, options.pick ?? [], options.slack ?? false);
    if (!ok)
        process.exit(1);
}
export function registerPromoteCommand(program) {
    program
        .command('promote')
        .description('Merge develop into staging, or open a release PR into production')
        .argument('<repository>', 'Repository name')
        .option('-t, --to <env>', 'Target environment: staging or production', 'staging')
        .option('--as <kind>', 'Production branch kind: release or hotfix (hotfix when --pick is used)')
        .option('-p, --pick <ref...>', 'Promote only these changes: commit SHA, PR number/#number, PR link, or commit link')
        .option('-v, --target-version <version>', 'Override the derived release version')
        .option('--no-changelog', 'Open the PR with a bare description, no change summary')
        .option('-s, --summarize', 'Describe the diff with a small local model instead of commits')
        .option('--slack', 'Announce the release PR in Slack')
        .addOption(new Option('--llm').hideHelp())
        .option('--dir <path>', 'Override the local checkout path')
        .option('-n, --dry-run', 'Report what would happen without merging', false)
        .addHelpText('after', `
Examples:
  $ vast promote VastPayPwa                             develop -> staging, push
  $ vast promote VastPayPwa --dry-run                   check conflicts, change nothing
  $ vast promote VastPayPwa --to production             cut release/X.Y.Z + PR
  $ vast promote VastPayPwa --to production --as hotfix cut hotfix/X.Y.Z + PR
  $ vast promote VastPayPwa --to production --no-changelog   bare PR description
  $ vast promote VastPayPwa --to production --slack     cut the PR, announce it
  $ vast promote VastPayPwa --to production --slack -n  print the message only

Slack announcement (--slack, production only):
  Runs after the release PR is open and posts one Slack bullet naming what
  shipped: a short summary of each PR in ascending PR order, everyone who
  worked on them, and any ClickUp ticket the PRs carried. People are
  @-mentioned when their commit email matches a Slack account; anyone it
  cannot match is named in plain text instead.

  It never fails the promotion. With no token or channel configured, and if
  Slack refuses the post, the message is printed for you to paste by hand and
  the promotion still succeeds — the PR is already open by then.

  With --dry-run nothing is sent: the message is printed as it would read,
  built from origin/production..origin/staging, since no branch exists yet.

  Configure it with \`vast slack setup\`.

PR description (production only):
  default          bullets from the commit subjects being promoted, grouped
                   into Features / Fixes / Improvements / Maintenance
  --summarize      a small local model reads the diff and describes it instead;
                   slower and not reproducible, but catches changes nobody
                   wrote a good commit message for. Falls back to the default
                   if it is unavailable or the output fails screening.
  --no-changelog   a one-line description

Descriptions never contain tool instructions or any note about how they were
produced — the whole team reads them.

Preparing a production release is NOT gated on anything — cutting a branch and
opening a PR ships nothing. The PR is opened for review and is never merged by
this tool.

The production DEPLOY that follows is currently blocked: production has not
moved to the new Vast-deployments + ArgoCD pipeline, so \`vast deploy --to
production\` refuses and the deploy is done by hand. Versions here are derived
from Vast-deployments (release = staging's tag without its -rc suffix; hotfix =
production's own tag plus a patch). Production is not migrated, so its tag is
usually read from the checkout's Helm/values-prod.yaml on origin/production
instead — the derived version says so when it is.
`)
        .action(executePromote);
}
//# sourceMappingURL=promote.js.map