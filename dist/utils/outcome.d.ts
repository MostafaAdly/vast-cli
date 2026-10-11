/**
 * How one repo's deploy ended, as the summary prints it and the stream's
 * `done` carries it. Lives in utils so the event model and the notifier can
 * name it without importing a command module; `commands/deploy.ts` re-exports
 * it for everything that already imports it from there.
 */
export interface DeployOutcome {
    repo: string;
    version: string;
    status: 'released' | 'skipped' | 'failed';
    detail: string;
}
//# sourceMappingURL=outcome.d.ts.map