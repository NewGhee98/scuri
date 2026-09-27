"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ActionDialog } from "./action-dialog";

const drawerQuery = "(max-width: 1366px), (pointer: coarse)";
const subscribeDrawer = (notify: () => void) => {
  const media = window.matchMedia(drawerQuery);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};
const drawerSnapshot = () => window.matchMedia(drawerQuery).matches;

function EditingDrawer({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal();
    return () => { if (focused?.isConnected) focused.focus(); };
  }, []);
  return <dialog ref={dialog} className="editor-controls-drawer" aria-label="Editing controls"
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="editor-controls-content">
      <header><h2>Editing controls</h2><button type="button" className="small-button" onClick={onClose}>Close controls</button></header>
      {children}
    </div>
  </dialog>;
}

/** Owns screen furniture only; no project or crop state is changed here. */
export function EditorWorkspace({ title, toolbar, panel, status, statusLabel, needsAttention, children }: {
  title: string; toolbar: ReactNode; panel: ReactNode; status: ReactNode; statusLabel: string; needsAttention: boolean; children: ReactNode;
}) {
  const drawer = useSyncExternalStore(subscribeDrawer, drawerSnapshot, () => true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [info, setInfo] = useState<"help" | "status" | null>(null);
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);
  return <main className={`editor-workspace${panelOpen && !drawer ? " panel-open" : ""}`}>
    <header className="editor-toolbar" aria-label="Page editor toolbar">
      <h1 className="sr-only">{title}</h1>
      {toolbar}
      <button type="button" className="small-button" aria-expanded={panelOpen} aria-haspopup={drawer ? "dialog" : undefined}
        onClick={() => setPanelOpen(value => !value)}>{panelOpen ? "Hide controls" : "Controls"}</button>
      <button type="button" className="small-button editor-status-button" data-attention={needsAttention || undefined} aria-label={`Save and backup status: ${statusLabel}`} aria-haspopup="dialog" onClick={() => setInfo("status")}>{needsAttention ? "Status !" : "Status"}</button>
      <button type="button" className="small-button" aria-haspopup="dialog" onClick={() => setInfo("help")}>Help</button>
    </header>
    <section className="editor-canvas-workspace" aria-label="Composition workspace">{children}</section>
    {panelOpen && !drawer ? <aside className="editor-side-panel" aria-label="Editing controls">
      <header><h2>Editing controls</h2><button type="button" className="small-button" onClick={() => setPanelOpen(false)}>Close controls</button></header>
      {panel}
    </aside> : null}
    {panelOpen && drawer ? <EditingDrawer onClose={() => setPanelOpen(false)}>{panel}</EditingDrawer> : null}
    {info ? <ActionDialog title={info === "help" ? "Editor help" : "Save and backup status"} onClose={() => setInfo(null)}>
      <div className="editor-info-content"><header><h2>{info === "help" ? "Editor help" : "Save and backup status"}</h2>
        <button type="button" className="small-button" onClick={() => setInfo(null)}>Close</button></header>
      {info === "status" ? status : <>
        <p><strong>Edit:</strong> tap a frame to select it, drag to position its photo, or pinch to change the photo zoom. Open Controls for photo, text, background and border settings.</p>
        <p><strong>Navigate:</strong> drag or pinch to inspect the whole canvas. Fit shows the entire page and follows changes to the available space. Canvas zoom never changes crops or exported pixels.</p>
        <p><strong>Photo zoom:</strong> 0% fills the frame. Negative values reveal the page background. Centre photo keeps the zoom; Reset restores centred 0%.</p>
        <p><strong>Frames and text:</strong> Controls lets you rearrange photos, move frames, or add text. Arrow keys move a selected frame; Shift uses larger steps. Alt bypasses snapping.</p>
        <p><strong>Guides:</strong> thirds, centre lines and selection marks are editing aids. They never appear in export preview or the exported image.</p>
        <p><strong>Undo:</strong> history resets when you open another project, reload or change accounts. Signed-in projects save automatically; Status shows backup details.</p>
      </>}
      </div>
    </ActionDialog> : null}
  </main>;
}
