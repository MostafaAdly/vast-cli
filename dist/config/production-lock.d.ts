/**
 * Production safety lock.
 *
 * Production deploys are DISABLED BY DEFAULT, hard-coded. Nothing in this CLI
 * touches the `production` branch or dispatches a production build unless the
 * lock has been explicitly lifted with `vast production enable`.
 *
 * The lock is a file rather than a constant so that lifting it is a deliberate,
 * auditable act that does not require editing and rebuilding source — and so
 * that it can be dropped again in one command.
 */
/**
 * VAST_CLI_HOME exists so the test suite can exercise enable/disable against a
 * throwaway directory. Without it a crashed test could leave the real lock
 * lifted, which is exactly the state this module exists to prevent.
 */
export declare function lockFile(): string;
export declare function isProductionEnabled(): boolean;
/** When the lock was lifted, or null if it is still in place. */
export declare function enabledSince(): string | null;
export declare function enableProduction(stamp: string): void;
export declare function disableProduction(): void;
/** Human-readable refusal, shared by every production code path. */
export declare const PRODUCTION_LOCKED_MESSAGE: string;
//# sourceMappingURL=production-lock.d.ts.map