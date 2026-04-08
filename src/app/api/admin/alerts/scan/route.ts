import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getClientIp, rateLimit, rateLimitHeaders } from "@/lib/rateLimit";
import { UserRole } from "@/generated/prisma/client";
import { scanDataAlerts } from "@/lib/analytics";

function isStaff(role: UserRole) {
  return role === UserRole.ADMIN || role === UserRole.MODERATOR || role === UserRole.LEGAL;
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!isStaff(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const ip = getClientIp(req.headers);
  const rl = rateLimit({ key: `admin:alerts:scan:${user.id}:${ip}`, limit: 30, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const out = await scanDataAlerts(prisma, {});
  return NextResponse.json(out);
}

