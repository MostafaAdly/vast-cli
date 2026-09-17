/**
 * ArgoCD Command
 *
 * Manages the ArgoCD session token that `vast release` and `vast deploy` need
 * in order to confirm a rollout. ArgoCD uses local accounts, so there is no SSO
 * to fall back on: one login per token lifetime, stored 0600 under the CLI home.
 *
 * The password is read hidden, sent once, and never stored or printed. Neither
 * is the token — `status` says whether one exists and whether it still works,
 * and nothing more.
 */
import { Command } from 'commander';
export declare function registerArgocdCommand(program: Command): void;
//# sourceMappingURL=argocd.d.ts.map