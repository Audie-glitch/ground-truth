import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-xl font-medium">That is not an address</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Passports are keyed by the payer&apos;s 0x… address on the source chain.
      </p>
      <Link href="/" className={buttonVariants({ className: "mt-6" })}>
        Back to search
      </Link>
    </div>
  );
}
