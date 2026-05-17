import { NextRequest, NextResponse } from "next/server";
import { isEmailAllowed, signUnlockCookie, UNLOCK_COOKIE } from "@/lib/unlock";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  let email = "";
  try {
    const body = (await req.json()) as { email?: string };
    email = (body.email ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  if (!isEmailAllowed(email)) {
    return NextResponse.json({ error: "Email not on allowlist" }, { status: 403 });
  }

  const { value, maxAge } = await signUnlockCookie(email);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(UNLOCK_COOKIE, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge,
  });
  return res;
}
