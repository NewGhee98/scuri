"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ActionDialog } from "./action-dialog";

// Screen preferences survive moving between pages in this tab, but never enter
// project data, Undo, or exports. Reloading starts with the full canvas again.
const initialControls = { open: false, locked: false };
let controls = initialControls;
const controlsListeners = new Set<() => void>();
const subscribeControls = (notify: () => void) => {
  controlsListeners.add(notify);
  return () => { controlsListeners.delete(notify); };
};
const controlsSnapshot = () => controls;
const controlsServerSnapshot = () => initialControls;
const updateControls = (next: Partial<typeof controls>) => {
  controls = { ...controls, ...next };
  controlsListeners.forEach(notify => notify());
};

/** Owns screen furniture only; no project or crop state is changed here. */
export function EditorWorkspace({ title, toolbar, panel, status, statusLabel, needsAttention, children }: {
  title: string; toolbar: ReactNode; panel: ReactNode; status: ReactNode; statusLabel: string; needsAttention: boolean; children: ReactNode;
}) {
  const { open: panelOpen, locked: panelLocked } = useSyncExternalStore(subscribeControls, controlsSnapshot, controlsServerSnapshot);
  const controlsButton = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const panelHelpId = useId();
  const activeCanvasPointers = useRef(new Set<number>());
  const [info, setInfo] = useState<"help" | "status" | null>(null);
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const releasePointer = (event: PointerEvent) => { activeCanvasPointers.current.delete(event.pointerId); };
    const clearPointers = () => { activeCanvasPointers.current.clear(); };
    window.addEventListener("pointerup", releasePointer);
    window.addEventListener("pointercancel", releasePointer);
    window.addEventListener("blur", clearPointers);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("pointerup", releasePointer);
      window.removeEventListener("pointercancel", releasePointer);
      window.removeEventListener("blur", clearPointers);
    };
  }, []);
  const closeControls = (restoreFocus = false) => {
    updateControls({ open: false });
    if (restoreFocus) controlsButton.current?.focus();
  };
  return <main className={`editor-workspace${panelOpen ? " panel-open" : ""}`} onKeyDown={event => {
    if (event.key !== "Escape" || event.defaultPrevented || !panelOpen || panelLocked || info
      || (event.target instanceof Element && event.target.closest("dialog"))) return;
    event.preventDefault(); event.stopPropagation(); closeControls(true);
  }}>
    <header className="editor-toolbar" aria-label="Page editor toolbar">
      <h1 className="sr-only">{title}</h1>
      {toolbar}
      <button ref={controlsButton} type="button" className="small-button" aria-expanded={panelOpen} aria-controls={panelId}
        onClick={() => updateControls({ open: !panelOpen })}>{panelOpen ? "Hide controls" : "Controls"}</button>
      <button type="button" className="small-button editor-status-button" data-attention={needsAttention || undefined} aria-label={`Save and backup status: ${statusLabel}`} aria-haspopup="dialog" onClick={() => setInfo("status")}>{needsAttention ? "Status !" : "Status"}</button>
      <button type="button" className="small-button" aria-haspopup="dialog" onClick={() => setInfo("help")}>Help</button>
    </header>
    <section className="editor-canvas-workspace" aria-label="Composition workspace"
      onPointerDownCapture={event => { activeCanvasPointers.current.add(event.pointerId); }}
      onPointerUpCapture={event => { activeCanvasPointers.current.delete(event.pointerId); }}
      onPointerCancelCapture={event => { activeCanvasPointers.current.delete(event.pointerId); }}
      onLostPointerCaptureCapture={event => { activeCanvasPointers.current.delete(event.pointerId); }}
      onClickCapture={event => {
        // Wait for the completed tap so shrinking/growing the stage cannot
        // interrupt a crop drag or a two-finger canvas gesture.
        if (panelOpen && !panelLocked && !activeCanvasPointers.current.size
          && event.target instanceof Element && event.target.closest(".canvas-viewport-stage")) closeControls();
      }}>{children}</section>
    {panelOpen ? <aside id={panelId} className="editor-side-panel" aria-label="Editing controls" aria-describedby={panelHelpId}>
      <header><h2>Editing controls</h2><div className="editor-panel-actions">
        <button type="button" className="small-button" aria-pressed={panelLocked} aria-describedby={panelHelpId}
          onClick={() => updateControls({ locked: !panelLocked })}>Lock controls</button>
        <button type="button" className="small-button" onClick={() => closeControls(true)}>Close controls</button>
      </div><p id={panelHelpId}>{panelLocked ? "Locked open while you edit. Hide controls to reclaim the space." : "Tap the canvas to hide, or lock controls to keep them open."}</p></header>
      {panel}
    </aside> : null}
    {info ? <ActionDialog title={info === "help" ? "Editor help" : "Save and backup status"} onClose={() => setInfo(null)}>
      <div className="editor-info-content"><header><h2>{info === "help" ? "Editor help" : "Save and backup status"}</h2>
        <button type="button" className="small-button" onClick={() => setInfo(null)}>Close</button></header>
      {info === "status" ? status : <>
        <p><strong>Edit:</strong> tap a frame to select it, drag to position its photo, or pinch to change the photo zoom. Open Controls for photo, text, background and border settings.</p>
        <p><strong>Controls:</strong> the panel makes room beside the page, or below it on a phone. Lock controls keeps it open while you edit and move between pages. When unlocked, tap the canvas or press Escape to hide it. Hide controls works at any time.</p>
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
