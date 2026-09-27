type Job = { version: string; due: number; attempts: number; priority?: boolean };
export interface SyncJobContext { signal: AbortSignal; heartbeat: () => void }
export const SYNC_STALL_TIMEOUT = 90_000;

/** Durable state stays in the project cache; this queue schedules it. One job at
 * a time limits image work and serializes each project's save/delete boundary. */
export class ProjectSyncQueue {
  private jobs = new Map<string, Job>();
  private blocked = new Set<string>();
  private completed = new Map<string, string>();
  private timer?: ReturnType<typeof setTimeout>;
  private active?: { id: string; done: Promise<void>; abort: AbortController };
  private enabled = false;
  private stopped = false;
  private waiters = new Map<string, Array<(success: boolean) => void>>();

  constructor(private push: (id: string, context: SyncJobContext) => Promise<boolean>, private delay = 1800,
    private onStall?: (id: string) => void) {}

  enqueue(id: string, version: string, immediate = false): void {
    if (this.stopped || this.blocked.has(id)) return;
    const old = this.jobs.get(id);
    if (!old && !immediate && this.completed.get(id) === version) return;
    if (!old || old.version !== version) this.jobs.set(id, { version, due: Date.now() + (immediate || old?.priority ? 0 : this.delay), attempts: 0, priority: old?.priority });
    else if (immediate) old.due = Date.now();
    this.schedule();
  }

  setEnabled(enabled: boolean): void {
    const reconnect = enabled && !this.enabled;
    this.enabled = enabled;
    if (!enabled) for (const id of this.waiters.keys()) this.finish(id, false);
    if (reconnect) for (const job of this.jobs.values()) job.due = Date.now();
    this.schedule();
  }

  /** User-requested restart. Interrupted work retains its durable checkpoints;
   * its callback must honour the attempt signal before any further mutation. */
  retry(id: string, version: string): void {
    if (this.stopped || this.blocked.has(id)) return;
    if (this.active) {
      const pending = this.jobs.get(this.active.id);
      if (pending) pending.due = Date.now() + 5000;
      this.active.abort.abort();
    }
    // Replace even an identical version so the old attempt cannot settle it.
    this.jobs.set(id, { version, due: Date.now(), attempts: 0, priority: true });
    this.schedule();
  }

  async cancel(id: string): Promise<void> {
    this.blocked.add(id);
    this.jobs.delete(id);
    this.finish(id, false);
    if (this.active?.id === id) await this.active.done;
    this.schedule();
  }

  allow(id: string): void { this.blocked.delete(id); }
  isBlocked(id: string): boolean { return this.blocked.has(id); }
  isRunning(): boolean { return Boolean(this.active); }
  stop(): void {
    this.stopped = true;
    this.jobs.clear();
    if (this.timer) clearTimeout(this.timer);
    this.active?.abort.abort();
    for (const id of this.waiters.keys()) this.finish(id, false);
  }

  /** Wait for the latest queued metadata, without putting byte transfers in
   * this queue. Superseding edits must finish too before an upload may start. */
  flush(id: string, version: string, signal?: AbortSignal): Promise<boolean> {
    if (!this.enabled || this.stopped || this.blocked.has(id) || signal?.aborted) return Promise.resolve(false);
    return new Promise(resolve => {
      const finish = (success: boolean) => { signal?.removeEventListener("abort", cancel); resolve(success); };
      const cancel = () => {
        const remaining = this.waiters.get(id)?.filter(waiter => waiter !== finish);
        if (remaining?.length) this.waiters.set(id, remaining); else this.waiters.delete(id);
        finish(false);
      };
      signal?.addEventListener("abort", cancel, { once: true });
      this.waiters.set(id, [...(this.waiters.get(id) ?? []), finish]);
      this.enqueue(id, version, true);
    });
  }
  private finish(id: string, success: boolean) {
    const waiting = this.waiters.get(id); this.waiters.delete(id); waiting?.forEach(resolve => resolve(success));
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    if (!this.enabled || this.stopped || this.active || !this.jobs.size) return;
    const due = Math.min(...[...this.jobs.values()].map(job => job.due));
    this.timer = setTimeout(() => this.run(), Math.max(0, due - Date.now()));
  }

  private run(): void {
    if (!this.enabled || this.stopped || this.active) return;
    const entry = [...this.jobs].filter(([, job]) => job.due <= Date.now())
      .sort((a, b) => Number(Boolean(b[1].priority)) - Number(Boolean(a[1].priority)) || a[1].due - b[1].due)[0];
    if (!entry) { this.schedule(); return; }
    const [id, job] = entry;
    const abort = new AbortController();
    let timeout: ReturnType<typeof setTimeout>;
    const heartbeat = () => {
      if (abort.signal.aborted) return;
      clearTimeout(timeout);
      timeout = setTimeout(() => { this.onStall?.(id); abort.abort(); }, SYNC_STALL_TIMEOUT);
    };
    heartbeat();
    let cancelled!: () => void;
    const interrupted = new Promise<boolean>(resolve => {
      cancelled = () => resolve(false);
      abort.signal.addEventListener("abort", cancelled, { once: true });
    });
    // Defer calling push until active is assigned, even for immediate promises.
    const work = Promise.resolve().then(() => abort.signal.aborted ? false : this.push(id, { signal: abort.signal, heartbeat }));
    const done = Promise.race([work, interrupted]).then(success => {
      if (abort.signal.aborted) success = false;
      if (!success) this.finish(id, false);
      if (this.jobs.get(id) !== job) return; // a newer edit already has its own job
      if (success) { this.jobs.delete(id); this.completed.set(id, job.version); this.finish(id, true); }
      else {
        job.priority = false;
        job.attempts++;
        job.due = Date.now() + Math.min(60_000, 5_000 * 2 ** Math.min(job.attempts - 1, 4));
      }
    }, () => {
      this.finish(id, false);
      if (this.jobs.get(id) === job) { job.priority = false; job.attempts++; job.due = Date.now() + 60_000; }
    }).finally(() => {
      clearTimeout(timeout); abort.signal.removeEventListener("abort", cancelled);
      this.active = undefined; this.schedule();
    });
    this.active = { id, done, abort };
  }
}
