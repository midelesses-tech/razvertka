import { NextResponse } from "next/server";
import { getSessionUser, toPublicUser, checkPremiumStatus } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ user: null });
  }
  const status = checkPremiumStatus(user);
  return NextResponse.json({ user: toPublicUser(user, status) });
}
