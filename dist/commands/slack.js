/**
 * Slack Command
 *
 * Manages the bot token and channel that `vast promote --slack` announces a
 * release into. One setup per token lifetime, stored 0600 under the CLI home.
 *
 * The token is read hidden, proven once against auth.test, and never stored in
 * a log line or printed back — `status` says whether one exists and whether it
 * still works, and nothing more.
 */
import inquirer from 'inquirer';
import { forgetSlack, readSlackChannel, readSlackConfig, readSlackToken, saveSlackConfig, slackFile, } from '../config/slack.js';
import { SlackError, authTest, channelInfo, findChannelId, isChannelId, joinChannel } from '../utils/slack.js';
import { createHeader, createInfoBox, createSuccessBox, formatKeyValue, log } from '../utils/ui.js';
async function setup() {
    console.log(createHeader('Slack setup', 'release announcements'));
    const existing = readSlackConfig();
    const { token } = await inquirer.prompt([
        {
            type: 'password',
            name: 'token',
            mask: '*',
            message: 'Slack bot token (xoxb-...):',
            validate: (value) => (value.trim() ? true : 'A bot token is required'),
        },
    ]);
    // Prove the token before anything is written: a token that does not work is
    // worse stored than absent, because the failure then surfaces mid-release.
    let who;
    try {
        who = await authTest(token.trim());
    }
    catch (error) {
        if (error instanceof SlackError) {
            log.error(`Slack rejected that token: ${error.message}`);
        }
        else {
            log.error(error instanceof Error ? error.message : String(error));
        }
        log.muted('Nothing was stored.');
        process.exitCode = 1;
        return;
    }
    log.success(`Token accepted — ${who.team} (as ${who.user}).`);
    const { channel } = await inquirer.prompt([
        {
            type: 'input',
            name: 'channel',
            message: 'Channel to announce releases in (name or id, e.g. #releases or C0123ABCDEF):',
            default: existing.channelId ?? existing.channel ?? '#releases',
            validate: (value) => (value.trim().replace(/^#/, '') ? true : 'A channel name or id is required'),
        },
    ]);
    // A name is looked up; an id is verified. Either way what gets stored is
    // both: the id to post to, the name for people to read.
    const typed = channel.trim();
    let name = typed.replace(/^#/, '');
    let channelId;
    let isDm = false;
    try {
        if (isChannelId(typed)) {
            const info = await channelInfo(token.trim(), typed);
            channelId = info?.id ?? null;
            if (info) {
                name = info.name;
                isDm = info.isDm;
            }
        }
        else {
            channelId = await findChannelId(token.trim(), name);
        }
    }
    catch (error) {
        // Almost always a missing scope; say which one rather than the raw code.
        log.error(error instanceof SlackError
            ? typed.startsWith('D')
                ? `Could not read that direct message (${error.message}). A DM target needs the im:read and im:write scopes; add them to the app, reinstall it, and run setup again with the new token.`
                : `Could not list channels (${error.message}). The app needs channels:read and groups:read.`
            : error instanceof Error
                ? error.message
                : String(error));
        log.muted('Nothing was stored.');
        process.exitCode = 1;
        return;
    }
    if (!channelId) {
        log.error(isChannelId(typed)
            ? `No conversation with id ${typed} that ${who.user} can see in ${who.team}.`
            : `No channel named #${name} in ${who.team}.`);
        log.muted(typed.startsWith('D')
            ? 'A D… id is a direct message. The bot can only use a DM it is part of (your own DM with it), and reading one needs the im:read scope, posting into it im:write. Add both, reinstall the app, and run setup again with the new token.'
            : 'Check the spelling; a private channel is only visible once the bot has been invited to it.');
        process.exitCode = 1;
        return;
    }
    // Best effort: a private channel cannot be joined this way at all, and one
    // the bot is already in answers with an error too. Neither is a problem
    // worth stopping setup over — posting is what proves it, and `promote`
    // reports not_in_channel plainly if it comes to that.
    if (!isDm) {
        try {
            await joinChannel(token.trim(), channelId);
        }
        catch {
            // Ignored on purpose; see above.
        }
    }
    const shown = isDm ? `${name} (${channelId})` : `#${name}`;
    saveSlackConfig({ token: token.trim(), channel: shown, channelId, team: who.team });
    console.log(createSuccessBox(`Slack is set up for ${who.team}`, `Releases announce into ${isDm ? shown : `#${name} (${channelId})`}.\n` +
        `Stored in ${slackFile()} (owner-only); the token is never printed.\n` +
        'Announce a release with `vast promote <repo> --to production --slack`.'));
}
async function status() {
    console.log(createHeader('Slack', 'release announcements'));
    const token = readSlackToken();
    const channel = readSlackChannel();
    const config = readSlackConfig();
    const tokenFromEnv = Boolean(process.env.VAST_SLACK_TOKEN?.trim());
    const channelFromEnv = Boolean(process.env.VAST_SLACK_CHANNEL?.trim());
    let session = 'no token — run `vast slack setup`';
    let team = config.team ?? 'unknown';
    if (token) {
        // Only asked when a token exists, so `status` makes no network call for a
        // CLI that has never been set up.
        try {
            const who = await authTest(token);
            team = who.team || team;
            session = `valid — posting as ${who.user}`;
        }
        catch (error) {
            session =
                error instanceof SlackError
                    ? `rejected (${error.message}) — run \`vast slack setup\``
                    : `unknown — ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    const overrides = Object.keys(config.users ?? {}).length;
    console.log(createInfoBox('slack', [
        formatKeyValue('File', slackFile()),
        formatKeyValue('Workspace', team),
        formatKeyValue('Channel', channel
            ? channelFromEnv
                ? `${channel} (VAST_SLACK_CHANNEL)`
                : config.channelId
                    ? `${config.channel ?? config.channelId} (${config.channelId})`
                    : channel
            : 'none'),
        formatKeyValue('Token', token ? (tokenFromEnv ? 'from VAST_SLACK_TOKEN env var' : 'stored (owner-only)') : 'none'),
        formatKeyValue('Session', session),
        formatKeyValue('User overrides', overrides ? `${overrides} in the "users" map` : 'none'),
    ]));
}
function logout() {
    forgetSlack();
    console.log(createSuccessBox('Forgot the Slack token and channel', `Removed ${slackFile()}.`));
}
export function registerSlackCommand(program) {
    const cmd = program
        .command('slack')
        .description('Manage the Slack bot token used to announce releases')
        .addHelpText('after', `
Examples:
  $ vast slack                show what is configured (same as: status)
  $ vast slack setup          store a bot token and pick the channel
  $ vast slack logout         forget the token and channel

What gets posted:

  \`vast promote <repo> --to production --slack\` posts one line per release:

    • <pr link|Vastmenu Dashboard - release/2.1.25> - Per-card-type commission
      fixed addon (@Mostafa Adly, @Mahmoud Kassem) (VA-12755)

  The app name and branch link to the release PR, the ticket ids link to
  ClickUp, and each author is a real @-mention when Slack recognises the email
  on their commits.

The Slack app needs these bot scopes:

  chat:write        post the message
  users:read        read member ids
  users:read.email  match a commit email to a Slack account
  channels:read     find a public channel by name
  groups:read       find a private channel by name
  channels:join     add itself to a public channel
  im:read, im:write only when the target is a direct message (a D… id)

The bot must be IN the channel. Setup joins public channels for you; for a
private one, invite the app in Slack first (/invite @your-app).

Anyone whose GitHub email is private cannot be matched by email. Map them by
hand in the "users" object of ~/.vast-cli/slack.json — GitHub login to Slack
member id, e.g. { "users": { "MostafaAdly": "U012ABCDEF" } } — and they are
mentioned properly from then on.

The token is stored owner-only in ~/.vast-cli/slack.json and is never printed.
Set VAST_SLACK_TOKEN or VAST_SLACK_CHANNEL to supply either without writing to
disk; the env vars win over the file.
`);
    cmd
        .command('status', { isDefault: true })
        .description('Show the channel, the workspace and whether the token still works')
        .action(status);
    cmd.command('setup').description('Store a Slack bot token and choose the release channel').action(setup);
    cmd.command('logout').description('Forget the stored Slack token and channel').action(logout);
}
//# sourceMappingURL=slack.js.map