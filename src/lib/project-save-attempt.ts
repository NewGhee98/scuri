import { isStoredProject } from "./project-validation";
import type { StoredProject } from "./types";
import { workspaceKey } from "./workspace";

export interface ProjectSaveAttempt {
  version: 1;
  id?: string;
  /** The caller may still have this revision after multiple lost responses. */
  requestedRevision?: number;
  sent: StoredProject;
  before: StoredProject | null;
}

const key = (ownerId: string, projectId: string) => workspaceKey(`scuri.project-save.${encodeURIComponent(projectId)}`, ownerId);
const durableKey = (ownerId: string, projectId: string, id: string) => `${key(ownerId, projectId)}.attempt.${encodeURIComponent(id)}`;
const failure = () => new Error("Cloud save recovery could not be stored or read in this browser. Your local project is retained; free browser storage and retry.");

/** Only the receipt referenced by this local snapshot can recover a durable
 * save. Never discover another tab's receipt by account/project alone. Legacy
 * per-tab receipts remain readable during an upgrade. No image bytes here. */
export function readProjectSaveAttempt(ownerId: string, projectId: string, id?: string): ProjectSaveAttempt | null {
  if (!id && typeof sessionStorage === "undefined") return null;
  try {
    const raw = id ? localStorage.getItem(durableKey(ownerId, projectId, id)) : sessionStorage.getItem(key(ownerId, projectId));
    if (!raw) return null;
    const value: ProjectSaveAttempt = JSON.parse(raw);
    if (value?.version !== 1 || (id && (value.id !== id || value.sent?.pendingCloudSaveId !== id)) ||
      (!id && value.id !== undefined) || !isStoredProject(value.sent) || value.sent.id !== projectId ||
      (value.before !== null && (!isStoredProject(value.before) || value.before.id !== projectId)) ||
      (value.requestedRevision !== undefined && (!Number.isInteger(value.requestedRevision) || value.requestedRevision < 1))) throw failure();
    return value;
  } catch { throw failure(); }
}

export function rememberProjectSaveAttempt(ownerId: string, attempt: ProjectSaveAttempt,
  persist?: (project: StoredProject) => void): StoredProject {
  if (!persist) {
    if (typeof sessionStorage !== "undefined") {
      try { sessionStorage.setItem(key(ownerId, attempt.sent.id), JSON.stringify(attempt)); }
      catch { throw failure(); }
    }
    return attempt.sent;
  }
  const id = crypto.randomUUID(), sent = { ...attempt.sent, pendingCloudSaveId: id };
  // Persist the proof first, then its reference alongside the latest local
  // edits, before any cloud mutation. A recovered base revision is retained
  // too, so a second request that never commits can be retried normally.
  try { localStorage.setItem(durableKey(ownerId, sent.id, id), JSON.stringify({ ...attempt, id, sent, requestedRevision: sent.revision })); }
  catch { throw failure(); }
  try { persist(sent); }
  catch (error) { clearProjectSaveAttempt(ownerId, sent.id, id); throw error; }
  clearProjectSaveAttempt(ownerId, sent.id, attempt.sent.pendingCloudSaveId);
  return sent;
}

export function clearProjectSaveAttempt(ownerId: string, projectId: string, id?: string): void {
  // Failed cleanup leaves an unreachable receipt: recovery still requires its
  // exact snapshot reference, content and revision. Never remove another save.
  try {
    if (id) localStorage.removeItem(durableKey(ownerId, projectId, id));
    else if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(key(ownerId, projectId));
  } catch { /* retain */ }
}
