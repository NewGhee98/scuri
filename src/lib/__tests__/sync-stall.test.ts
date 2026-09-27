import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectSyncQueue, type SyncJobContext } from "../sync-queue";

afterEach(() => vi.useRealTimers());

describe("stalled backup scheduling", () => {
  it("retries the current project even when another project never responds", async () => {
    vi.useFakeTimers();
    let finishOld!: (value: boolean) => void;
    const push = vi.fn().mockImplementationOnce(() => new Promise<boolean>(resolve => { finishOld = resolve; })).mockResolvedValue(true);
    const queue = new ProjectSyncQueue(push, 0);
    queue.setEnabled(true); queue.enqueue("older-project", "v1");
    await vi.advanceTimersByTimeAsync(0);
    queue.enqueue("121-photo-project", "v1");
    queue.retry("121-photo-project", "retry");
    await vi.advanceTimersByTimeAsync(1);
    expect(push.mock.calls.map(([id]) => id)).toEqual(["older-project", "121-photo-project"]);
    expect(push.mock.calls[0][1].signal.aborted).toBe(true);
    finishOld(true); // A late completion cannot remove the queued old project.
    await vi.advanceTimersByTimeAsync(5000);
    expect(push.mock.calls.map(([id]) => id)).toEqual(["older-project", "121-photo-project", "older-project"]);
    queue.stop();
  });

  it("releases a stalled metadata checkpoint and later retries the same version", async () => {
    vi.useFakeTimers();
    const stalled = vi.fn(), push = vi.fn().mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue(true);
    const queue = new ProjectSyncQueue(push, 0, stalled);
    queue.setEnabled(true);
    const saved = queue.flush("project", "reserved-original");
    await vi.advanceTimersByTimeAsync(90_000);
    expect(await saved).toBe(false);
    expect(stalled).toHaveBeenCalledWith("project");
    expect(push.mock.calls[0][1].signal.aborted).toBe(true);
    expect(await (async () => {
      const retried = queue.flush("project", "reserved-original");
      await vi.advanceTimersByTimeAsync(1);
      return retried;
    })()).toBe(true);
    queue.stop();
  });

  it("allows a long backup while it continues making progress", async () => {
    vi.useFakeTimers();
    let finish!: (value: boolean) => void;
    const push = vi.fn<(id: string, context: SyncJobContext) => Promise<boolean>>().mockImplementation(() => new Promise<boolean>(resolve => { finish = resolve; })), stalled = vi.fn();
    const queue = new ProjectSyncQueue(push, 0, stalled);
    queue.setEnabled(true); queue.enqueue("project", "v1");
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(60_000);
      push.mock.calls[0][1].heartbeat();
    }
    expect(stalled).not.toHaveBeenCalled();
    finish(true); await vi.advanceTimersByTimeAsync(1);
    expect(queue.isRunning()).toBe(false);
    queue.stop();
  });

  it("cancels a backup's wait without acknowledging or cancelling its metadata save", async () => {
    vi.useFakeTimers();
    let finish!: (value: boolean) => void;
    const push = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    const queue = new ProjectSyncQueue(push, 0), abort = new AbortController();
    queue.setEnabled(true);
    const first = queue.flush("project", "v1", abort.signal);
    await vi.advanceTimersByTimeAsync(0); abort.abort();
    expect(await first).toBe(false);
    expect(queue.isRunning()).toBe(true);
    finish(true); await vi.advanceTimersByTimeAsync(1);
    expect(queue.isRunning()).toBe(false);
    queue.stop();
  });
});
