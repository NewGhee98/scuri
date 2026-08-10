import { resolveFrames } from "@/lib/crop";
import type { TemplateDefinition } from "@/lib/types";

interface TemplateThumbnailProps {
  template: TemplateDefinition;
  selected?: boolean;
}

export function TemplateThumbnail({ template, selected = false }: TemplateThumbnailProps) {
  const width = 180;
  const height = (width * template.canvasHeight) / template.canvasWidth;
  const frames = resolveFrames(template, template.defaultGutter, width, height);

  return (
    <svg
      aria-hidden="true"
      className="h-full w-full"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <rect width={width} height={height} fill={template.defaultBackground} />
      {frames.map((frame, index) => (
        <g key={frame.id}>
          <rect
            x={frame.x}
            y={frame.y}
            width={frame.width}
            height={frame.height}
            rx={frame.cornerRadius}
            fill={index % 2 ? "#c8c8c6" : "#dededb"}
          />
          <circle
            cx={frame.x + frame.width / 2}
            cy={frame.y + frame.height / 2}
            r={Math.max(3, Math.min(frame.width, frame.height) * 0.06)}
            fill="#aaa9a6"
          />
        </g>
      ))}
      {selected ? <rect x="1.5" y="1.5" width={width - 3} height={height - 3} fill="none" stroke="#111" strokeWidth="3" /> : null}
    </svg>
  );
}
