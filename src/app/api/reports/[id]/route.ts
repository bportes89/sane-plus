import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { getClientIp, rateLimit, rateLimitHeaders } from "@/lib/rateLimit";
import { ReportScope, UserRole } from "@/generated/prisma/client";

function isStaff(role: UserRole) {
  return role === UserRole.ADMIN || role === UserRole.MODERATOR || role === UserRole.LEGAL;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ip = getClientIp(req.headers);
  const rl = rateLimit({ key: `reports:get:${ip}`, limit: 240, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const { id } = await params;
  const item = await prisma.reportSnapshot.findUnique({
    where: { id },
    select: {
      id: true,
      type: true,
      scope: true,
      period: true,
      payload: true,
      generatedAt: true,
      companyId: true,
      city: true,
      state: true,
    },
  });
  if (!item) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (item.scope === ReportScope.PUBLIC) return NextResponse.json(item);

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  if (item.scope === ReportScope.COMPANY) {
    if (user.role !== UserRole.COMPANY || user.companyId !== item.companyId) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return NextResponse.json(item);
  }

  if (!isStaff(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json(item);
}

