import { NextRequest, NextResponse } from "next/server";
import { verifyUnlockCookie, UNLOCK_COOKIE } from "@/lib/unlock";

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|unlock|api/unlock).*)"],
};

export async function middleware(req: NextRequest) {
  const token = req.cookies.get(UNLOCK_COOKIE)?.value;
  const ok = token ? await verifyUnlockCookie(token) : false;

  if (ok) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/unlock";
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}
