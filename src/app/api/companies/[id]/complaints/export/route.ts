import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import type { NextRequest } from "next/server";
import { ComplaintCategory, ComplaintStatus, UserRole } from "@/generated/prisma/client";
import type { Prisma } from "@/generated/prisma/client";
import { buildXlsxBuffer } from "@/lib/xlsx";

function csvEscape(value: unknown) {
  const str = value == null ? "" : String(value);
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await requireUser();
  if (user.role !== UserRole.COMPANY || user.companyId !== id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const statusRaw = url.searchParams.get("status") ?? "ALL";
  const categoryRaw = url.searchParams.get("category") ?? "ALL";
  const region = (url.searchParams.get("region") ?? "").trim();
  const days = Math.max(0, Math.min(365, Number.parseInt(url.searchParams.get("days") ?? "0", 10) || 0));
  const limit = Math.max(1, Math.min(5000, Number.parseInt(url.searchParams.get("limit") ?? "2000", 10) || 2000));
  const format = (url.searchParams.get("format") ?? "csv").trim().toLowerCase();

  const now = new Date();
  const since = days > 0 ? new Date(now.getTime() - days * 24 * 60 * 60 * 1000) : null;

  const where: Prisma.ComplaintWhereInput = { companyId: id };
  if (since) where.createdAt = { gte: since };
  if (statusRaw === "OPEN") {
    where.status = { in: ["REGISTERED", "PUBLISHED", "USER_CONTESTED"] };
  } else if (statusRaw !== "ALL") {
    const allowed: ComplaintStatus[] = [
      "REGISTERED",
      "NEEDS_REVIEW",
      "PUBLISHED",
      "COMPANY_REPLIED",
      "USER_CONTESTED",
      "RESOLVED",
      "CLOSED",
    ];
    if (allowed.includes(statusRaw as ComplaintStatus)) {
      where.status = statusRaw as ComplaintStatus;
    }
  }
  if (categoryRaw !== "ALL") {
    const allowed: ComplaintCategory[] = ["WATER", "SEWER", "INFRASTRUCTURE", "FINANCIAL", "SERVICE"];
    if (allowed.includes(categoryRaw as ComplaintCategory)) {
      where.category = categoryRaw as ComplaintCategory;
    }
  }
  if (region.length > 0) {
    where.OR = [
      { neighborhood: { contains: region } },
      { street: { contains: region } },
      { locationLabel: { contains: region } },
    ];
  }

  const items = await prisma.complaint.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      category: true,
      subcategory: true,
      issue: true,
      status: true,
      visibility: true,
      createdAt: true,
      resolvedAt: true,
      neighborhood: true,
      street: true,
      number: true,
      locationLabel: true,
      locationLat: true,
      locationLng: true,
    },
  });

  if (format === "xlsx" || format === "excel") {
    const filename = `complaints_${id}.xlsx`;
    const rows = [
      [
        "id",
        "category",
        "subcategory",
        "issue",
        "status",
        "visibility",
        "createdAt",
        "resolvedAt",
        "neighborhood",
        "street",
        "number",
        "locationLabel",
        "locationLat",
        "locationLng",
      ],
      ...items.map((c) => [
        c.id,
        c.category,
        c.subcategory ?? "",
        c.issue,
        c.status,
        c.visibility,
        c.createdAt.toISOString(),
        c.resolvedAt ? c.resolvedAt.toISOString() : "",
        c.neighborhood ?? "",
        c.street ?? "",
        c.number ?? "",
        c.locationLabel ?? "",
        c.locationLat ?? "",
        c.locationLng ?? "",
      ]),
    ];
    const buf = buildXlsxBuffer([{ name: "Complaints", rows }]);
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "cache-control": "no-store",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  const header = [
    "id",
    "category",
    "subcategory",
    "issue",
    "status",
    "visibility",
    "createdAt",
    "resolvedAt",
    "neighborhood",
    "street",
    "number",
    "locationLabel",
    "locationLat",
    "locationLng",
  ].join(",");

  const lines = [
    header,
    ...items.map((c) =>
      [
        csvEscape(c.id),
        csvEscape(c.category),
        csvEscape(c.subcategory),
        csvEscape(c.issue),
        csvEscape(c.status),
        csvEscape(c.visibility),
        csvEscape(c.createdAt.toISOString()),
        csvEscape(c.resolvedAt ? c.resolvedAt.toISOString() : ""),
        csvEscape(c.neighborhood),
        csvEscape(c.street),
        csvEscape(c.number),
        csvEscape(c.locationLabel),
        csvEscape(c.locationLat),
        csvEscape(c.locationLng),
      ].join(","),
    ),
  ].join("\n");

  return new NextResponse(lines, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="complaints_${id}.csv"`,
    },
  });
}
