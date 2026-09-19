"use client";
import { useEffect, useRef, type ReactNode } from "react";
export function ActionDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.showModal(); return () => { focused?.focus(); }; }, []);
  return <dialog ref={ref} className="library-action-dialog" aria-label={title} onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}>{children}</dialog>;
}
