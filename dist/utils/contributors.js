/**
 * Who worked on a release, as the team would thank them.
 *
 * GitHub and git each know a different half of a person: the PR author has a
 * login but often no display name, and a commit author has a name and an email
 * but usually no login. Real data for one person on one PR:
 *
 *   PR author:     { login: 'osama-elshimy1', name: '' }
 *   commit author: { name: 'Osama Elshimy', email: 'o.elshemey@e.vastgroupsa.com', login: '' }
 *
 * So people are matched on their name squeezed down to letters and digits,
 * which survives the spacing and casing differences between the two, and the
 * login is only the key when there is no name at all.
 */
/**
 * People who are never named in an announcement, as normalized keys. Each
 * spelling seen in real git history is listed, because a git name is whatever
 * that machine was configured with and nobody normalizes it for us.
 */
export const EXCLUDED_CONTRIBUTORS = [
    'mahmoudelzahaby',
    'mahmoudelzahabi',
    'alielhabal',
    'youssifelzahaby',
];
/** Automation accounts that commit or open PRs but are nobody to thank. */
const BOT_KEYS = ['githubactions', 'dependabot'];
/**
 * Emails that mark an author as automation whatever name it gives. GitHub's
 * commit authors include Co-Authored-By trailers, so an AI co-author such as
 * "Claude Opus 5 <noreply@anthropic.com>" arrives looking like a person.
 */
const BOT_EMAILS = ['noreply@anthropic.com'];
/** True for an email that marks its author as automation (case-insensitive). */
export function isBotEmail(email) {
    return BOT_EMAILS.includes((email ?? '').trim().toLowerCase());
}
export function normalizeName(s) {
    return (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
export function contributorKey(c) {
    return normalizeName(c.name) || normalizeName(c.login ?? '');
}
/**
 * GitHub marks app accounts with a `[bot]` suffix; the two older automation
 * accounts predate that convention and appear under their bare names, in git
 * history as well as on GitHub. `gh pr view` reports an app that opened a PR
 * as `app/<name>`, which is a bot by construction.
 */
function isBot(value) {
    const raw = value.trim().toLowerCase();
    if (!raw)
        return false;
    if (raw.endsWith('[bot]') || raw.startsWith('app/'))
        return true;
    return BOT_KEYS.includes(normalizeName(raw));
}
export function isExcludedContributor(c) {
    const login = c.login ?? '';
    if (isBot(login) || isBot(c.name))
        return true;
    if (c.emails.some(isBotEmail))
        return true;
    const candidates = [contributorKey(c), normalizeName(login), normalizeName(c.name)];
    return candidates.some((k) => k !== '' && EXCLUDED_CONTRIBUTORS.includes(k));
}
/**
 * One entry per person, in the order they first appear, with everything known
 * about them pooled. Exclusion runs after the pooling so that a login learned
 * from one source can exclude a name learned from another.
 */
export function mergeContributors(lists) {
    const byKey = new Map();
    for (const c of lists.flat()) {
        const key = contributorKey(c);
        // Someone with neither a name nor a login cannot be named or mentioned.
        if (!key)
            continue;
        const seen = byKey.get(key);
        if (!seen) {
            byKey.set(key, { name: c.name, login: c.login || null, emails: [...new Set(c.emails)] });
            continue;
        }
        if (!seen.name.trim() && c.name.trim())
            seen.name = c.name;
        if (!seen.login && c.login)
            seen.login = c.login;
        for (const email of c.emails)
            if (!seen.emails.includes(email))
                seen.emails.push(email);
    }
    return [...byKey.values()].filter((c) => !isExcludedContributor(c));
}
//# sourceMappingURL=contributors.js.map