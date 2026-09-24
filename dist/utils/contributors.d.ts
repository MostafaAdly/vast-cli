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
export interface Contributor {
    name: string;
    login: string | null;
    emails: string[];
}
/**
 * People who are never named in an announcement, as normalized keys. Each
 * spelling seen in real git history is listed, because a git name is whatever
 * that machine was configured with and nobody normalizes it for us.
 */
export declare const EXCLUDED_CONTRIBUTORS: string[];
/** True for an email that marks its author as automation (case-insensitive). */
export declare function isBotEmail(email: string | null | undefined): boolean;
export declare function normalizeName(s: string): string;
export declare function contributorKey(c: Contributor): string;
export declare function isExcludedContributor(c: Contributor): boolean;
/**
 * One entry per person, in the order they first appear, with everything known
 * about them pooled. Exclusion runs after the pooling so that a login learned
 * from one source can exclude a name learned from another.
 */
export declare function mergeContributors(lists: Contributor[][]): Contributor[];
//# sourceMappingURL=contributors.d.ts.map