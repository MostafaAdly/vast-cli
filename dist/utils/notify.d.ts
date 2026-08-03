/**
 * Best-effort notification via the vast-routines notifier (Telegram).
 *
 * notify.sh reads the message from stdin — never argv, deliberately, so the bot
 * token can never end up in a process listing. Never throws: a failed
 * notification must not fail a deploy that already succeeded.
 */
export declare function notify(message: string): void;
//# sourceMappingURL=notify.d.ts.map