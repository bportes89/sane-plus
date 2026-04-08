import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ComplaintCategory, ComplaintStatus, ComplaintVisibility } from "@/generated/prisma/client";
import { getClientIp, rateLimit, rateLimitHeaders } from "@/lib/rateLimit";

function toNumber(v: string | null) {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function hash01(input: string) {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  const x = Math.sin(h) * 10000;
  return x - Math.floor(x);
}

function jitter(
  lat: number,
  lng: number,
  seed: string,
  radiusMeters: number,
): { lat: number; lng: number } {
  const rLat = (hash01(seed + ":lat") - 0.5) * 2;
  const rLng = (hash01(seed + ":lng") - 0.5) * 2;

  const dLatMeters = rLat * radiusMeters;
  const dLngMeters = rLng * radiusMeters;

  const dLat = dLatMeters / 111111;
  const dLng = dLngMeters / (111111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));

  return { lat: lat + dLat, lng: lng + dLng };
}

export async function GET(req: Request) {
  const ip = getClientIp(req.headers);
  const rl = rateLimit({ key: `complaints:map:${ip}`, limit: 120, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const url = new URL(req.url);
  const limitRaw = toNumber(url.searchParams.get("limit"));
  const limit = Math.max(1, Math.min(500, limitRaw ?? 200));

  const companyId = url.searchParams.get("companyId");
  const city = (url.searchParams.get("city") ?? "").trim() || null;
  const state = (url.searchParams.get("state") ?? "").trim() || null;
  const bucket = url.searchParams.get("bucket");
  const statusRaw = url.searchParams.get("status");
  const categoryRaw = url.searchParams.get("category");
  const category =
    categoryRaw && Object.values(ComplaintCategory).includes(categoryRaw as ComplaintCategory)
      ? (categoryRaw as ComplaintCategory)
      : null;

  const baseVisibleStatuses = [
    ComplaintStatus.PUBLISHED,
    ComplaintStatus.COMPANY_VIEWED,
    ComplaintStatus.COMPANY_REPLIED,
    ComplaintStatus.USER_CONTESTED,
    ComplaintStatus.RESOLVED,
    ComplaintStatus.CLOSED,
  ];

  const allowedStatus = statusRaw
    ? (Object.values(ComplaintStatus).includes(statusRaw as ComplaintStatus)
        ? (statusRaw as ComplaintStatus)
        : null)
    : null;

  const statusFilter = (() => {
    if (bucket === "open") {
      return {
        in: baseVisibleStatuses.filter(
          (s) => s !== ComplaintStatus.RESOLVED && s !== ComplaintStatus.CLOSED,
        ),
      };
    }
    if (bucket === "resolved") return { in: [ComplaintStatus.RESOLVED] };
    if (bucket === "closed") return { in: [ComplaintStatus.CLOSED] };
    if (allowedStatus) return { in: [allowedStatus] };
    return { in: baseVisibleStatuses };
  })();

  const items = await prisma.complaint.findMany({
    where: {
      status: statusFilter,
      visibility: { in: [ComplaintVisibility.PUBLIC, ComplaintVisibility.ANONYMIZED] },
      locationLat: { not: null },
      locationLng: { not: null },
      ...(companyId ? { companyId } : {}),
      ...(city && state ? { company: { is: { city, state } } } : {}),
      ...(category ? { category } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      issue: true,
      category: true,
      status: true,
      visibility: true,
      createdAt: true,
      locationLat: true,
      locationLng: true,
      locationLabel: true,
      company: { select: { id: true, name: true } },
    },
  });

  const out = items.map((c) => {
    const lat = c.locationLat ?? 0;
    const lng = c.locationLng ?? 0;
    const pos =
      c.visibility === ComplaintVisibility.ANONYMIZED
        ? jitter(lat, lng, c.id, 220)
        : { lat, lng };

    const title =
      c.visibility === ComplaintVisibility.ANONYMIZED
        ? `${c.company.name} • ${c.category}`
        : `${c.company.name} • ${c.issue}`;

    return {
      id: c.id,
      companyId: c.company.id,
      companyName: c.company.name,
      category: c.category,
      status: c.status,
      visibility: c.visibility,
      createdAt: c.createdAt,
      lat: pos.lat,
      lng: pos.lng,
      locationLabel: c.locationLabel,
      title,
    };
  });

  return NextResponse.json(out);
}
