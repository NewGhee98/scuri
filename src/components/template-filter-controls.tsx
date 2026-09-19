import { FORMATS, getFormat } from "@/lib/formats";
import { DEFAULT_TEMPLATE_FILTERS, getTemplatePhotoCounts, type TemplateLibraryFilters } from "@/lib/templates";
import type { FormatId, TemplateDefinition } from "@/lib/types";

export function TemplateFilterControls({ templates, filters, onChange, fixedFormat }: {
  templates: readonly TemplateDefinition[];
  filters: TemplateLibraryFilters;
  onChange: (filters: TemplateLibraryFilters) => void;
  fixedFormat?: FormatId;
}) {
  const photoCounts = getTemplatePhotoCounts(templates);
  const hasFilters = (!fixedFormat && filters.formatId !== "all") || filters.photoCount !== "all" || filters.edgeStyle !== "all";
  const buttonClass = (selected: boolean) => `nav-button template-filter-button ${selected ? "active" : ""}`;

  return <>
    {fixedFormat ? (
      <p className="mt-5 text-sm text-neutral-600">Showing layouts for this project: {getFormat(fixedFormat).name} · {getFormat(fixedFormat).aspectRatio}</p>
    ) : (
      <div className="mt-7 flex flex-wrap gap-2" role="group" aria-label="Filter templates by format">
        <button className={buttonClass(filters.formatId === "all")} aria-pressed={filters.formatId === "all"} type="button" onClick={() => onChange({ ...filters, formatId: "all" })}>All</button>
        {FORMATS.map(item => (
          <button key={item.id} className={buttonClass(filters.formatId === item.id)} aria-pressed={filters.formatId === item.id} type="button" onClick={() => onChange({ ...filters, formatId: item.id })}>{item.shortLabel}</button>
        ))}
      </div>
    )}
    <section className="mt-5 rounded-[18px] border border-black/10 bg-white/45 p-4 sm:p-5" aria-label="Filter templates">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Filter templates</h2>
        {hasFilters ? <button className="text-button" type="button" onClick={() => onChange({ ...DEFAULT_TEMPLATE_FILTERS, formatId: fixedFormat ?? "all" })}>Clear filters</button> : null}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2" role="group" aria-label="Photos">
        <span className="mr-1 text-xs font-medium text-neutral-600">Photos</span>
        <button className={buttonClass(filters.photoCount === "all")} aria-pressed={filters.photoCount === "all"} type="button" onClick={() => onChange({ ...filters, photoCount: "all" })}>All</button>
        {photoCounts.map(count => (
          <button key={count} className={buttonClass(filters.photoCount === count)} aria-pressed={filters.photoCount === count} type="button" onClick={() => onChange({ ...filters, photoCount: count })}>{count}</button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Corners">
        <span className="mr-1 text-xs font-medium text-neutral-600">Corners</span>
        {(["all", "rounded", "straight", "mixed"] as const).map(edgeStyle => (
          <button key={edgeStyle} className={buttonClass(filters.edgeStyle === edgeStyle)} aria-pressed={filters.edgeStyle === edgeStyle} type="button" onClick={() => onChange({ ...filters, edgeStyle })}>
            {edgeStyle === "all" ? "All" : edgeStyle[0].toUpperCase() + edgeStyle.slice(1)}
          </button>
        ))}
      </div>
    </section>
  </>;
}
