import { InfoIcon } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Props = {
  label: string;
  value: string;
  hint: string;
  sub?: string;
  tone?: "neutral" | "good" | "bad";
};

export function MetricTile({ label, value, hint, sub, tone = "neutral" }: Props) {
  return (
    <div className="rounded-lg bg-muted/40 p-3 ring-1 ring-foreground/5">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <span className="truncate">{label}</span>
        <Tooltip>
          <TooltipTrigger
            className="shrink-0 opacity-50 transition-opacity hover:opacity-100"
            aria-label={`What ${label} means`}
          >
            <InfoIcon className="size-3" />
          </TooltipTrigger>
          <TooltipContent className="max-w-64 text-pretty">{hint}</TooltipContent>
        </Tooltip>
      </div>
      <div
        className={cn(
          "mt-1 font-mono text-lg tabular-nums",
          tone === "good" && "text-emerald-400",
          tone === "bad" && "text-rose-400",
        )}
      >
        {value}
      </div>
      {sub ? (
        <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>
      ) : null}
    </div>
  );
}
