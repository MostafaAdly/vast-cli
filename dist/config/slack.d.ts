/**
 * The Slack bot token, the channel releases are announced in, and the handful
 * of people Slack cannot match by email.
 *
 * A bot token is a credential, not a preference: the file is written 0600 and
 * lives under `vastHome()` so the test suite can sandbox it with
 * `VAST_CLI_HOME` and never touch a developer's real token. The token is never
 * echoed back by any command — `vast slack status` only says whether one
 * exists and whether it still works.
 *
 * Env vars win over the file so CI and one-off shells can supply a token
 * without writing anything to disk.
 */
export interface SlackConfig {
    token?: string;
    /** Stored with the leading '#', the way people write it. */
    channel?: string;
    /** The workspace name, kept only so `status` can name it without a call. */
    team?: string;
    /**
     * GitHub login -> Slack member id, hand-written.
     *
     * Slack matches most people by their commit email, but anyone whose GitHub
     * email is private or differs from their Slack address cannot be found that
     * way. Rather than leave them unmentioned forever, they get an entry here.
     */
    users?: Record<string, string>;
    savedAt?: string;
}
/** The Vast ClickUp workspace. Task links are built against it, not guessed. */
export declare const CLICKUP_WORKSPACE_ID = "90121402342";
/**
 * Two kinds of id reach here. `VA-12755` is a workspace custom id, which
 * ClickUp resolves only under the workspace segment. `CU-869e077zm` is the
 * bugfixer's branch prefix around a RAW task id, which lives at /t/<id> with no
 * workspace and 404s under one.
 */
export declare function clickupTaskUrl(id: string): string;
export declare function slackFile(): string;
export declare function readSlackConfig(): SlackConfig;
/**
 * The bot token, or null.
 *
 * A blank env var falls through rather than masking a stored token — an
 * unset-looking variable should behave as unset.
 */
export declare function readSlackToken(): string | null;
export declare function readSlackChannel(): string | null;
/** Merge a patch into the stored config, keeping every field it does not name. */
export declare function saveSlackConfig(patch: Partial<SlackConfig>): void;
export declare function forgetSlack(): void;
/** The hand-written Slack member id for a GitHub login, or null. */
export declare function slackUserOverride(login: string): string | null;
//# sourceMappingURL=slack.d.ts.map