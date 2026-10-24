/** Pages the launcher reports to the main process for the Discord status. Kept in sync with `Page` in renderer/store.ts. */
export const PRESENCE_PAGES = ['home', 'instances', 'versions', 'mods', 'resourcepacks', 'wardrobe', 'modrinth', 'console', 'settings'] as const;
export type PresencePage = (typeof PRESENCE_PAGES)[number];
