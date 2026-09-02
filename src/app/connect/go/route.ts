import { NextResponse } from "next/server";

import { currentPhantomConnectUrl } from "@/lib/phantom-connect-url";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const connectUrl = currentPhantomConnectUrl();
  if (connectUrl) {
    return NextResponse.redirect(connectUrl, 302);
  }
  return NextResponse.redirect(new URL("/connect", request.url), 302);
}
