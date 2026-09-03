import Link from "next/link";

const LINKS = [
  { href: "/", label: "Backtester" },
  { href: "/earn", label: "Earn" },
  { href: "/connect", label: "Connect" },
] as const;

export function SiteNav() {
  return (
    <nav
      aria-label="Primary"
      className="border-b border-foreground/10 bg-background/80 backdrop-blur"
    >
      <div className="mx-auto flex h-12 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          Ground Truth
        </Link>
        <ul className="flex items-center gap-4 text-sm text-muted-foreground">
          {LINKS.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="hover:text-foreground"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
