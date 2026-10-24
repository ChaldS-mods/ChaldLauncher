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
