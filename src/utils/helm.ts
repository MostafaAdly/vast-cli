/**
 * Reads the deployed image tag out of a repo's Helm values.
 *
 * Uses `git show <ref>:<path>` so nothing is checked out — the committed state
 * on the remote branch is what is deployed, and it reflects everyone's deploys,
 * not just this machine's.
 */

import { execFileSync } from 'child_process';

/** First uncommented `tag:` value in a Helm values file. */
export function extractTag(yaml: string): string {
  for (const line of yaml.split('\n')) {
    const stripped = line.trim();
    if (stripped.startsWith('#')) continue;
    const m = /^tag:\s*["']?([^"'\s#]+)["']?/.exec(stripped);
    if (m) return m[1];
  }
  throw new Error('No `tag:` found in Helm values file');
}

export function readDeployedTag(repoDir: string, ref: string, helmPath: string): string {
  let yaml: string;
  try {
    yaml = execFileSync('git', ['show', `${ref}:${helmPath}`], {
      cwd: repoDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    throw new Error(`Could not read ${helmPath} at ${ref}. Is the ref fetched?`);
  }
  return extractTag(yaml);
}
