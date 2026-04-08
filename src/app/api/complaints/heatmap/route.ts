import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ComplaintCategory, ComplaintStatus } from "@/generated/prisma/client";
import { getClientIp, rateLimit, rateLimitHeaders } from "@/lib/rateLimit";
import { computeHeatmap, getWindowDays } from "@/lib/analytics";

function toInt(value: string | null) {
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: NextRequest) {
  const ip = getClientIp(req.headers);
  const rl = rateLimit({ key: `complaints:heatmap:${ip}`, limit: 120, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const url = new URL(req.url);
  const windowDays = getWindowDays(url.searchParams.get("windowDays"), 30);
  const precision = Math.max(1, Math.min(4, toInt(url.searchParams.get("precision")) ?? 2));
  const companyId = url.searchParams.get("companyId") ?? undefined;
  const city = (url.searchParams.get("city") ?? "").trim() || undefined;
  const state = (url.searchParams.get("state") ?? "").trim() || undefined;

  const categoryRaw = url.searchParams.get("category");
  const category =
    categoryRaw && Object.values(ComplaintCategory).includes(categoryRaw as ComplaintCategory)
      ? (categoryRaw as ComplaintCategory)
      : undefined;

  const statusRaw = url.searchParams.get("status");
  const status =
    statusRaw && Object.values(ComplaintStatus).includes(statusRaw as ComplaintStatus)
      ? (statusRaw as ComplaintStatus)
      : undefined;

  const points = await computeHeatmap(prisma, {
    windowDays,
    precision,
    companyId,
    city,
    state,
    category,
    status,
  });

  return NextResponse.json({ windowDays, precision, points });
}

