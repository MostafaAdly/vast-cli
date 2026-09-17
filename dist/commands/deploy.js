/**
 * Deploy Command
 *
 * Dispatches a version to an environment and follows it all the way to the
 * cluster.
 *
 * Staging is GitOps now: `build-deploy` builds the image and commits the tag
 * into Vast-deployments, ArgoCD notices and rolls it out. There is no bump PR
 * to merge any more — merging one was the old definition of "released", and
 * after the migration it would have meant merging into a file nothing watches.
 * So a deploy is only finished when ArgoCD reports the new tag Synced/Healthy.
 *
 * Production is the same code and the same shape, but its workflow inputs and
 * folder names are unverified assumptions, so it is refused outright (see
 * `production-lock.ts`).
 */
import inquirer from 'inquirer';
import { argoApp, getRepo, reposForRelease, } from '../config/repos.js';
import { productionRefusal } from '../config/production-lock.js';
import { argocdAppUrl, argocdHost, readArgocdToken } from '../config/argocd.js';
import { ArgoUnauthorizedError, DEFAULT_ROLLOUT_TIMING, getApplication, rolloutDone, waitForRollout, } from '../utils/argocd.js';
import { deployedTag } from '../utils/deployments.js';
import { nextRc, stripRc } from '../utils/version.js';
import { fetchBranches, isAncestor, refExists } from '../utils/git.js';
import { notify } from '../utils/notify.js';
import { failedStepName, getRunStatus, runUrl, runWorkflow } from '../utils/github.js';
import { ORG } from '../utils/remote.js';
import { DEFAULT_TIMING, formatElapsed, pollRun } from '../utils/run-poll.js';
import { createStatusBoard } from '../utils/status-board.js';
import { createHeader, createErrorBox, log } from '../utils/ui.js';
import { repoDir } from '../config/workspace.js';
export function isSweep(s) {
    return s.all || s.frontend || s.backend;
}
/** Repos a sweep or a list of names resolves to, deduplicated, in order. */
export function sweepTargets(names, sweep) {
    if (isSweep(sweep)) {
        const trains = sweep.all
            ? ['frontend', 'backend']
            : [
                ...(sweep.frontend ? ['frontend'] : []),
                ...(sweep.backend ? ['backend'] : []),
            ];
        const swept = [];
        for (const train of trains) {
            for (const repo of reposForRelease(train))
                if (!swept.includes(repo))
                    swept.push(repo);
        }
        return { repos: swept, unknown: [] };
    }
    const repos = [];
    const unknown = [];
    for (const name of names) {
        const repo = getRepo(name);
        if (!repo)
            unknown.push(name);
        else if (!repos.includes(repo))
            repos.push(repo);
    }
    return { repos, unknown };
}
/**
 * Repos `vast deploy` acts on. `--all` is every repo on a release train, so an
 * unreleasable repo (no workflow / no deployments file) can never fail a sweep
 * the user was not asking about; a repo named explicitly is never filtered, so
 * `vast deploy Terraform` still says "no deploy workflow" rather than "unknown
 * repository".
 */
export function deployTargets(names, sweep) {
    return sweepTargets(names, sweep);
}
/** Naming repos and sweeping a train at the same time cannot mean anything. */
export function sweepAndNamesProblem(names, sweep) {
    if (isSweep(sweep) && names.length > 0) {
        return 'Pass repository names or a sweep flag (--all, --frontend, --backend), not both.';
    }
    return null;
}
/**
 * The options that name exactly one thing, refused when more than one repo is
 * in play. A repo named twice is still one repo, so the count is of distinct
 * names — matching how the targets dedupe, casing and all.
 */
export function perRepoOptionProblem(names, options) {
    const many = isSweep(options) || new Set(names.map((n) => n.toLowerCase())).size > 1;
    if (many && options.targetVersion) {
        return '--target-version is per repository — each repo derives its own. It cannot be used with a sweep flag or more than one repository.';
    }
    if (many && options.dir) {
        return '--dir names one checkout, so it cannot be used with a sweep flag or more than one repository.';
    }
    return null;
}
export function validateDeployOptions(names, options) {
    return sweepAndNamesProblem(names, options) ?? perRepoOptionProblem(names, options);
}
/**
 * The outcome for a repo that is not on this machine.
 *
 * Not being cloned is a normal state on a portable CLI — a frontend teammate
 * has no backend checkouts — so a sweep skips it. Naming that repo explicitly
 * is different: the user asked for something specific they do not have, and
 * that IS an error.
 */
export function notClonedOutcome(repo, all) {
    return {
        repo,
        version: '—',
        status: all ? 'skipped' : 'failed',
        detail: all
            ? 'not cloned — get it with `vast clone`'
            : 'not cloned — run `vast init`, or clone it with `vast clone`',
    };
}
/**
 * The human gate, asked directly: was the PR for THIS version merged?
 *
 * The old check — "production contains everything staging has" — was a proxy
 * that a selective (--pick) promotion makes permanently false, because leaving
 * things out is the point. Checking that release/<v> or hotfix/<v> is an
 * ancestor of origin/production verifies exactly what matters for BOTH flows:
 * a human reviewed and merged this version's PR.
 */
export async function verifyReleaseMerged(dir, version) {
    let v;
    try {
        v = stripRc(version);
    }
    catch {
        v = version; // unparseable target-version: branch names use it verbatim
    }
    await fetchBranches(dir, ['production', `release/${v}`, `hotfix/${v}`]);
    for (const kind of ['release', 'hotfix']) {
        const ref = `origin/${kind}/${v}`;
        if (!refExists(dir, ref))
            continue;
        if (isAncestor(dir, ref, 'origin/production')) {
            return { ok: true, detail: `${kind}/${v} is merged into production` };
        }
        return { ok: false, detail: `${kind}/${v} exists but its PR is not merged — merge it first` };
    }
    return {
        ok: false,
        detail: `no release/${v} or hotfix/${v} branch on origin — cut one with \`vast promote --to production\``,
    };
}
/**
 * The version to deploy to `env`, given the tag currently on staging.
 *
 * Production ships what has been baking in staging, with the candidate suffix
 * dropped: staging 2.1.0-rc45 -> production 2.1.0.
 */
export function versionFor(env, stagingTag) {
    return env === 'production' ? stripRc(stagingTag) : nextRc(stagingTag);
}
export async function confirmProduction(repo, version) {
    const { ok } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'ok',
            message: `Deploy ${repo} ${version} to PRODUCTION?`,
            default: false,
        },
    ]);
    return ok;
}
export const DEFAULT_DEPLOY_DEPS = {
    runWorkflow,
    getRunStatus,
    failedStepName,
    waitForRollout,
    getApplication,
    readArgocdToken,
    argocdHost,
    argocdAppUrl,
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * One repo, dispatch to rollout, reported on one line of the board.
 *
 * Nothing here may print directly: on a TTY the board tracks the cursor by
 * counting its own lines, so one stray `console.log` scrolls the rows out from
 * under it and every later update lands on the wrong line. That is also why the
 * dispatch is quiet — the spinner would do exactly that.
 */
export async function deployOne(repo, env, version, dryRun, slot, timing = DEFAULT_TIMING, deps = DEFAULT_DEPLOY_DEPS) {
    const label = repo.name.padEnd(slot.labelWidth);
    const say = (line, tone) => slot.board.update(slot.row, line, tone);
    const outcome = (status, detail) => ({
        repo: repo.name,
        version,
        status,
        detail,
    });
    const workflow = repo.workflow[env];
    if (!workflow) {
        say(`  ${label}  no deploy workflow exists`, 'muted');
        return outcome('skipped', 'no deploy workflow exists');
    }
    const app = argoApp(repo, env);
    if (!app) {
        say(`  ${label}  no ${env} deployments file`, 'muted');
        return outcome('skipped', `no ${env} deployments file — nothing watches this repo`);
    }
    say(`  ${label}  ${version} → ${env}`, 'muted');
    if (dryRun)
        return outcome('skipped', 'dry run');
    // Refuse BEFORE dispatching. A build we cannot confirm is worse than no
    // build: the image would be pushed and the tag committed while the CLI
    // reports a failure, and the next person would have no idea whether the
    // cluster took it.
    const token = deps.readArgocdToken(env);
    if (!token) {
        const why = `no ArgoCD token for ${env} — run \`vast argocd login\``;
        say(`  ${label}  ${why}`, 'error');
        return outcome('failed', why);
    }
    const host = deps.argocdHost(env);
    const appUrl = deps.argocdAppUrl(env, app);
    // One read before anything is built, for two reasons. It is the cheapest
    // possible token check — an expired token costs nothing here and costs an
    // orphaned image and tag if it is only discovered after the build. And it
    // tells us whether this exact tag is ALREADY live: `rolloutDone` is a
    // snapshot, so without this the waiter would return ok on its first read and
    // report a release that never happened. Re-deploying a live version is the
    // documented retry for a run that failed committing the tag, so this is the
    // common case rather than a corner one.
    let before;
    try {
        before = await deps.getApplication(host, token, app);
    }
    catch (error) {
        if (error instanceof ArgoUnauthorizedError) {
            const why = 'argocd unauthorized — run `vast argocd login`';
            say(`  ${label}  ${why}`, 'error');
            return outcome('failed', why);
        }
        // Any other read failure only costs us the snapshot. Refusing to deploy
        // because ArgoCD blipped would be the worse trade.
    }
    const alreadyLive = before !== undefined && rolloutDone(before, version);
    const dispatched = await deps.runWorkflow({ repository: repo.name, version, branch: env, workflowName: workflow }, { quiet: true });
    if (!dispatched.success) {
        const why = dispatched.error ?? 'the deploy workflow could not be dispatched';
        say(`  ${label}  ${why}`, 'error');
        return outcome('failed', why);
    }
    if (!dispatched.runId) {
        // The dispatch DID land; only finding the run timed out. Saying "could not
        // identify the dispatched run" read as "nothing happened", and the honest
        // hazard is the opposite: a build is running and will commit a tag, so a
        // blind re-run would race it.
        const why = `dispatched, but its run could not be identified — check ` +
            `https://github.com/${ORG}/${repo.name}/actions and re-run ` +
            `\`vast deploy ${repo.name} --target-version ${version}\` only if nothing is running`;
        say(`  ${label}  ${why}`, 'error');
        return outcome('failed', why);
    }
    const runId = dispatched.runId;
    const url = runUrl(repo.name, runId);
    const run = await pollRun(label, runId, {
        getStatus: () => deps.getRunStatus(repo.name, runId),
        sleep,
        now: Date.now,
        print: (line) => say(line, 'muted'),
    }, timing);
    const ranFor = formatElapsed(run.elapsedMs);
    if (!run.ok) {
        // A run that could not be read has no conclusion to name and no useful run
        // page to point at, so the line carries the read error instead.
        if (run.error) {
            say(`  ${label}  run ${runId}  unreadable  ${ranFor}  ${run.error}`, 'error');
            return outcome('failed', `${run.error} — ${url}`);
        }
        const word = run.conclusion === 'failure' ? 'failed' : (run.conclusion ?? 'completed without a conclusion');
        // The tag commit is the last step and a different problem from a failed
        // build: the image is usually already pushed, so the retry is cheap and the
        // cluster may be one commit away from the version the user asked for.
        const step = await deps.failedStepName(repo.name, runId);
        const detail = step?.includes('update-helm')
            ? `run ${runId} failed committing the tag — image may already be built — ${url}`
            : `run ${runId} ${word} — ${url}`;
        say(`  ${label}  run ${runId}  ${word}  ${ranFor}  ${url}`, 'error');
        return outcome('failed', detail);
    }
    // When the tag was already live the waiter cannot use the tag alone, so it is
    // given a predicate that also demands ArgoCD moved to a new revision. Said
    // out loud, because otherwise the wait looks like a hang on a green app.
    const wasAt = before?.revision;
    if (alreadyLive) {
        say(`  ${label}  argocd ${app}  ${version} already live — waiting for a new sync  0s`, 'muted');
    }
    const rollout = await deps.waitForRollout(label, app, version, {
        getApp: () => deps.getApplication(host, token, app),
        sleep,
        now: Date.now,
        print: (line) => say(line, 'muted'),
    }, deps.rolloutTiming ?? DEFAULT_ROLLOUT_TIMING, alreadyLive
        ? (current) => rolloutDone(current, version) && current.revision !== wasAt
        : (current) => rolloutDone(current, version));
    const rolledFor = formatElapsed(rollout.elapsedMs);
    if (!rollout.ok) {
        const why = rollout.reason ?? 'rollout did not complete';
        say(`  ${label}  argocd ${app}  ${why}  ${rolledFor}  ${appUrl}`, 'error');
        return outcome('failed', `${version} built, but ${why} — ${appUrl}`);
    }
    say(`  ${label}  argocd ${app}  Synced/Healthy  ${rolledFor}  ${appUrl}`, 'success');
    return outcome('released', `${version} live on ${app} — ${appUrl}`);
}
export function printSummary(outcomes, env) {
    log.newline();
    console.log(createHeader('Summary', ''));
    const width = Math.max(...outcomes.map((o) => o.repo.length), 4);
    for (const o of outcomes) {
        const icon = o.status === 'released' ? '✓' : o.status === 'skipped' ? '–' : '✗';
        console.log(`  ${icon} ${o.repo.padEnd(width)}  ${o.version.padEnd(14)}  ${o.detail}`);
    }
    const released = outcomes.filter((o) => o.status === 'released');
    const failed = outcomes.filter((o) => o.status === 'failed');
    if (released.length || failed.length) {
        notify(`**Deploy → ${env}**\n` +
            released.map((o) => `✓ ${o.repo} ${o.version}`).join('\n') +
            (failed.length ? `\n${failed.map((o) => `✗ ${o.repo} — ${o.detail}`).join('\n')}` : ''));
    }
}
/**
 * How often to ask GitHub for each run's status, given how many are being
 * watched. One second per run keeps a big sweep from hammering the API with one
 * request per run every five seconds, and the floor keeps the common two- or
 * three-repo deploy as responsive as a single one.
 */
export function pollIntervalFor(runCount) {
    return Math.max(5000, 1000 * runCount);
}
/**
 * The polling timing for a whole watch, live or piped.
 *
 * When the board is live each repo owns one line that is rewritten in place, so
 * a heartbeat on every poll costs no scrollback and keeps the elapsed time on
 * every line moving. Piped output appends instead, so it keeps the slow default
 * heartbeat rather than one line per repo every few seconds.
 */
export function pollTimingFor(runCount, live) {
    const pollMs = pollIntervalFor(runCount);
    return {
        pollMs,
        heartbeatMs: live ? pollMs : DEFAULT_TIMING.heartbeatMs,
        maxConsecutiveErrors: DEFAULT_TIMING.maxConsecutiveErrors,
    };
}
export function isOutcome(x) {
    return 'status' in x;
}
/**
 * Several repos at once, each on its own line of one shared board.
 *
 * One board for every repo: two would each believe they own the cursor.
 * allSettled rather than all, so one repo's watch throwing cannot swallow the
 * outcomes of the repos that finished fine — that is the whole promise of the
 * multi-repo path, so it is structural here rather than a matter of every
 * caller downstream remembering to catch. Outcomes come back in the order the
 * repos were given, so the summary reads the way the command was typed.
 */
export async function deployMany(planned, env, dryRun, deps = {}) {
    const live = process.stdout.isTTY === true;
    const going = planned.filter((p) => !isOutcome(p));
    const timing = pollTimingFor(going.length, live);
    const every = Math.round(timing.pollMs / 1000);
    if (going.length > 0 && !dryRun) {
        log.newline();
        log.info(live
            ? `Watching ${going.length} deploy(s) — status every ${every}s`
            : `Watching ${going.length} deploy(s) — status every ${every}s, ` +
                'one line per change, heartbeat every 30s');
    }
    const labelWidth = Math.max(...going.map((g) => g.repo.name.length), 0);
    const board = (deps.board ?? createStatusBoard)(going.length);
    const run = deps.deploy ?? deployOne;
    const settled = await Promise.allSettled(going.map((g, i) => run(g.repo, env, g.version, dryRun, { board, row: i, labelWidth }, timing)));
    const finished = settled.map((r, i) => r.status === 'fulfilled'
        ? r.value
        : {
            repo: going[i].repo.name,
            version: going[i].version,
            status: 'failed',
            detail: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
    let next = 0;
    return planned.map((p) => (isOutcome(p) ? p : finished[next++]));
}
async function executeDeploy(repoNames, options) {
    const problem = validateDeployOptions(repoNames, options);
    if (problem) {
        log.error(problem);
        process.exit(1);
    }
    if (options.to !== 'staging' && options.to !== 'production') {
        log.error(`Invalid --to value: ${options.to}. Use staging or production.`);
        process.exit(1);
    }
    // One shared gate: the pipeline block before the lock, ordered inside
    // `productionRefusal` so no caller can get it the wrong way round.
    const refusal = productionRefusal(options.to);
    if (refusal) {
        console.log(createErrorBox('Production deploys are blocked', refusal));
        process.exit(1);
    }
    const { repos: targets, unknown } = deployTargets(repoNames, options);
    if (unknown.length > 0) {
        log.error(`Unknown ${unknown.length === 1 ? 'repository' : 'repositories'}: ${unknown.join(', ')}`);
        process.exit(1);
    }
    if (targets.length === 0) {
        log.error('Specify a repository, or --all / --frontend / --backend');
        process.exit(1);
    }
    console.log(createHeader('Deploy', `${targets.length} repo(s) | → ${options.to}`));
    // Versions and gates first, one repo at a time: deriving a version is a
    // read, and the production confirmation is a prompt, neither of which can
    // share a screen with the board that follows.
    const planned = [];
    for (const repo of targets) {
        let version;
        if (options.targetVersion) {
            version = options.targetVersion;
        }
        else {
            try {
                version = versionFor(options.to, await deployedTag(repo, 'staging'));
            }
            catch (error) {
                planned.push({
                    repo: repo.name,
                    version: '—',
                    status: 'failed',
                    detail: error instanceof Error ? error.message : String(error),
                });
                continue;
            }
        }
        // Production only: refuse if this version's PR has not been merged yet.
        // The checkout is needed for nothing else now — the deployed tag comes from
        // Vast-deployments, not from a local Helm file.
        if (options.to === 'production' && !options.dryRun) {
            const dir = repoDir(repo, options.dir);
            if (!dir) {
                planned.push(notClonedOutcome(repo.name, isSweep(options)));
                continue;
            }
            const gate = await verifyReleaseMerged(dir, version);
            if (!gate.ok) {
                planned.push({ repo: repo.name, version, status: 'failed', detail: gate.detail });
                continue;
            }
            if (!(await confirmProduction(repo.name, version))) {
                planned.push({ repo: repo.name, version, status: 'skipped', detail: 'declined' });
                continue;
            }
        }
        planned.push({ repo, version });
    }
    const outcomes = await deployMany(planned, options.to, options.dryRun);
    printSummary(outcomes, options.to);
    if (outcomes.some((o) => o.status === 'failed'))
        process.exit(1);
}
/** The train members, listed from the config so the help can never drift from it. */
function trainNames(team) {
    return reposForRelease(team)
        .map((r) => r.name)
        .join(', ');
}
export function registerDeployCommand(program) {
    program
        .command('deploy')
        .description('Dispatch a version and wait for ArgoCD to roll it out')
        .argument('[repositories...]', 'Repository name(s) (omit and pass --all, --frontend or --backend)')
        .option('-t, --to <env>', 'Target environment: staging or production', 'staging')
        .option('-a, --all', 'Deploy the frontend and backend repos', false)
        .option('--frontend', 'Deploy the frontend repos', false)
        .option('--backend', 'Deploy the backend repos', false)
        .option('--dir <path>', 'Override the local checkout path (one repo only)')
        .option('-v, --target-version <version>', 'Override the derived version (one repo only)')
        .option('-n, --dry-run', 'Report what would happen without deploying', false)
        .addHelpText('after', `
Deploys what is already on the branch — it does not promote first.
Use \`vast release\` for promote-then-deploy on staging.

What a deploy does now (there is no version-bump PR any more):

  1. dispatch build-deploy, which builds the image and commits the tag
     into Vast-deployments
  2. watch the run
  3. watch ArgoCD until that tag is Synced/Healthy on the app

Step 3 needs an ArgoCD session token, so log in once per token lifetime:

  $ vast argocd login              store a staging token
  $ vast argocd status             is it still valid?

Without a token the deploy refuses BEFORE dispatching, so a build is never
started that could not be confirmed.

  $ vast deploy VastPayPwa             one repo
  $ vast deploy VastPayPwa VastMenuPwa both at once, one summary
  $ vast deploy --frontend             the frontend repos, side by side
  $ vast deploy --backend              the backend repos
  $ vast deploy --all                  frontend and backend, one summary
  $ vast deploy VastPayPwa --dry-run   show the derived version, deploy nothing

Release trains (--all is both):
  --frontend   ${trainNames('frontend')}
  --backend    ${trainNames('backend')}
vast-menu-payments is in neither train — deploy it by name.

--target-version and --dir are per-repo and refused with a sweep flag or more
than one repository.

PRODUCTION IS BLOCKED. It has not moved to the new pipeline, so this command
refuses --to production outright — before the production lock is even read.
\`vast promote --to production\` still cuts the release PR; the deploy itself is
done by hand until DevOps has migrated it.
`)
        .action(executeDeploy);
}
//# sourceMappingURL=deploy.js.map