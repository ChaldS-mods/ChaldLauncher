/**
 * Azure application (client) ID used for Microsoft sign-in. Built into the launcher; there is no user-facing field for it.
 *
 * Put the ID of the app registered by Chald Studio here (see README: "Вход через Microsoft").
 * Do NOT use the client ID of the official Minecraft Launcher: it belongs to Mojang, is not meant for third-party
 * launchers and the launcher would be impersonating it.
 */
export const DEFAULT_MS_CLIENT_ID = '46389f46-f373-4e73-8293-3e7e8932857a';

/** Repository whose GitHub Releases carry new launcher versions (used when the "Репозиторий" setting is empty). */
export const DEFAULT_UPDATE_REPO = 'ChaldS-mods/ChaldLauncher';

/**
 * Application ID of the Discord application used for the "Rich Presence" status ("В главном меню · Chald Launcher").
 * Create it at https://discord.com/developers/applications (the application name is what Discord shows as "Играет в …"),
 * upload the launcher logo in Rich Presence → Art Assets under the name "logo" and paste the Application ID here.
 * Empty: the Discord status is off. (The application ID is public, it is not a secret.)
 */
export const DEFAULT_DISCORD_CLIENT_ID = '1563494662973690027';
