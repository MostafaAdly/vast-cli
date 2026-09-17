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

import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { vastHome } from './workspace.js';
import type { DeployEnv } from './repos.js';

/** Hard-coded default. Production is off until a file says otherwise. */
const PRODUCTION_ENABLED_BY_DEFAULT = false;

/**
 * VAST_CLI_HOME exists so the test suite can exercise enable/disable against a
 * throwaway directory. Without it a crashed test could leave the real lock
 * lifted, which is exactly the state this module exists to prevent.
 */
export function lockFile(): string {
  return join(vastHome(), 'production-enabled');
}

export function isProductionEnabled(): boolean {
  if (PRODUCTION_ENABLED_BY_DEFAULT) return true;
  return existsSync(lockFile());
}

/** When the lock was lifted, or null if it is still in place. */
export function enabledSince(): string | null {
  const file = lockFile();
  if (!existsSync(file)) return null;
  try {
    return readFileSync(file, 'utf-8').trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

export function enableProduction(stamp: string): void {
  const file = lockFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${stamp}\n`, 'utf-8');
}

export function disableProduction(): void {
  rmSync(lockFile(), { force: true });
}

/** Human-readable refusal, shared by every production code path. */
export const PRODUCTION_LOCKED_MESSAGE = [
  'Production deploys are locked. Nothing was built or shipped.',
  '',
  'Preparing a release is NOT locked — you can still run:',
  '  vast promote <repo> --to production              cut release/X.Y.Z + PR',
  '  vast promote <repo> --to production --as hotfix  cut hotfix/X.Y.Z + PR',
  '',
  'Lift the deploy lock: vast production enable',
  'Check the state:      vast production status',
].join('\n');

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
export const PRODUCTION_PIPELINE_READY = false;

export function productionPipelineReady(): boolean {
  return PRODUCTION_PIPELINE_READY;
}

/** Human-readable refusal for every blocked production deploy path. */
export const PRODUCTION_NOT_READY_MESSAGE = [
  'Production has not moved to the new deploy pipeline yet.',
  'Nothing was built or shipped.',
  '',
  'Staging deploys through Vast-deployments + ArgoCD now. The',
  'production workflow inputs, values-file folder names and ArgoCD',
  'host are still unverified assumptions, so this CLI refuses to',
  'dispatch against them.',
  '',
  'Still works, and ships nothing on its own:',
  '  vast promote <repo> --to production',
  '  vast promote <repo> --to production --as hotfix',
  '',
  'Deploy production by hand until DevOps has migrated it.',
  'Re-enabling it here means verifying the production workflow',
  'inputs and folder names with DevOps, then flipping',
  'PRODUCTION_PIPELINE_READY in src/config/production-lock.ts.',
].join('\n');

/**
 * The one gate every production path shares.
 *
 * Returns the refusal to print, or null when the path may proceed. Order is
 * load-bearing: the pipeline block is a statement about the world, the file
 * lock is only a permission, so no lifted lock can get past the block. Both
 * states are injectable so the ordering is testable without process.exit.
 */
export function productionRefusal(
  env: DeployEnv,
  state?: { ready?: boolean; enabled?: boolean },
): string | null {
  if (env !== 'production') return null;
  const ready = state?.ready ?? productionPipelineReady();
  if (!ready) return PRODUCTION_NOT_READY_MESSAGE;
  const enabled = state?.enabled ?? isProductionEnabled();
  if (!enabled) return PRODUCTION_LOCKED_MESSAGE;
  return null;
}
