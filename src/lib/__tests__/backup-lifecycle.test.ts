import { afterEach, describe, expect, it, vi } from "vitest";
import { watchBackupResume } from "../backup-lifecycle";

afterEach(() => vi.useRealTimers());
describe("foreground backup resumption", () => {
  it("resumes once when the iPad becomes visible, including a restored page and online event", async () => {
    vi.useFakeTimers();
    const page = Object.assign(new EventTarget(), { hidden: true }), browser = new EventTarget(), resume = vi.fn();
    const stop = watchBackupResume(resume, page, browser);
    page.dispatchEvent(new Event("visibilitychange")); browser.dispatchEvent(new Event("online"));
    await vi.runAllTimersAsync(); expect(resume).not.toHaveBeenCalled();
    page.hidden = false; page.dispatchEvent(new Event("visibilitychange"));
    browser.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    browser.dispatchEvent(new Event("online"));
    await vi.runAllTimersAsync(); expect(resume).toHaveBeenCalledTimes(1);
    page.hidden = true; page.dispatchEvent(new Event("visibilitychange"));
    page.hidden = false; page.dispatchEvent(new Event("visibilitychange"));
    await vi.runAllTimersAsync(); expect(resume).toHaveBeenCalledTimes(2);
    stop();
    browser.dispatchEvent(new Event("online")); await vi.runAllTimersAsync(); expect(resume).toHaveBeenCalledTimes(2);
  });

  it("does not duplicate initial startup or resume after the workspace unmounts", async () => {
    vi.useFakeTimers();
    const page = Object.assign(new EventTarget(), { hidden: false }), browser = new EventTarget(), resume = vi.fn();
    const stop = watchBackupResume(resume, page, browser);
    browser.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: false }));
    await vi.runAllTimersAsync(); expect(resume).not.toHaveBeenCalled();
    page.dispatchEvent(new Event("visibilitychange")); stop();
    await vi.runAllTimersAsync(); expect(resume).not.toHaveBeenCalled();
  });
});
