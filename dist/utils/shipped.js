/**
 * What actually shipped in a release, expressed as the PRs it carries.
 *
 * The Slack announcement is read by people who do not read commit logs, so it
 * is built from PRs and the people who wrote them rather than from raw
 * subjects. The PR numbers come out of the commit subjects already in the
 * branch — the same
 * source `skills/release/notes.sh` uses, and for the same reason: `gh search
 * commits` only indexes a repo's default branch, which here is `production`,
 * so it is blind to everything a release is made of.
 *
 * Every function here degrades rather than throws. The PR is already open by
 * the time any of this runs; a failed lookup costs the message a line, and
 * must never cost the release its announcement.
 */
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import { ORG } from './remote.js';
import { contributorKey, isBotEmail, isExcludedContributor, mergeContributors, } from './contributors.js';
import { isBumpBranch, parsePrSubject } from './pr-subject.js';
const execFileAsync = promisify(execFile);
function prNumberOfSubject(subject) {
    const pr = parsePrSubject(subject);
    // The CI's own bump PRs describe the pipeline, not the product — the same
    // exclusion notes.sh makes.
    if (!pr || isBumpBranch(pr.branch))
        return null;
    return pr.number;
}
/** Unique, ascending — the order a reader scans a list of PR numbers in. */
function tidyNumbers(numbers) {
    return [...new Set(numbers)].sort((a, b) => a - b);
}
/**
 * PR numbers carried by `head` that `base` does not have.
 *
 * Every commit is read, not just `--merges`. A hotfix built with `--pick`
 * carries each PR as a cherry-pick of its merge commit: an ordinary one-parent
 * commit whose subject still reads "Merge pull request #328 from …". Reading
 * only real merges found nothing on such a branch, and the announcement fell
 * back to raw subjects with nobody credited.
 */
export function prNumbersInRange(dir, base, head) {
    let out;
    try {
        out = execFileSync('git', ['log', `${base}..${head}`, '--pretty=format:%s'], {
            cwd: dir,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });
    }
    catch {
        // An unknown ref or an empty repo is a message without PR lines, not a
        // failed promotion.
        return [];
    }
    const numbers = out
        .split('\n')
        .map(prNumberOfSubject)
        .filter((n) => n !== null);
    // A PR merged on the branch and also cherry-picked onto it is still one PR.
    return tidyNumbers(numbers);
}
/**
 * PR numbers carried by a selective promotion.
 *
 * A `--pick` of a PR resolves to that PR's merge commit, so its subject names
 * the PR just as the range version does. Picks that are plain commits simply
 * contribute nothing.
 */
export function prNumbersOfPicks(picks) {
    const numbers = picks
        .map((p) => prNumberOfSubject(p.subject))
        .filter((n) => n !== null);
    return tidyNumbers(numbers);
}
/**
 * GitHub's own no-reply addresses belong to GitHub, not to a person, so they
 * can never match a Slack account.
 */
function usableEmail(email) {
    return Boolean(email && email.trim() && !/noreply/i.test(email));
}
/** Commit authors pooled per person, in the order they first appear. */
function commitAuthors(view) {
    const byKey = new Map();
    for (const commit of view.commits ?? []) {
        for (const a of commit.authors ?? []) {
            // Before usableEmail drops it: a no-reply address is also how an AI
            // co-author (a Co-Authored-By trailer GitHub lists as an author) is told apart.
            if (isBotEmail(a.email))
                continue;
            const person = { name: a.name ?? '', login: a.login || null, emails: [] };
            const key = contributorKey(person);
            if (!key)
                continue;
            const seen = byKey.get(key) ?? { ...person, commits: 0 };
            seen.commits += 1;
            if (!seen.login && person.login)
                seen.login = person.login;
            if (usableEmail(a.email) && !seen.emails.includes(a.email))
                seen.emails.push(a.email);
            byKey.set(key, seen);
        }
    }
    return [...byKey.values()];
}
/**
 * Which commit author is the PR author in git's eyes.
 *
 * GitHub often knows the PR author only by login, while their commits carry a
 * name and an email but no login. A commit author whose login matches is them
 * outright; failing that, the loginless author of most of the commits is taken
 * to be them. Anyone with a different login, or on the exclusion list, is
 * never picked — otherwise a PR author could be renamed after a colleague, or
 * vanish under an excluded person's name.
 */
function ownerOf(authorLogin, authors) {
    const login = authorLogin.toLowerCase();
    if (login) {
        const exact = authors.find((a) => a.login?.toLowerCase() === login);
        if (exact)
            return exact;
    }
    let best = null;
    for (const a of authors) {
        if (a.login || isExcludedContributor(a))
            continue;
        if (!best || a.commits > best.commits)
            best = a;
    }
    return best;
}
/**
 * `gh pr view --json number,title,url,author,headRefName,commits` output ->
 * the PR as the announcement needs it. Null when the output is not a PR.
 */
export function parseGhPrView(json) {
    let view;
    try {
        view = JSON.parse(json);
    }
    catch {
        return null;
    }
    if (!view || typeof view !== 'object')
        return null;
    return prFromView(view);
}
function prFromView(view) {
    const authorLogin = view.author?.login ?? '';
    const authorName = view.author?.name ?? '';
    const authors = commitAuthors(view);
    // An excluded PR author is dropped anyway, so lending them a commit
    // author's identity would only hide that commit author from the list.
    const authorExcluded = isExcludedContributor({ name: authorName, login: authorLogin || null, emails: [] });
    const owner = authorExcluded ? null : ownerOf(authorLogin, authors);
    const prAuthor = authorLogin || authorName
        ? [
            {
                // GitHub display names are optional; the login is always there.
                name: authorName || owner?.name || authorLogin,
                login: authorLogin || null,
                emails: owner ? [...owner.emails] : [],
            },
        ]
        : [];
    const others = authors
        .filter((a) => a !== owner)
        .map((a) => ({ name: a.name, login: a.login, emails: a.emails }));
    return {
        title: view.title ?? '',
        url: view.url ?? '',
        branch: view.headRefName ?? '',
        contributors: mergeContributors([prAuthor, others]),
    };
}
/**
 * A GraphQL PR in `gh pr view`'s shape, so both go through one parser and the
 * contributor rules cannot drift apart. `gh pr view` itself maps it the same
 * way: an app author becomes `app/<login>`, a commit author's login is their
 * GitHub user's, and a missing name is empty.
 */
function viewOfGraphql(pr) {
    const author = pr.author ?? undefined;
    return {
        title: pr.title,
        url: pr.url,
        headRefName: pr.headRefName,
        author: author
            ? { login: author.__typename === 'Bot' ? `app/${author.login ?? ''}` : (author.login ?? ''), name: author.name ?? '' }
            : undefined,
        commits: (pr.commits?.nodes ?? []).map((n) => ({
            authors: (n?.commit?.authors?.nodes ?? []).map((a) => ({
                name: a.name ?? '',
                email: a.email ?? '',
                login: a.user?.login ?? '',
            })),
        })),
    };
}
/**
 * PRs per GraphQL query: few round trips, and inside GitHub's 500,000-node
 * limit — 50 PRs x 100 commits x 20 authors each is 100,000.
 */
const PRS_PER_QUERY = 50;
const PR_FIELDS = 'title url headRefName author { __typename login ... on User { name } } ' +
    'commits(first: 100) { nodes { commit { authors(first: 20) { nodes { name email user { login } } } } } }';
export function buildPrQuery(numbers) {
    const fields = numbers.map((n) => `pr${n}: pullRequest(number: ${n}) { ${PR_FIELDS} }`).join(' ');
    return `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`;
}
/**
 * `gh api graphql` arguments for one batch. Every variable goes with `-f`, a
 * raw string: `-F` would turn a name like "123" or "true" into a number or a
 * boolean, and "@x" into a file's contents.
 */
export function prQueryArgs(repo, numbers) {
    return ['api', 'graphql', '-f', `query=${buildPrQuery(numbers)}`, '-f', `owner=${ORG}`, '-f', `name=${repo}`];
}
/**
 * `gh api graphql` output for `buildPrQuery` -> each PR it could read. A PR
 * GitHub could not resolve comes back null next to the others, and is absent.
 */
export function parseGhPrGraphql(json) {
    const out = new Map();
    let body;
    try {
        body = JSON.parse(json);
    }
    catch {
        return out;
    }
    for (const [alias, pr] of Object.entries(body?.data?.repository ?? {})) {
        const m = /^pr(\d+)$/.exec(alias);
        if (m && pr && typeof pr === 'object')
            out.set(Number(m[1]), prFromView(viewOfGraphql(pr)));
    }
    return out;
}
/**
 * The batched lookup: one `gh api graphql` call per 50 PRs, all at once. A
 * repo with 150 PRs costs three round trips instead of 150 `gh pr view`s.
 * A PR that cannot be read is absent; a failed call costs only its batch.
 */
export const ghPrLookupMany = async (repo, numbers) => {
    const out = new Map();
    const unique = [...new Set(numbers)];
    const batches = [];
    for (let i = 0; i < unique.length; i += PRS_PER_QUERY)
        batches.push(unique.slice(i, i + PRS_PER_QUERY));
    await Promise.all(batches.map(async (batch) => {
        let stdout = '';
        try {
            ({ stdout } = await execFileAsync('gh', prQueryArgs(repo, batch), { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 }));
        }
        catch (error) {
            // gh exits non-zero when any PR in the batch is missing, yet still
            // prints the others.
            stdout = String(error.stdout ?? '');
        }
        for (const [n, pr] of parseGhPrGraphql(stdout))
            out.set(n, pr);
    }));
    return out;
};
/** The real lookup: `gh pr view`. Returns null on any failure. */
export const ghPrLookup = async (repo, number) => {
    try {
        const out = execFileSync('gh', [
            'pr',
            'view',
            String(number),
            '--repo',
            `${ORG}/${repo}`,
            '--json',
            'number,title,url,author,headRefName,commits',
        ], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
        return parseGhPrView(out);
    }
    catch {
        // A deleted PR, a permissions gap, or a gh that is not authenticated —
        // none of which is a reason to abandon the announcement.
        return null;
    }
};
/**
 * Look every PR up at once, keeping the order asked for. A PR that cannot be
 * read is dropped rather than guessed at.
 */
export async function shippedPrs(repo, numbers, lookup = ghPrLookup) {
    const results = await Promise.all(numbers.map(async (number) => {
        const pr = await lookup(repo, number);
        return pr ? { number, ...pr } : null;
    }));
    return results.filter((p) => p !== null);
}
/**
 * Contributor key -> Slack user id, one entry per distinct person.
 *
 * Keyed by `contributorKey` because most contributors come from commits and
 * have no login at all. Order of trust: a hand-configured override first —
 * by login, then by key, since the key is the only handle a commit-only
 * contributor has — then each known email in turn. Anyone nobody can be found
 * for maps to null, and the message then names them in plain text.
 */
export async function resolveMentions(contributors, deps) {
    const mentions = {};
    const { token } = deps;
    // The same person across several PRs is resolved once, with every email
    // seen for them pooled; excluded people are never looked up at all.
    for (const person of mergeContributors([contributors])) {
        const key = contributorKey(person);
        // No token means nobody is mentioned at all, overrides included: a raw
        // `<@U123>` only renders as a name in a message Slack actually receives,
        // and an unconfigured run only ever prints the message.
        if (!token) {
            mentions[key] = null;
            continue;
        }
        // An override exists precisely for the people whose git email matches
        // nothing in Slack, so it is trusted ahead of any lookup — and spends no
        // API call.
        const override = overrideFor(person, key, deps.override);
        if (override) {
            mentions[key] = override;
            continue;
        }
        let id = null;
        for (const email of person.emails) {
            try {
                id = await deps.lookup(token, email);
            }
            catch {
                // Slack being unreachable costs the mention, nothing else.
                id = null;
            }
            if (id)
                break;
        }
        mentions[key] = id;
    }
    return mentions;
}
function overrideFor(person, key, override) {
    for (const handle of [person.login, key]) {
        if (!handle)
            continue;
        try {
            const id = override(handle);
            if (id)
                return id;
        }
        catch {
            // A malformed override config costs that override, not the message.
        }
    }
    return null;
}
//# sourceMappingURL=shipped.js.map