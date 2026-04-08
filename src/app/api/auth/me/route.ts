import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauth" }, { status: 401 });
  return NextResponse.json({
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    city: user.city,
    state: user.state,
    status: user.status,
    lastLoginAt: user.lastLoginAt,
    role: user.role,
    points: user.points,
    notifyInApp: user.notifyInApp,
    notifyEmail: user.notifyEmail,
  });
}
