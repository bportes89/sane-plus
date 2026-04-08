import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getClientIp, rateLimit, rateLimitHeaders } from "@/lib/rateLimit";
import { UserRole } from "@/generated/prisma/client";
import { computeCompanyDashboard, getWindowDays } from "@/lib/analytics";

export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (user.role !== UserRole.COMPANY || !user.companyId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const ip = getClientIp(req.headers);
  const rl = rateLimit({ key: `analytics:company:${user.id}:${ip}`, limit: 120, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const url = new URL(req.url);
  const windowDays = getWindowDays(url.searchParams.get("windowDays"), 30);
  const data = await computeCompanyDashboard(prisma, { companyId: user.companyId, windowDays });
  return NextResponse.json(data);
}

