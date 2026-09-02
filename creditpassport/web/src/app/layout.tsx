import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { StatusStrip } from "@/components/status-strip";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "CreditPassport",
  description:
    "A portable credit history on Creditcoin built only from payments proven to have happened on another chain.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <header className="border-b border-border/60">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <ShieldCheck className="size-5 text-emerald-400" aria-hidden />
              <span>CreditPassport</span>
            </Link>
            <nav className="flex items-center gap-4 text-sm text-muted-foreground">
              <Link href="/#how-it-works" className="hover:text-foreground">
                How it works
              </Link>
              <a
                href="https://docs.attestcoin.org/"
                target="_blank"
                rel="noreferrer"
                className="hidden hover:text-foreground sm:inline"
              >
                Attestcoin docs
              </a>
            </nav>
          </div>
          <StatusStrip />
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
        <footer className="border-t border-border/60 py-6 text-center text-xs text-muted-foreground">
          Built for BUIDL CTC 2026 Fall. Testnet software; nothing here is a credit offer.
        </footer>
      </body>
    </html>
  );
}
