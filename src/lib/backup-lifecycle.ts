/** Coalesce Safari visibility/BFCache and connectivity events into one resume.
 * A full reload uses normal queue initialization once auth/Drive are ready. */
export function watchBackupResume(resume: () => void, page: EventTarget & { hidden: boolean }, browser: EventTarget): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (page.hidden || timer !== undefined) return;
    timer = setTimeout(() => { timer = undefined; if (!page.hidden) resume(); }, 0);
  };
  const restored = (event: Event) => { if ((event as PageTransitionEvent).persisted) schedule(); };
  page.addEventListener("visibilitychange", schedule);
  browser.addEventListener("pageshow", restored);
  browser.addEventListener("online", schedule);
  return () => {
    clearTimeout(timer);
    page.removeEventListener("visibilitychange", schedule);
    browser.removeEventListener("pageshow", restored);
    browser.removeEventListener("online", schedule);
  };
}
