/** Unscoped older caches stay in the local workspace. Never guess an owner. */
export function workspaceKey(base: string, ownerId?: string | null): string {
  return ownerId ? `${base}.account.${encodeURIComponent(ownerId)}` : base;
}

/** Async work captures this generation and stops if the workspace changes. */
export class WorkspaceSession {
  ownerId: string | null = null;
  private generation = 0;
  switchTo(ownerId: string | null): boolean {
    if (ownerId === this.ownerId) return false;
    this.ownerId = ownerId;
    this.generation++;
    return true;
  }
  capture(): () => boolean {
    const generation = this.generation;
    return () => generation === this.generation;
  }
}
