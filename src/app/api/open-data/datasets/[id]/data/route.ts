import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getClientIp, rateLimit, rateLimitHeaders } from "@/lib/rateLimit";
import { computePublicDashboard, getWindowDays } from "@/lib/analytics";
import { buildXlsxBuffer } from "@/lib/xlsx";
import { getOpenDataDataset, getOpenDataDatasetIds } from "@/lib/openData";

export const dynamic = "force-dynamic";

function csvEscape(value: unknown) {
  const str = value == null ? "" : String(value);
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ip = getClientIp(req.headers);
  const rl = rateLimit({ key: `open-data:data:${ip}`, limit: 120, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const { id } = await params;
  const ids = new Set(getOpenDataDatasetIds());
  if (!ids.has(id as never)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const dataset = getOpenDataDataset(baseUrl, id as never);

  const format = (url.searchParams.get("format") ?? "json").trim().toLowerCase();
  const windowDays = getWindowDays(url.searchParams.get("windowDays"), 30);
  const generatedAt = new Date().toISOString();

  if (id === "public-companies") {
    const limit = Math.max(1, Math.min(200, Number.parseInt(url.searchParams.get("limit") ?? "10", 10) || 10));
    const offset = Math.max(0, Math.min(100_000, Number.parseInt(url.searchParams.get("offset") ?? "0", 10) || 0));

    const [total, companies] = await prisma.$transaction([
      prisma.company.count({ where: { status: "ACTIVE" } }),
      prisma.company.findMany({
        where: { status: "ACTIVE" },
        orderBy: [{ solutionRate: "desc" }, { overallScore: "desc" }, { name: "asc" }],
        take: limit,
        skip: offset,
        select: {
          id: true,
          name: true,
          slug: true,
          city: true,
          state: true,
          overallScore: true,
          solutionRate: true,
          avgResponseMs: true,
        },
      }),
    ]);

    const rows = companies.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      city: c.city ?? "",
      state: c.state ?? "",
      solutionRate: c.solutionRate ?? null,
      overallScore: c.overallScore ?? null,
      avgResponseMs: c.avgResponseMs ?? null,
    }));

    if (format === "xlsx" || format === "excel") {
      const filename = `open_data_${id}_${limit}l_${offset}o.xlsx`.replaceAll(/\s+/g, "_");
      const buf = buildXlsxBuffer([{ name: "Empresas", rows }]);
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
      const filename = `open_data_${id}_${limit}l_${offset}o.csv`.replaceAll(/\s+/g, "_");
      const lines = [
        "id,name,slug,city,state,solutionRate,overallScore,avgResponseMs",
        ...rows.map((r) =>
          [
            csvEscape(r.id),
            csvEscape(r.name),
            csvEscape(r.slug),
            csvEscape(r.city),
            csvEscape(r.state),
            csvEscape(r.solutionRate ?? ""),
            csvEscape(r.overallScore ?? ""),
            csvEscape(r.avgResponseMs ?? ""),
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

    return NextResponse.json(
      {
        generatedAt,
        datasetVersion: dataset.version,
        schemaVersion: dataset.schemaVersion,
        windowDays,
        total,
        limit,
        offset,
        rows,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const data = await computePublicDashboard(prisma, { windowDays });

  if (id === "public-categories") {
    const rows = Object.entries(data.byCategory)
      .sort((a, b) => b[1] - a[1])
      .map(([category, count]) => ({ category, count }));

    if (format === "xlsx" || format === "excel") {
      const filename = `open_data_${id}_${windowDays}d.xlsx`.replaceAll(/\s+/g, "_");
      const buf = buildXlsxBuffer([{ name: "Categorias", rows }]);
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
      const filename = `open_data_${id}_${windowDays}d.csv`.replaceAll(/\s+/g, "_");
      const lines = ["category,count", ...rows.map((r) => [csvEscape(r.category), csvEscape(r.count)].join(","))].join("\n");
      return new NextResponse(lines, {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "cache-control": "no-store",
          "content-disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    return NextResponse.json(
      {
        generatedAt,
        datasetVersion: dataset.version,
        schemaVersion: dataset.schemaVersion,
        windowDays,
        rows,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const summary = {
    windowDays: data.windowDays,
    total: data.total,
    replied: data.replied,
    resolved: data.resolved,
    responseRate: data.responseRate,
    solutionRate: data.solutionRate,
  };

  if (format === "xlsx" || format === "excel") {
    const filename = `open_data_${id}_${windowDays}d.xlsx`.replaceAll(/\s+/g, "_");
    const buf = buildXlsxBuffer([{ name: "Resumo", rows: [summary] }]);
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
    const filename = `open_data_${id}_${windowDays}d.csv`.replaceAll(/\s+/g, "_");
    const lines = [
      "windowDays,total,replied,resolved,responseRate,solutionRate",
      [
        csvEscape(summary.windowDays),
        csvEscape(summary.total),
        csvEscape(summary.replied),
        csvEscape(summary.resolved),
        csvEscape(summary.responseRate),
        csvEscape(summary.solutionRate),
      ].join(","),
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

  return NextResponse.json(
    {
      generatedAt,
      datasetVersion: dataset.version,
      schemaVersion: dataset.schemaVersion,
      ...summary,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

