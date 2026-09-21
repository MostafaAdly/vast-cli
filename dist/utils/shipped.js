/**
 * What actually shipped in a release, expressed as the PRs it carries.
 *
 * The Slack announcement is read by people who do not read commit logs, so it
 * is built from PRs and their authors rather than from raw subjects. The PR
 * numbers come out of the merge commits already in the branch — the same
 * source `skills/release/notes.sh` uses, and for the same reason: `gh search
 * commits` only indexes a repo's default branch, which here is `production`,
 * so it is blind to everything a release is made of.
 *
 * Every function here degrades rather than throws. The PR is already open by
 * the time any of this runs; a failed lookup costs the message a line, and
 * must never cost the release its announcement.
 */
import { execFileSync } from 'child_process';
import { ORG } from './remote.js';
/** "Merge pull request #796 from Vast-Menu/feat/x" -> number and source branch. */
const MERGE_SUBJECT = /^Merge pull request #(\d+) from (\S+)/;
/**
 * The CI opens its own PRs to rewrite package.json's version on each branch.
 * They describe the pipeline, not the product, so the team has nothing to read
 * in them — the same exclusion notes.sh makes.
 */
const BUMP_BRANCH = /\/bump-(stage|prod)-/;
function prNumberOfSubject(subject) {
    const m = MERGE_SUBJECT.exec(subject.trim());
    if (!m)
        return null;
    if (BUMP_BRANCH.test(m[2]))
        return null;
    return Number(m[1]);
}
/** Unique, ascending — the order a reader scans a list of PR numbers in. */
function tidyNumbers(numbers) {
    return [...new Set(numbers)].sort((a, b) => a - b);
}
/**
 * PR numbers merged into `head` that `base` does not have.
 *
 * `--merges` matches on parent count, not on the subject, so this sees exactly
 * the real merge commits and nothing that merely looks like one.
 */
export function prNumbersInRange(dir, base, head) {
    let out;
    try {
        out = execFileSync('git', ['log', `${base}..${head}`, '--merges', '--pretty=format:%s'], {
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
        const parsed = JSON.parse(out);
        const login = parsed.author?.login ?? '';
        const emails = (parsed.commits ?? [])
            .flatMap((c) => c.authors ?? [])
            .map((a) => a.email)
            .filter(usableEmail);
        return {
            title: parsed.title ?? '',
            url: parsed.url ?? '',
            authorLogin: login,
            // GitHub display names are optional; the login is always there.
            authorName: parsed.author?.name || login,
            authorEmails: [...new Set(emails)],
            branch: parsed.headRefName ?? '',
        };
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
 * GitHub login -> Slack user id, one entry per distinct author.
 *
 * Order of trust: a hand-configured override first (it exists precisely for
 * the people whose git email matches nothing in Slack), then each commit email
 * in turn. A login nobody can be found for maps to null, and the message then
 * names them in plain text instead of mentioning them.
 */
export async function resolveMentions(prs, deps) {
    const mentions = {};
    // Distinct logins, with the emails seen for each across all their PRs.
    const emailsByLogin = new Map();
    for (const pr of prs) {
        if (!pr.authorLogin)
            continue;
        const seen = emailsByLogin.get(pr.authorLogin) ?? [];
        for (const email of pr.authorEmails)
            if (!seen.includes(email))
                seen.push(email);
        emailsByLogin.set(pr.authorLogin, seen);
    }
    const { token } = deps;
    for (const [login, emails] of emailsByLogin) {
        // No token means nobody is mentioned at all, overrides included: a raw
        // `<@U123>` only renders as a name in a message Slack actually receives,
        // and an unconfigured run only ever prints the message.
        if (!token) {
            mentions[login] = null;
            continue;
        }
        // An override exists precisely for the people whose git email matches
        // nothing in Slack, so it is trusted ahead of any lookup — and spends no
        // API call.
        const override = deps.override(login);
        if (override) {
            mentions[login] = override;
            continue;
        }
        let id = null;
        for (const email of emails) {
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
        mentions[login] = id;
    }
    return mentions;
}
//# sourceMappingURL=shipped.js.map