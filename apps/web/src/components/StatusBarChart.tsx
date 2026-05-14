'use client';

/**
 * Pure-SVG horizontal bar chart for status/category breakdowns.
 * No external charting library required.
 *
 * Props:
 *   data  – array of { label, value, color? } buckets (already sorted by caller if desired)
 *   title – optional heading rendered above the chart
 *   height – SVG canvas height in px (default 200)
 *   showValues – whether to render value labels (default true)
 */

export interface StatusBarChartItem {
  label: string;
  value: number;
  /** Tailwind hex or CSS colour string, e.g. "#6366f1". Defaults to indigo. */
  color?: string;
}

interface StatusBarChartProps {
  data: StatusBarChartItem[];
  title?: string;
  /** Height of the chart SVG in px. Width is always 100% of the container. */
  height?: number;
  showValues?: boolean;
  className?: string;
}

const DEFAULT_COLORS = [
  '#6366f1', // indigo
  '#22d3ee', // cyan
  '#a3e635', // lime
  '#f59e0b', // amber
  '#f43f5e', // rose
  '#8b5cf6', // violet
  '#14b8a6', // teal
  '#fb923c', // orange
];

export function StatusBarChart({
  data,
  title,
  height = 200,
  showValues = true,
  className = '',
}: StatusBarChartProps) {
  if (!data || data.length === 0) return null;

  const paddingLeft = 100; // label column width
  const paddingRight = 56; // value label column
  const paddingTop = 8;
  const paddingBottom = 8;

  const maxValue = Math.max(...data.map((d) => d.value), 1);
  const barAreaHeight = height - paddingTop - paddingBottom;
  const barHeight = Math.max(8, Math.floor((barAreaHeight / data.length) * 0.65));
  const barGap = Math.max(4, Math.floor((barAreaHeight / data.length) * 0.35));
  const chartHeight = data.length * (barHeight + barGap) + paddingTop + paddingBottom;

  return (
    <div className={`w-full ${className}`}>
      {title && (
        <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-slate-500">
          {title}
        </p>
      )}
      <svg
        viewBox={`0 0 400 ${chartHeight}`}
        className="w-full overflow-visible"
        aria-label={title ?? 'Bar chart'}
        role="img"
      >
        {data.map((item, i) => {
          const y = paddingTop + i * (barHeight + barGap);
          const barColor = item.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length];
          const barWidth = Math.max(
            2,
            Math.round(((400 - paddingLeft - paddingRight) * item.value) / maxValue)
          );

          return (
            <g key={item.label}>
              {/* Label */}
              <text
                x={paddingLeft - 8}
                y={y + barHeight / 2 + 4}
                textAnchor="end"
                className="fill-slate-400 text-[10px]"
                fontSize={10}
                fontFamily="ui-monospace, monospace"
              >
                {item.label.length > 14 ? `${item.label.slice(0, 13)}…` : item.label}
              </text>

              {/* Bar background track */}
              <rect
                x={paddingLeft}
                y={y}
                width={400 - paddingLeft - paddingRight}
                height={barHeight}
                rx={3}
                fill="#1f2937"
              />

              {/* Bar fill */}
              <rect
                x={paddingLeft}
                y={y}
                width={barWidth}
                height={barHeight}
                rx={3}
                fill={barColor}
                opacity={0.85}
              />

              {/* Value label */}
              {showValues && (
                <text
                  x={paddingLeft + barWidth + 6}
                  y={y + barHeight / 2 + 4}
                  fontSize={10}
                  fontFamily="ui-monospace, monospace"
                  fill="#94a3b8"
                >
                  {item.value.toLocaleString()}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
