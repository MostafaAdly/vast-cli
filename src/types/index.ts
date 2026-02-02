/**
 * Central types and interfaces for Vast CLI
 * 
 * This file defines all shared types, ensuring type safety
 * across the entire application.
 */

/** Organization configuration */
export interface OrganizationConfig {
  name: string;
  githubOrg: string;
}

/** Repository metadata */
export interface RepositoryInfo {
  name: string;
  fullName: string;  // org/repo format
  defaultBranch: string;
  description?: string;
}

/** GitHub workflow definition */
export interface GitHubWorkflow {
  id: number;
  name: string;
  path: string;
  state: 'active' | 'disabled' | 'disabled_inactivity' | 'deleted';
  createdAt: string;
  updatedAt: string;
  url: string;
  htmlUrl: string;
}

/** Workflow run request parameters */
export interface WorkflowRunParams {
  repository: string;
  version: string;
  branch: string;
  workflowName?: string;
  inputs?: Record<string, string>;
}

/** Workflow run result */
export interface WorkflowRunResult {
  success: boolean;
  runId?: number;
  url?: string;
  error?: string;
  message: string;
}

/** CLI command interface - all commands must implement this */
export interface CliCommand {
  /** Command name (e.g., 'workflow', 'deploy') */
  readonly name: string;
  /** Command description for help text */
  readonly description: string;
  /** Command aliases (optional) */
  readonly aliases?: string[];
  /** Register the command with the program */
  register(program: unknown): void;
}

/** Command execution context */
export interface CommandContext {
  organization: OrganizationConfig;
  isDryRun: boolean;
  isVerbose: boolean;
}
