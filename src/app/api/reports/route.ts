import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { getClientIp, rateLimit, rateLimitHeaders } from "@/lib/rateLimit";
import { ReportScope, UserRole } from "@/generated/prisma/client";

function toInt(value: string | null) {
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

function isStaff(role: UserRole) {
  return role === UserRole.ADMIN || role === UserRole.MODERATOR || role === UserRole.LEGAL;
}

export async function GET(req: NextRequest) {
  const ip = getClientIp(req.headers);
  const rl = rateLimit({ key: `reports:list:${ip}`, limit: 120, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const url = new URL(req.url);
  const scopeRaw = url.searchParams.get("scope");
  const scope =
    scopeRaw && Object.values(ReportScope).includes(scopeRaw as ReportScope)
      ? (scopeRaw as ReportScope)
      : null;
  const limit = Math.max(1, Math.min(50, toInt(url.searchParams.get("limit")) ?? 20));

  if (scope === ReportScope.PUBLIC) {
    const items = await prisma.reportSnapshot.findMany({
      where: { scope: ReportScope.PUBLIC },
      orderBy: { generatedAt: "desc" },
      take: limit,
      select: {
        id: true,
        type: true,
        scope: true,
        period: true,
        generatedAt: true,
        companyId: true,
        city: true,
        state: true,
      },
    });
    return NextResponse.json(items);
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const where =
    user.role === UserRole.COMPANY && user.companyId
      ? { scope: ReportScope.COMPANY, companyId: user.companyId }
      : isStaff(user.role)
        ? scope
          ? { scope }
          : {}
        : null;

  if (!where) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const items = await prisma.reportSnapshot.findMany({
    where,
    orderBy: { generatedAt: "desc" },
    take: limit,
    select: {
      id: true,
      type: true,
      scope: true,
      period: true,
      generatedAt: true,
      companyId: true,
      city: true,
      state: true,
    },
  });

  return NextResponse.json(items);
}

