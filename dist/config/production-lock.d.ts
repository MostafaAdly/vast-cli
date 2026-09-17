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
import type { DeployEnv } from './repos.js';
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
/**
 * The second, harder gate: production has not moved to the new deploy pipeline.
 *
 * Staging is GitOps — `build-deploy` commits the image tag into
 * Vast-deployments and ArgoCD rolls it out. Production still has the old shape:
 * its workflow inputs, its values-file folder names and its ArgoCD host are
 * ASSUMPTIONS in this config, not facts read from GitHub. Dispatching against
 * an assumption is how you ship nothing and report success, so every production
 * deploy path refuses on this constant before it even looks at the file lock.
 *
 * Unlike the lock, no file or flag can lift it: re-enabling production means
 * flipping this constant, and only after the prod workflow inputs and folder
 * names have been verified with DevOps.
 */
export declare const PRODUCTION_PIPELINE_READY = false;
export declare function productionPipelineReady(): boolean;
/** Human-readable refusal for every blocked production deploy path. */
export declare const PRODUCTION_NOT_READY_MESSAGE: string;
/**
 * The one gate every production path shares.
 *
 * Returns the refusal to print, or null when the path may proceed. Order is
 * load-bearing: the pipeline block is a statement about the world, the file
 * lock is only a permission, so no lifted lock can get past the block. Both
 * states are injectable so the ordering is testable without process.exit.
 */
export declare function productionRefusal(env: DeployEnv, state?: {
    ready?: boolean;
    enabled?: boolean;
}): string | null;
//# sourceMappingURL=production-lock.d.ts.map