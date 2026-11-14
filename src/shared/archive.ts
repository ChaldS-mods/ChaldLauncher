/** One non-mod part of an archive: the folder it would go to inside the instance ('' = the instance root). */
export interface ArchiveGroup {
  dir: string;
  files: number;
  bytes: number;
}

/** What is inside a .zip dropped on the mods page (the files themselves stay on disk until the user decides). */
export interface ArchiveAnalysis {
  /** remembered by the main process; sent back to apply the decision */
  token: string;
  /** file name of the archive */
  name: string;
  mods: number;
  modBytes: number;
  /** everything that is not a mod, by destination folder */
  groups: ArchiveGroup[];
  /** files that are not needed (readme, caches, launcher files…) and are never copied */
  ignored: number;
}

export interface ContentAddResult {
  /** mods copied at once: loose .jar files and archives that hold nothing but mods */
  imported: number;
  /** files that were already there and were NOT overwritten */
  skipped: number;
  /** archives with more than mods: the user decides where the files go */
  pending: ArchiveAnalysis[];
  /** files that could not be added, with the reason */
  errors: string[];
}

export interface ArchiveApplyResult {
  mods: number;
  other: number;
  skipped: number;
}
