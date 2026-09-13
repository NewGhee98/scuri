type Job = { version: string; due: number; attempts: number };

/** Durable state stays in the project cache; this queue schedules it. One job at
 * a time limits image work and serializes each project's save/delete boundary. */
export class ProjectSyncQueue {
  private jobs = new Map<string, Job>();
  private blocked = new Set<string>();
  private completed = new Map<string, string>();
  private timer?: ReturnType<typeof setTimeout>;
  private active?: { id: string; done: Promise<void> };
  private enabled = false;
  private stopped = false;

  constructor(private push: (id: string) => Promise<boolean>, private delay = 1800) {}

  enqueue(id: string, version: string, immediate = false): void {
    if (this.stopped || this.blocked.has(id)) return;
    const old = this.jobs.get(id);
    if (!old && !immediate && this.completed.get(id) === version) return;
    if (!old || old.version !== version) this.jobs.set(id, { version, due: Date.now() + (immediate ? 0 : this.delay), attempts: 0 });
    else if (immediate) old.due = Date.now();
    this.schedule();
  }

  setEnabled(enabled: boolean): void {
    const reconnect = enabled && !this.enabled;
    this.enabled = enabled;
    if (reconnect) for (const job of this.jobs.values()) job.due = Date.now();
    this.schedule();
  }

  async cancel(id: string): Promise<void> {
    this.blocked.add(id);
    this.jobs.delete(id);
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
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    if (!this.enabled || this.stopped || this.active || !this.jobs.size) return;
    const due = Math.min(...[...this.jobs.values()].map(job => job.due));
    this.timer = setTimeout(() => this.run(), Math.max(0, due - Date.now()));
  }

  private run(): void {
    if (!this.enabled || this.stopped || this.active) return;
    const entry = [...this.jobs].sort((a, b) => a[1].due - b[1].due)[0];
    if (!entry) return;
    const [id, job] = entry;
    // Defer calling push until active is assigned, even for immediate promises.
    const done = Promise.resolve().then(() => this.push(id)).then(success => {
      if (this.jobs.get(id) !== job) return; // a newer edit already has its own job
      if (success) { this.jobs.delete(id); this.completed.set(id, job.version); }
      else {
        job.attempts++;
        job.due = Date.now() + Math.min(60_000, 5_000 * 2 ** Math.min(job.attempts - 1, 4));
      }
    }, () => {
      if (this.jobs.get(id) === job) { job.attempts++; job.due = Date.now() + 60_000; }
    }).finally(() => { this.active = undefined; this.schedule(); });
    this.active = { id, done };
  }
}
