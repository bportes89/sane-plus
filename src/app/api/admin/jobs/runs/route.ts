import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getClientIp, rateLimit, rateLimitHeaders } from "@/lib/rateLimit";
import { JobRunStatus, UserRole } from "@/generated/prisma/client";

function isStaff(role: UserRole) {
  return role === UserRole.ADMIN || role === UserRole.MODERATOR || role === UserRole.LEGAL;
}

function parseStatus(raw: string | null) {
  const v = (raw ?? "").trim().toUpperCase();
  if (v === "RUNNING") return JobRunStatus.RUNNING;
  if (v === "SUCCESS") return JobRunStatus.SUCCESS;
  if (v === "FAILED") return JobRunStatus.FAILED;
  return null;
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const provided = req.headers.get("x-cron-secret");
  const isCron = !!cronSecret && !!provided && provided === cronSecret;

  const user = isCron ? null : await requireUser();
  if (!isCron && (!user || !isStaff(user.role))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const ip = getClientIp(req.headers);
  const rl = rateLimit({
    key: `admin:jobs:runs:${user?.id ?? "cron"}:${ip}`,
    limit: isCron ? 120 : 60,
    windowMs: 60_000,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const url = new URL(req.url);
  const name = (url.searchParams.get("name") ?? "").trim();
  const status = parseStatus(url.searchParams.get("status"));
  const limit = Math.max(1, Math.min(200, Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50));

  const where = {
    ...(name ? { name } : {}),
    ...(status ? { status } : {}),
  };

  const runs = await prisma.jobRun.findMany({
    where,
    orderBy: { startedAt: "desc" },
    take: limit,
    select: {
      id: true,
      name: true,
      status: true,
      period: true,
      startedAt: true,
      finishedAt: true,
      durationMs: true,
      error: true,
      meta: true,
      userId: true,
      ip: true,
    },
  });

  return NextResponse.json(runs);
}

