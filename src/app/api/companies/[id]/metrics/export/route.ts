import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import type { NextRequest } from "next/server";
import { UserRole } from "@/generated/prisma/client";
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
  const limit = Math.max(
    1,
    Math.min(24, Number.parseInt(url.searchParams.get("limit") ?? "12", 10) || 12),
  );
  const format = (url.searchParams.get("format") ?? "csv").trim().toLowerCase();
  const items = await prisma.companyMetric.findMany({
    where: { companyId: id },
    orderBy: { calculatedAt: "desc" },
    take: limit,
  });
  const rows = [...items].reverse();

  if (format === "xlsx" || format === "excel") {
    const filename = `metrics_${id}_${limit}p.xlsx`;
    const buf = buildXlsxBuffer([
      {
        name: "Metrics",
        rows: [
          [
            "period",
            "complaintsReceived",
            "complaintsReplied",
            "complaintsResolved",
            "avgResponseMs",
            "averageScore",
            "calculatedAt",
          ],
          ...rows.map((r) => [
            r.period,
            r.complaintsReceived,
            r.complaintsReplied,
            r.complaintsResolved,
            r.avgResponseMs != null ? String(r.avgResponseMs) : "",
            r.averageScore != null ? String(r.averageScore) : "",
            r.calculatedAt.toISOString(),
          ]),
        ],
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
  const lines = [
    [
      "period",
      "complaintsReceived",
      "complaintsReplied",
      "complaintsReplied",
      "complaintsResolved",
      "avgResponseMs",
      "averageScore",
      "calculatedAt",
    ].join(","),
    ...rows.map((r) =>
      [
        csvEscape(r.period),
        csvEscape(r.complaintsReceived),
        csvEscape(r.complaintsReplied),
        csvEscape(r.complaintsResolved),
        csvEscape(r.avgResponseMs != null ? String(r.avgResponseMs) : ""),
        csvEscape(r.averageScore != null ? String(r.averageScore) : ""),
        csvEscape(r.calculatedAt.toISOString()),
      ].join(","),
    ),
  ].join("\n");
  return new NextResponse(lines, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="metrics_${id}_${limit}p.csv"`,
    },
  });
}
