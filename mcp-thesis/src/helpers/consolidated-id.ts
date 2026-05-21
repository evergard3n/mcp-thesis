/**
 * Single source of truth for consolidated question ID format.
 *
 * Format: consolidated-{groupId}-steps-{N}-{N}-...
 * Example: consolidated-data_handling-steps-2-4-7
 *
 * All generators and parsers must go through these helpers so that
 * a format change only requires editing this file.
 */

export const CONSOLIDATED_ID_REGEX = /consolidated-([a-z_]+)-steps-([0-9][0-9-]*)/;

export function buildConsolidatedId(groupId: string, stepIndexes: number[]): string {
  return `consolidated-${groupId}-steps-${stepIndexes.join("-")}`;
}

export interface ParsedConsolidatedId {
  groupId: string;
  stepIndexes: number[];
}

export function parseConsolidatedId(id: string): ParsedConsolidatedId | null {
  const match = id.match(CONSOLIDATED_ID_REGEX);
  if (!match) return null;
  const stepIndexes = match[2]
    .split("-")
    .map(Number)
    .filter((n) => !isNaN(n) && n > 0);
  if (stepIndexes.length === 0) return null;
  return { groupId: match[1], stepIndexes };
}
