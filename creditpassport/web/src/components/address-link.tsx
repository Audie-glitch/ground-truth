import { ExternalLink } from "lucide-react";
import { shortAddress, shortHash } from "@/lib/format";

export function Hash({ value, href, kind = "hash" }: { value: string; href?: string | null; kind?: "hash" | "address" }) {
  const label = kind === "address" ? shortAddress(value) : shortHash(value);
  if (!href) {
    return (
      <span className="font-mono text-xs text-muted-foreground" title={value}>
        {label}
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={value}
      className="inline-flex items-center gap-1 font-mono text-xs text-sky-300 hover:underline"
    >
      {label}
      <ExternalLink className="size-3" aria-hidden />
    </a>
  );
}
