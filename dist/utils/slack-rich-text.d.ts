/**
 * The team's Slack bullet: `• <link|label> - description (people) (tickets)`.
 *
 * Produced twice, as the release announcement does: `text`, the mrkdwn line
 * Slack shows in notifications and clients that cannot draw blocks, and
 * `elements`, one rich_text section so the channel sees a real bullet with
 * real mentions. Shared by the release announcement and `vast pending` so the
 * two posts cannot drift apart.
 */
export type RichElement = {
    type: 'link';
    url: string;
    text: string;
} | {
    type: 'text';
    text: string;
} | {
    type: 'user';
    user_id: string;
};
/** A resolved Slack id becomes a mention; anyone unmatched is named in plain text. */
export type Person = {
    userId: string;
} | {
    plain: string;
};
export interface Bullet {
    text: string;
    elements: RichElement[];
}
/**
 * Slack's mrkdwn reserves exactly three characters — `&` first, or the escapes
 * would escape each other. Free text in `text` only; blocks are JSON.
 */
export declare function escapeMrkdwn(text: string): string;
export declare function bullet(input: {
    url: string;
    label: string;
    description: string;
    people: Person[];
    tickets: string[];
}): Bullet;
export declare function bulletBlocks(bullets: Bullet[], heading?: string): unknown[];
//# sourceMappingURL=slack-rich-text.d.ts.map