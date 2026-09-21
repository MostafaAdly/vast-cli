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

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { vastHome } from './workspace.js';

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
export const CLICKUP_WORKSPACE_ID = '90121402342';

/**
 * Two kinds of id reach here. `VA-12755` is a workspace custom id, which
 * ClickUp resolves only under the workspace segment. `CU-869e077zm` is the
 * bugfixer's branch prefix around a RAW task id, which lives at /t/<id> with no
 * workspace and 404s under one.
 */
export function clickupTaskUrl(id: string): string {
  const raw = /^cu-([0-9a-z]+)$/i.exec(id.trim());
  if (raw) return `https://app.clickup.com/t/${raw[1].toLowerCase()}`;
  return `https://app.clickup.com/t/${CLICKUP_WORKSPACE_ID}/${id.trim().toUpperCase()}`;
}

export function slackFile(): string {
  return join(vastHome(), 'slack.json');
}

export function readSlackConfig(): SlackConfig {
  const file = slackFile();
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as SlackConfig;
  } catch {
    // A truncated or hand-mangled file must not break every command; treat it
    // as "nothing configured" and let the user run setup again.
    return {};
  }
}

/**
 * The bot token, or null.
 *
 * A blank env var falls through rather than masking a stored token — an
 * unset-looking variable should behave as unset.
 */
export function readSlackToken(): string | null {
  const fromEnv = process.env.VAST_SLACK_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  return readSlackConfig().token?.trim() || null;
}

export function readSlackChannel(): string | null {
  const fromEnv = process.env.VAST_SLACK_CHANNEL?.trim();
  if (fromEnv) return fromEnv;
  return readSlackConfig().channel?.trim() || null;
}

/** Merge a patch into the stored config, keeping every field it does not name. */
export function saveSlackConfig(patch: Partial<SlackConfig>): void {
  const file = slackFile();
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const next: SlackConfig = { ...readSlackConfig(), ...patch, savedAt: new Date().toISOString() };
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
  // `mode` on writeFileSync only applies when the file is created, so an
  // existing file keeps whatever permissions it had. Force them.
  chmodSync(file, 0o600);
}

export function forgetSlack(): void {
  rmSync(slackFile(), { force: true });
}

/** The hand-written Slack member id for a GitHub login, or null. */
export function slackUserOverride(login: string): string | null {
  return readSlackConfig().users?.[login]?.trim() || null;
}
