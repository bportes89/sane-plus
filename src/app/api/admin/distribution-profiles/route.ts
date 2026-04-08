import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getClientIp, rateLimit, rateLimitHeaders } from "@/lib/rateLimit";
import { DistributionDestination, DistributionFormat, DistributionFrequency, ReportType, UserRole } from "@/generated/prisma/client";

function isStaff(role: UserRole) {
  return role === UserRole.ADMIN || role === UserRole.MODERATOR || role === UserRole.LEGAL;
}

function parseFormat(v: unknown) {
  const s = String(v ?? "").trim().toUpperCase();
  if (s === "CSV") return DistributionFormat.CSV;
  if (s === "XLSX") return DistributionFormat.XLSX;
  if (s === "JSON") return DistributionFormat.JSON;
  return null;
}

function parseDestination(v: unknown) {
  const s = String(v ?? "").trim().toUpperCase();
  if (s === "AUTO") return DistributionDestination.AUTO;
  if (s === "OFFICIAL_EMAIL") return DistributionDestination.OFFICIAL_EMAIL;
  if (s === "WEBHOOK") return DistributionDestination.WEBHOOK;
  return null;
}

function parseFrequency(v: unknown) {
  const s = String(v ?? "").trim().toUpperCase();
  if (s === "AUTO") return DistributionFrequency.AUTO;
  if (s === "MONTHLY") return DistributionFrequency.MONTHLY;
  if (s === "QUARTERLY") return DistributionFrequency.QUARTERLY;
  if (s === "ANNUAL") return DistributionFrequency.ANNUAL;
  return null;
}

function parseReportType(v: unknown) {
  const s = String(v ?? "").trim().toUpperCase();
  if (s === "COMPANY_MONTHLY") return ReportType.COMPANY_MONTHLY;
  if (s === "CITY_MONTHLY") return ReportType.CITY_MONTHLY;
  if (s === "REGIONAL_QUARTERLY") return ReportType.REGIONAL_QUARTERLY;
  if (s === "NATIONAL_ANNUAL") return ReportType.NATIONAL_ANNUAL;
  if (s === "INSTITUTIONAL_MONTHLY") return ReportType.INSTITUTIONAL_MONTHLY;
  if (s === "INSTITUTIONAL_QUARTERLY") return ReportType.INSTITUTIONAL_QUARTERLY;
  if (s === "INSTITUTIONAL_ANNUAL") return ReportType.INSTITUTIONAL_ANNUAL;
  return null;
}

export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!isStaff(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const ip = getClientIp(req.headers);
  const rl = rateLimit({ key: `admin:distribution-profiles:list:${user.id}:${ip}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ error: "too_many_requests" }, { status: 429, headers: rateLimitHeaders(rl) });
  }

  const url = new URL(req.url);
  const integrationId = (url.searchParams.get("integrationId") ?? "").trim();
  const profiles = await prisma.distributionProfile.findMany({
    where: { ...(integrationId ? { integrationId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return NextResponse.json(profiles);
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!isStaff(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const ip = getClientIp(req.headers);
  const rl = rateLimit({ key: `admin:distribution-profiles:create:${user.id}:${ip}`, limit: 30, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ error: "too_many_requests" }, { status: 429, headers: rateLimitHeaders(rl) });
  }

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const integrationId = String((body as Record<string, unknown>)["integrationId"] ?? "").trim();
  const type = parseReportType((body as Record<string, unknown>)["reportType"]);
  const format = parseFormat((body as Record<string, unknown>)["format"]);
  const destination = parseDestination((body as Record<string, unknown>)["destination"] ?? "AUTO") ?? DistributionDestination.AUTO;
  const frequency = parseFrequency((body as Record<string, unknown>)["frequency"] ?? "AUTO") ?? DistributionFrequency.AUTO;
  const active = ((): boolean => {
    const v = (body as Record<string, unknown>)["active"];
    if (v === undefined || v === null) return true;
    if (typeof v === "boolean") return v;
    const s = String(v).toLowerCase();
    return s === "1" || s === "true" || s === "yes";
  })();
  const emailTo = String((body as Record<string, unknown>)["emailTo"] ?? "").trim() || null;
  const webhookUrl = String((body as Record<string, unknown>)["webhookUrl"] ?? "").trim() || null;

  if (!integrationId || !type || !format) return NextResponse.json({ error: "missing_fields" }, { status: 400 });

  const created = await prisma.distributionProfile.create({
    data: {
      integrationId,
      reportType: type,
      format,
      destination,
      frequency,
      active,
      emailTo,
      webhookUrl,
    },
  });
  return NextResponse.json(created);
}

export async function PATCH(req: NextRequest) {
  const user = await requireUser();
  if (!isStaff(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const id = String((body as Record<string, unknown>)["id"] ?? "").trim();
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  const format = parseFormat((body as Record<string, unknown>)["format"]);
  const destination = parseDestination((body as Record<string, unknown>)["destination"] ?? "");
  const frequency = parseFrequency((body as Record<string, unknown>)["frequency"] ?? "");
  const activeRaw = (body as Record<string, unknown>)["active"];
  const emailTo = String((body as Record<string, unknown>)["emailTo"] ?? "").trim() || null;
  const webhookUrl = String((body as Record<string, unknown>)["webhookUrl"] ?? "").trim() || null;

  const updated = await prisma.distributionProfile.update({
    where: { id },
    data: {
      ...(format ? { format } : {}),
      ...(destination ? { destination } : {}),
      ...(frequency ? { frequency } : {}),
      ...(activeRaw === undefined ? {} : { active: !!activeRaw }),
      emailTo,
      webhookUrl,
    },
  });
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser();
  if (!isStaff(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const id = (url.searchParams.get("id") ?? "").trim();
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  await prisma.distributionProfile.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
