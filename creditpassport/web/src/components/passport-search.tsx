"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { isAddress } from "viem";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PassportSearch({ size = "lg" }: { size?: "lg" | "sm" }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!isAddress(trimmed)) {
      setError("Enter a 0x… address (40 hex characters).");
      return;
    }
    setError(null);
    router.push(`/passport/${trimmed}`);
  };

  return (
    <form onSubmit={submit} className="w-full">
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Payer address, e.g. 0x7099…79C8"
          aria-label="Payer address"
          className={size === "lg" ? "h-11 font-mono text-sm" : "h-9 font-mono text-xs"}
          spellCheck={false}
          autoComplete="off"
        />
        <Button type="submit" className={size === "lg" ? "h-11" : "h-9"}>
          <Search className="size-4" aria-hidden />
          Open passport
        </Button>
      </div>
      {error && (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
