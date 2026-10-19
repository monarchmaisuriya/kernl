// Types for changelog.mjs (used by the release script and its unit test).
export function unreleasedEntries(text: string): string;
export function versionNotes(text: string, version: string): string;
export function releaseChangelog(text: string, version: string, date: string, repo: string): string;
