import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getClientIp, rateLimit, rateLimitHeaders } from "@/lib/rateLimit";
import { DataAlertScope, UserRole } from "@/generated/prisma/client";

function isStaff(role: UserRole) {
  return role === UserRole.ADMIN || role === UserRole.MODERATOR || role === UserRole.LEGAL;
}

export async function GET(req: NextRequest) {
  const user = await requireUser();
  const ip = getClientIp(req.headers);
  const rl = rateLimit({ key: `alerts:list:${user.id}:${ip}`, limit: 120, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const where =
    user.role === UserRole.COMPANY && user.companyId
      ? { scope: DataAlertScope.COMPANY, companyId: user.companyId }
      : isStaff(user.role)
        ? {}
        : null;

  if (!where) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const items = await prisma.dataAlert.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 60,
    select: {
      id: true,
      scope: true,
      type: true,
      title: true,
      message: true,
      severity: true,
      meta: true,
      createdAt: true,
      resolvedAt: true,
      companyId: true,
      city: true,
      state: true,
    },
  });

  return NextResponse.json(items);
}

