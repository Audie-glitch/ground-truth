"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatCompactUsd, formatDate, formatShortDate } from "@/lib/format";
import type { EquityPoint } from "@/lib/types";

type Props = {
  data: EquityPoint[];
  strategyName: string;
};

type TooltipPayload = {
  payload?: EquityPoint;
};

function ChartTooltip({
  active,
  payload,
  strategyName,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  strategyName: string;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div className="rounded-lg bg-popover/95 px-3 py-2 text-xs shadow-lg ring-1 ring-foreground/10 backdrop-blur">
      <div className="mb-1.5 font-medium text-foreground">
        {formatDate(point.t)}
      </div>
      <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 tabular-nums">
        <dt className="flex items-center gap-1.5 text-muted-foreground">
          <span className="size-2 rounded-full bg-chart-1" />
          {strategyName}
        </dt>
        <dd className="text-right font-medium">
          {formatCompactUsd(point.equity)}
        </dd>
        <dt className="flex items-center gap-1.5 text-muted-foreground">
          <span className="size-2 rounded-full bg-muted-foreground" />
          Buy &amp; hold
        </dt>
        <dd className="text-right font-medium">
          {formatCompactUsd(point.benchmark)}
        </dd>
        <dt className="text-muted-foreground">Position</dt>
        <dd className="text-right font-medium">
          {point.exposure > 0.001 ? "In market" : "In cash"}
        </dd>
      </dl>
    </div>
  );
}

export function EquityChart({ data, strategyName }: Props) {
  return (
    <div className="space-y-2">
      <div className="h-[280px] w-full sm:h-[340px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              className="stroke-foreground/10"
            />
            <XAxis
              dataKey="t"
              tickFormatter={(t: number) => formatShortDate(t)}
              minTickGap={48}
              tickLine={false}
              axisLine={false}
              className="text-[11px] fill-muted-foreground"
            />
            <YAxis
              tickFormatter={(v: number) => formatCompactUsd(v)}
              width={62}
              tickLine={false}
              axisLine={false}
              className="text-[11px] fill-muted-foreground"
              domain={["auto", "auto"]}
            />
            <Tooltip
              content={<ChartTooltip strategyName={strategyName} />}
              cursor={{ className: "stroke-foreground/20" }}
            />
            <Line
              type="monotone"
              dataKey="benchmark"
              stroke="currentColor"
              className="text-muted-foreground/60"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="equity"
              stroke="currentColor"
              className="text-chart-1"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <ExposureRibbon data={data} />

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-chart-1" />
          {strategyName}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-muted-foreground/60" />
          Buy &amp; hold
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-xs bg-chart-1/40" />
          Holding the asset
        </span>
      </div>
    </div>
  );
}

/**
 * A one-pixel-tall map of when the strategy was actually exposed. Seeing the
 * gaps is the fastest way to understand why a strategy missed a rally.
 */
function ExposureRibbon({ data }: { data: EquityPoint[] }) {
  if (data.length === 0) return null;
  return (
    <div
      className="ml-[62px] flex h-2.5 w-[calc(100%-70px)] overflow-hidden rounded-xs bg-muted"
      aria-hidden
    >
      {data.map((point) => (
        <span
          key={point.t}
          className={
            point.exposure > 0.001 ? "flex-1 bg-chart-1/40" : "flex-1 bg-transparent"
          }
        />
      ))}
    </div>
  );
}
