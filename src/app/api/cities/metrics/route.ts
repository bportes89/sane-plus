import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getClientIp, rateLimit, rateLimitHeaders } from "@/lib/rateLimit";
import { UserRole } from "@/generated/prisma/client";
import { buildXlsxBuffer } from "@/lib/xlsx";

function isStaff(role: UserRole) {
  return role === UserRole.ADMIN || role === UserRole.MODERATOR || role === UserRole.LEGAL;
}

function csvEscape(value: unknown) {
  const str = value == null ? "" : String(value);
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

function isCronRequest(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const provided = req.headers.get("x-cron-secret");
  if (provided && provided === cronSecret) return true;
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
  return !!token && token === cronSecret;
}

export async function GET(req: NextRequest) {
  const isCron = isCronRequest(req);

  const user = isCron ? null : await requireUser();
  if (!isCron && (!user || !isStaff(user.role))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const ip = getClientIp(req.headers);
  const rl = rateLimit({
    key: `cities:metrics:${user?.id ?? "cron"}:${ip}`,
    limit: isCron ? 240 : 120,
    windowMs: 60_000,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const url = new URL(req.url);
  const city = (url.searchParams.get("city") ?? "").trim();
  const state = (url.searchParams.get("state") ?? "").trim();
  if (!city || !state) return NextResponse.json({ error: "missing_city_state" }, { status: 400 });

  const limit = Math.max(1, Math.min(60, Number.parseInt(url.searchParams.get("limit") ?? "24", 10) || 24));
  const format = (url.searchParams.get("format") ?? "").trim().toLowerCase();

  const items = await prisma.cityMetric.findMany({
    where: { city, state },
    orderBy: { period: "desc" },
    take: limit,
  });
  const rows = [...items].reverse();

  if (format === "xlsx" || format === "excel") {
    const filename = `city_metrics_${city}_${state}_${limit}p.xlsx`.replaceAll(/\s+/g, "_");
    const buf = buildXlsxBuffer([
      {
        name: "CityMetrics",
        rows: rows.map((r) => ({
          period: r.period,
          complaintsTotal: r.complaintsTotal,
          complaintsOpen: r.complaintsOpen,
          complaintsReplied: r.complaintsReplied,
          complaintsResolved: r.complaintsResolved,
          recurringCount: r.recurringCount,
          avgResponseMs: r.avgResponseMs ?? "",
          avgResolutionMs: r.avgResolutionMs ?? "",
          solutionRate: r.solutionRate ?? "",
          calculatedAt: r.calculatedAt.toISOString(),
        })),
      },
    ]);
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "cache-control": "no-store",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  if (format === "csv") {
    const filename = `city_metrics_${city}_${state}_${limit}p.csv`.replaceAll(/\s+/g, "_");
    const lines = [
      [
        "period",
        "complaintsTotal",
        "complaintsOpen",
        "complaintsReplied",
        "complaintsResolved",
        "recurringCount",
        "avgResponseMs",
        "avgResolutionMs",
        "solutionRate",
        "calculatedAt",
      ].join(","),
      ...rows.map((r) =>
        [
          csvEscape(r.period),
          csvEscape(r.complaintsTotal),
          csvEscape(r.complaintsOpen),
          csvEscape(r.complaintsReplied),
          csvEscape(r.complaintsResolved),
          csvEscape(r.recurringCount),
          csvEscape(r.avgResponseMs ?? ""),
          csvEscape(r.avgResolutionMs ?? ""),
          csvEscape(r.solutionRate ?? ""),
          csvEscape(r.calculatedAt.toISOString()),
        ].join(","),
      ),
    ].join("\n");
    return new NextResponse(lines, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "cache-control": "no-store",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  return NextResponse.json(rows);
}
