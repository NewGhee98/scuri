"use client";

import { useId, useState } from "react";
import { normalizePhotoLabel } from "@/lib/photo-metadata";

export function PhotoLabelInput({ title, suggestions, applied = [], disabled = false, onAdd }: {
  title: string; suggestions: readonly string[]; applied?: readonly string[]; disabled?: boolean; onAdd: (label: string) => void;
}) {
  const id = useId(), listId = `${id}-suggestions`;
  const [query, setQuery] = useState(""), [open, setOpen] = useState(false), [active, setActive] = useState(-1);
  const normalized = normalizePhotoLabel(query);
  const matches = suggestions.filter(label => !applied.includes(label) && label.includes(normalized));
  const canCreate = !!normalized && !suggestions.includes(normalized) && !applied.includes(normalized);
  const options = [...matches.map(label => ({ label, create: false })), ...(canCreate ? [{ label: normalized, create: true }] : [])];
  const expanded = open && options.length > 0;
  const add = (label: string) => {
    if (disabled || !label) return;
    onAdd(label); setQuery(""); setActive(-1); setOpen(false);
  };
  return <div className="photo-label-input" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <label htmlFor={id}>{title}</label>
    <div className="photo-label-entry">
      <input id={id} type="text" role="combobox" autoComplete="off" autoCapitalize="none" spellCheck={false}
        aria-autocomplete="list" aria-expanded={expanded} aria-controls={expanded ? listId : undefined}
        aria-activedescendant={expanded && options[active] ? `${id}-option-${active}` : undefined}
        placeholder="Type or choose a label" value={query} disabled={disabled}
        onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
        onChange={event => { setQuery(event.target.value); setActive(-1); setOpen(true); }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") {
            event.preventDefault(); event.stopPropagation();
            add(expanded && options[active] ? options[active].label : normalized);
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); setOpen(true);
            setActive(current => event.key === "ArrowDown" ? Math.min(current + 1, options.length - 1) : Math.max(current - 1, 0));
          } else if (event.key === "Escape" && open) {
            event.preventDefault(); event.stopPropagation(); setOpen(false); setActive(-1);
          }
        }} />
      <button type="button" className="small-button" disabled={disabled || !normalized} onClick={() => add(normalized)}>Add</button>
    </div>
    {expanded ? <div id={listId} role="listbox" aria-label={`${title} suggestions`} className="photo-label-suggestions">
      {options.map((option, index) => <button key={option.label} id={`${id}-option-${index}`} role="option" aria-selected={active === index}
        type="button" tabIndex={-1} onPointerDown={event => event.preventDefault()} onClick={() => add(option.label)}>
        {option.create ? `Create “${option.label}”` : option.label}
      </button>)}
    </div> : null}
  </div>;
}
