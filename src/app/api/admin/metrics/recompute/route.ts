import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getClientIp, rateLimit, rateLimitHeaders } from "@/lib/rateLimit";
import { UserRole } from "@/generated/prisma/client";
import { computeCityMetricForPeriod, computeCompanyMetricForPeriod, periodFromDate } from "@/lib/analytics";

function isStaff(role: UserRole) {
  return role === UserRole.ADMIN || role === UserRole.MODERATOR || role === UserRole.LEGAL;
}

async function readBody(req: NextRequest) {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      return (await req.json()) as unknown;
    } catch {
      return null;
    }
  }
  try {
    const form = await req.formData();
    const obj: Record<string, unknown> = {};
    for (const [k, v] of form.entries()) obj[k] = typeof v === "string" ? v : String(v);
    return obj;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!isStaff(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const ip = getClientIp(req.headers);
  const rl = rateLimit({ key: `admin:metrics:recompute:${user.id}:${ip}`, limit: 10, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const body = await readBody(req);
  const period = typeof body === "object" && body ? String((body as Record<string, unknown>)["period"] ?? "") : "";
  const mode = typeof body === "object" && body ? String((body as Record<string, unknown>)["mode"] ?? "all") : "all";
  const finalPeriod = period.trim() || periodFromDate(new Date());

  const companies = await prisma.company.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, city: true, state: true },
  });

  let companyUpserts = 0;
  if (mode === "all" || mode === "company") {
    for (const c of companies) {
      const metric = await computeCompanyMetricForPeriod(prisma, { companyId: c.id, period: finalPeriod });
      if (!metric) continue;
      await prisma.companyMetric.upsert({
        where: { companyId_period: { companyId: c.id, period: finalPeriod } },
        create: { companyId: c.id, ...metric },
        update: { ...metric },
      });
      companyUpserts += 1;
    }
  }

  let cityUpserts = 0;
  if (mode === "all" || mode === "city") {
    const cityKeys = new Set<string>();
    for (const c of companies) {
      const city = c.city?.trim();
      const state = c.state?.trim();
      if (!city || !state) continue;
      cityKeys.add(`${city}||${state}`);
    }
    for (const k of cityKeys) {
      const [city, state] = k.split("||");
      if (!city || !state) continue;
      const metric = await computeCityMetricForPeriod(prisma, { city, state, period: finalPeriod });
      if (!metric) continue;
      await prisma.cityMetric.upsert({
        where: { city_state_period: { city, state, period: finalPeriod } },
        create: metric,
        update: metric,
      });
      cityUpserts += 1;
    }
  }

  return NextResponse.json({ ok: true, period: finalPeriod, companyUpserts, cityUpserts });
}

