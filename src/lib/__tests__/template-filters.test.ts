import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TemplateFilterControls } from "../../components/template-filter-controls";
import { DEFAULT_TEMPLATE_FILTERS, filterTemplates, getTemplatePhotoCounts, getTemplatesForFormat, TEMPLATES, type TemplateLibraryFilters } from "../templates";
import type { CustomTemplate } from "../types";

type ElementProps = { children?: ReactNode; "aria-label"?: string; "aria-pressed"?: boolean; onClick?: () => void };
function elements(node: ReactNode): ReactElement<ElementProps>[] {
  return Children.toArray(node).flatMap(child => isValidElement<ElementProps>(child) ? [child, ...elements(child.props.children)] : []);
}
function group(tree: ReactNode, label: string) {
  return elements(tree).find(element => element.props["aria-label"] === label)!;
}
function buttons(tree: ReactNode) { return elements(tree).filter(element => element.type === "button"); }

const base = getTemplatesForFormat("instagram-post")[0];
const custom: CustomTemplate = { ...base, id: "synthetic-mixed-nine", name: "Nine mixed frames", source: "custom", status: "saved", syncState: "local",
  createdAt: "2026-09-19", updatedAt: "2026-09-19", frames: Array.from({ length: 9 }, (_, i) => ({
    id: `frame-${i}`, x: 0, y: i / 9, width: 1, height: 1 / 9, cornerRadius: i ? 0 : .05,
  })) };

describe("shared template filter controls", () => {
  it("offers the same photo-count and corner choices in the library and project picker", () => {
    const templates = getTemplatesForFormat("instagram-post", [custom]);
    const props = { templates, filters: DEFAULT_TEMPLATE_FILTERS, onChange: vi.fn() };
    const library = TemplateFilterControls(props), picker = TemplateFilterControls({ ...props, fixedFormat: "instagram-post" });
    for (const label of ["Photos", "Corners"]) {
      expect(buttons(group(picker, label)).map(button => button.props.children)).toEqual(buttons(group(library, label)).map(button => button.props.children));
    }
    expect(buttons(group(picker, "Photos")).map(button => button.props.children)).toEqual(["All", 1, 2, 3, 4, 5, 6, 7, 9]);
    expect(buttons(group(picker, "Corners")).map(button => button.props.children)).toEqual(["All", "Rounded", "Straight", "Mixed"]);
    expect(group(picker, "Filter templates by format")).toBeUndefined();
    expect(buttons(group(library, "Filter templates by format")).map(button => button.props.children)).toEqual(["All", "Post", "Square", "Story"]);
    expect(renderToStaticMarkup(picker)).toContain("Showing layouts for this project: Instagram Post · 4:5");
  });

  it("combines actual count/corner control actions and clears them without changing a fixed format", () => {
    const templates = getTemplatesForFormat("instagram-post", [custom]);
    let filters: TemplateLibraryFilters = { ...DEFAULT_TEMPLATE_FILTERS, formatId: "instagram-post" };
    const render = () => TemplateFilterControls({ templates, filters, fixedFormat: "instagram-post", onChange: next => { filters = next; } });
    buttons(group(render(), "Photos")).find(button => button.props.children === 9)!.props.onClick!();
    buttons(group(render(), "Corners")).find(button => button.props.children === "Mixed")!.props.onClick!();
    expect(filterTemplates(templates, filters).map(template => template.id)).toEqual([custom.id]);
    expect(buttons(group(render(), "Corners")).find(button => button.props.children === "Mixed")!.props["aria-pressed"]).toBe(true);
    buttons(group(render(), "Corners")).find(button => button.props.children === "Rounded")!.props.onClick!();
    expect(filterTemplates(templates, filters)).toEqual([]);
    buttons(render()).find(button => button.props.children === "Clear filters")!.props.onClick!();
    expect(filters).toEqual({ ...DEFAULT_TEMPLATE_FILTERS, formatId: "instagram-post" });
    expect(filterTemplates(templates, filters)).toEqual(templates);
  });

  it("keeps library format selection and its full reset available", () => {
    const onChange = vi.fn();
    const tree = TemplateFilterControls({ templates: TEMPLATES, filters: { formatId: "instagram-story", photoCount: 3, edgeStyle: "rounded" }, onChange });
    buttons(group(tree, "Filter templates by format")).find(button => button.props.children === "Square")!.props.onClick!();
    expect(onChange).toHaveBeenLastCalledWith({ formatId: "instagram-square", photoCount: 3, edgeStyle: "rounded" });
    buttons(tree).find(button => button.props.children === "Clear filters")!.props.onClick!();
    expect(onChange).toHaveBeenLastCalledWith(DEFAULT_TEMPLATE_FILTERS);
  });

  it("derives available counts from the eligible pool, without offering drafts or incompatible custom counts", () => {
    const draft: CustomTemplate = { ...custom, id: "draft", status: "draft", frames: custom.frames.slice(0, 8) };
    const incompatible: CustomTemplate = { ...custom, id: "story", formatId: "instagram-story", frames: custom.frames.slice(0, 6) };
    const templates = getTemplatesForFormat("instagram-post", [custom, draft, incompatible]);
    expect(getTemplatePhotoCounts(templates)).toEqual([1, 2, 3, 4, 5, 6, 7, 9]);
    expect(templates.map(template => template.id)).not.toContain(draft.id);
    expect(templates.map(template => template.id)).not.toContain(incompatible.id);
    expect(filterTemplates(templates, { formatId: "all", photoCount: "all", edgeStyle: "mixed" }).map(template => template.id)).toEqual([custom.id]);
    expect([custom, draft, incompatible].map(template => template.status)).toEqual(["saved", "draft", "saved"]);
  });
});
