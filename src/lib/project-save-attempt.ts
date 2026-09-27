import { isStoredProject } from "./project-validation";
import type { StoredProject } from "./types";
import { workspaceKey } from "./workspace";

export interface ProjectSaveAttempt {
  version: 1;
  /** The caller may still have this revision after multiple lost responses. */
  requestedRevision?: number;
  sent: StoredProject;
  before: StoredProject | null;
}

const key = (ownerId: string, projectId: string) => workspaceKey(`scuri.project-save.${encodeURIComponent(projectId)}`, ownerId);
const failure = () => new Error("Cloud save recovery could not be stored or read in this browser. Your local project is retained; free browser storage and retry.");

/** A tab's own outbound metadata, never a different tab's pending edits.
 * Session storage survives reload; the record stays until the acknowledged
 * revision has been saved to the normal project cache. No image bytes here. */
export function readProjectSaveAttempt(ownerId: string, projectId: string): ProjectSaveAttempt | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key(ownerId, projectId));
    if (!raw) return null;
    const value: ProjectSaveAttempt = JSON.parse(raw);
    if (value?.version !== 1 || !isStoredProject(value.sent) || value.sent.id !== projectId ||
      (value.before !== null && (!isStoredProject(value.before) || value.before.id !== projectId)) ||
      (value.requestedRevision !== undefined && (!Number.isInteger(value.requestedRevision) || value.requestedRevision < 1))) throw failure();
    return value;
  } catch { throw failure(); }
}

export function rememberProjectSaveAttempt(ownerId: string, attempt: ProjectSaveAttempt): void {
  if (typeof sessionStorage === "undefined") return;
  try { sessionStorage.setItem(key(ownerId, attempt.sent.id), JSON.stringify(attempt)); }
  catch { throw failure(); }
}

export function clearProjectSaveAttempt(ownerId: string, projectId: string): void {
  if (typeof sessionStorage === "undefined") return;
  // Failure to clean up is harmless: recovery still requires exact content and
  // revision matches, and the next save replaces this one bounded record.
  try { sessionStorage.removeItem(key(ownerId, projectId)); } catch { /* retain */ }
}
