import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Every path except static assets, image files and the readiness probe.
     * Auth cookies must be refreshed on navigation, not on asset fetches —
     * and `/health` is neither. It answers whether the server is serving, so
     * routing it through a Supabase round trip would make it report on
     * something it does not claim to measure, several times a minute.
     */
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|health$|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
