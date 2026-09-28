import { readFileSync } from "node:fs";
import * as React from "react";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";

type Node = React.ReactElement<Record<string, unknown>>;
class Target {
  constructor(private selector = "") {}
  closest(selector: string) { return selector === this.selector ? this : null; }
}
const tap = (selector = ".canvas-viewport-stage") => ({ target: new Target(selector) });
const escape = (extra: object = {}) => ({ key: "Escape", defaultPrevented: false, target: new Target(),
  preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra });

// Execute the real workspace and event handlers; each mount gets fresh hooks,
// while the component module retains its display preferences across page visits.
function workspaceModule() {
  let slots: { value?: unknown; deps?: unknown[]; cleanup?: () => void }[] = [];
  let cursor = 0, nodes: Node[] = [], effects: (() => void)[] = [];
  const hooks = { ...React,
    useId: () => `workspace-${cursor++}`,
    useRef: (initial: unknown) => {
      const slot = slots[cursor++] ??= {}; slot.value ??= { current: initial }; return slot.value;
    },
    useState: (initial: unknown) => {
      const slot = slots[cursor++] ??= {}; if (!("value" in slot)) slot.value = initial;
      return [slot.value, (next: unknown) => { slot.value = typeof next === "function" ? next(slot.value) : next; }];
    },
    useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
    useEffect: (effect: () => (() => void) | void, deps: unknown[]) => {
      const slot = slots[cursor++] ??= {};
      if (!slot.deps || deps.some((dep, index) => !Object.is(dep, slot.deps![index]))) {
        slot.deps = deps; effects.push(() => { slot.cleanup?.(); slot.cleanup = effect() || undefined; });
      }
    },
  };
  const body = { style: { overflow: "auto" } }, focus = vi.fn();
  const listeners = new Map<string, (event: unknown) => void>();
  vi.stubGlobal("document", { body }); vi.stubGlobal("Element", Target);
  vi.stubGlobal("window", { addEventListener: (name: string, fn: (event: unknown) => void) => listeners.set(name, fn),
    removeEventListener: (name: string) => listeners.delete(name) });
  const source = readFileSync(new URL("../../components/editor-workspace.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
  } }).outputText;
  const exports: { EditorWorkspace?: (props: object) => React.ReactNode } = {};
  new Function("require", "exports", "const React = require('react'); " + compiled)((id: string) => {
    if (id === "react") return hooks;
    if (id === "./action-dialog") return { ActionDialog: "action-dialog" };
    throw new Error("Unexpected import " + id);
  }, exports);
  const props = { title: "Edit page 1", toolbar: "Page controls", panel: "Photo controls", status: "Saved", statusLabel: "Saved", needsAttention: false, children: "Canvas" };
  const find = (label: string) => nodes.find(node => node.type === label || node.props.children === label || node.props.className === label)!;
  const render = () => {
    cursor = 0; nodes = []; effects = [];
    const walk = (child: React.ReactNode) => {
      if (!React.isValidElement(child)) return;
      const node = child as Node; nodes.push(node); React.Children.forEach(node.props.children as React.ReactNode, walk);
    };
    walk(exports.EditorWorkspace!(props));
    const button = nodes.find(node => node.type === "button" && node.props["aria-controls"]);
    if (button) (button.props.ref as { current: unknown }).current = { focus };
    effects.forEach(effect => effect());
  };
  const call = (label: string, handler: string, ...args: unknown[]) => {
    (find(label).props[handler] as (...args: unknown[]) => void)(...args); render();
  };
  const unmount = () => { slots.forEach(slot => slot.cleanup?.()); slots = []; };
  return { find, call, render, unmount, props, focus, body, listeners, mount: render };
}

afterEach(() => vi.unstubAllGlobals());

describe("docked editor controls", () => {
  it("opens a non-modal panel linked to the toolbar and hides after an unlocked canvas tap", () => {
    const h = workspaceModule(); h.mount();
    expect(h.find("aside")).toBeUndefined();
    h.call("Controls", "onClick");
    expect(h.find("editor-workspace panel-open")).toBeTruthy();
    expect(h.find("dialog")).toBeUndefined();
    expect(h.find("Hide controls").props["aria-controls"]).toBe(h.find("aside").props.id);
    expect(h.find("Hide controls").props["aria-expanded"]).toBe(true);
    h.call("editor-canvas-workspace", "onClickCapture", tap());
    expect(h.find("aside")).toBeUndefined(); h.unmount();
    expect(h.body.style.overflow).toBe("auto"); expect(h.listeners.size).toBe(0);
  });

  it("locks controls during canvas use and Escape but still permits explicit hiding", () => {
    const h = workspaceModule(); h.mount(); h.call("Controls", "onClick"); h.call("Lock controls", "onClick");
    expect(h.find("Lock controls").props["aria-pressed"]).toBe(true);
    h.call("editor-canvas-workspace", "onClickCapture", tap());
    const key = escape(); h.call("main", "onKeyDown", key);
    expect(h.find("aside")).toBeTruthy(); expect(key.preventDefault).not.toHaveBeenCalled();
    h.call("Hide controls", "onClick"); expect(h.find("aside")).toBeUndefined();
    h.call("Controls", "onClick"); expect(h.find("Lock controls").props["aria-pressed"]).toBe(true);
    h.call("Close controls", "onClick"); expect(h.focus).toHaveBeenCalledOnce();
    expect(h.find("aside")).toBeUndefined(); h.unmount();
  });

  it("retains visible and locked preferences when another page is opened, including explicit hiding", () => {
    const h = workspaceModule(); h.mount(); h.call("Controls", "onClick"); h.call("Lock controls", "onClick"); h.unmount();
    h.props.title = "Edit page 2"; h.mount();
    expect(h.find("aside")).toBeTruthy(); expect(h.find("Lock controls").props["aria-pressed"]).toBe(true);
    h.call("Hide controls", "onClick"); h.unmount(); h.mount();
    expect(h.find("aside")).toBeUndefined(); h.call("Controls", "onClick");
    expect(h.find("Lock controls").props["aria-pressed"]).toBe(true); h.unmount();
  });

  it("closes on unlocked Escape and returns focus without stealing nested dialogs or consumed keys", () => {
    const h = workspaceModule(); h.mount(); h.call("Controls", "onClick");
    h.call("main", "onKeyDown", escape({ target: new Target("dialog") })); expect(h.find("aside")).toBeTruthy();
    h.call("main", "onKeyDown", escape({ defaultPrevented: true })); expect(h.find("aside")).toBeTruthy();
    const key = escape(); h.call("main", "onKeyDown", key);
    expect(h.find("aside")).toBeUndefined(); expect(h.focus).toHaveBeenCalledOnce();
    expect(key.preventDefault).toHaveBeenCalledOnce(); expect(key.stopPropagation).toHaveBeenCalledOnce(); h.unmount();
  });

  it("does not dismiss from view controls or midway through a two-pointer gesture", () => {
    const h = workspaceModule(); h.mount(); h.call("Controls", "onClick");
    h.call("editor-canvas-workspace", "onClickCapture", tap(".canvas-view-tools")); expect(h.find("aside")).toBeTruthy();
    h.call("editor-canvas-workspace", "onPointerDownCapture", { pointerId: 1 });
    h.call("editor-canvas-workspace", "onPointerDownCapture", { pointerId: 2 });
    h.call("editor-canvas-workspace", "onPointerUpCapture", { pointerId: 1 });
    h.call("editor-canvas-workspace", "onClickCapture", tap()); expect(h.find("aside")).toBeTruthy();
    // Release outside the canvas must also clear tracked pointers.
    h.listeners.get("pointerup")!({ pointerId: 2 });
    h.call("editor-canvas-workspace", "onClickCapture", tap()); expect(h.find("aside")).toBeUndefined(); h.unmount();
  });
});
