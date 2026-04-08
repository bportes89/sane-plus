import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getClientIp, rateLimit, rateLimitHeaders } from "@/lib/rateLimit";

export async function GET(req: NextRequest) {
  const ip = getClientIp(req.headers);
  const rl = rateLimit({ key: `notifications:${ip}`, limit: 60, windowMs: 60_000 });
  const headers = rateLimitHeaders(rl);
  if (!rl.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers });
  }

  let userId: string;
  try {
    const user = await requireUser();
    userId = user.id;
  } catch {
    return NextResponse.json({ error: "unauth" }, { status: 401, headers });
  }

  const url = new URL(req.url);
  const limit = Math.max(
    1,
    Math.min(100, Number.parseInt(url.searchParams.get("limit") ?? "40", 10) || 40),
  );

  const [items, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        title: true,
        message: true,
        createdAt: true,
        readAt: true,
      },
    }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);

  return NextResponse.json({ items, unreadCount }, { headers });
}

