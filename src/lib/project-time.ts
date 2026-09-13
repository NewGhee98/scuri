import type { StoredProject } from "./types";

/** A client clock behind the last server acknowledgement must still create a
 * dirty edit. This is a local ordering rule, not cross-device conflict control. */
export function nextProjectEditTime(project?: Pick<StoredProject, "updatedAt" | "cloudSyncedAt"> | null, timestamp = new Date().toISOString()): string {
  const times = [Date.parse(timestamp), Date.parse(project?.updatedAt ?? "") + 1, Date.parse(project?.cloudSyncedAt ?? "") + 1].filter(Number.isFinite);
  return new Date(Math.max(...times)).toISOString();
}
