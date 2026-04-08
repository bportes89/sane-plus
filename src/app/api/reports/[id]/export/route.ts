import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { getClientIp, rateLimit, rateLimitHeaders } from "@/lib/rateLimit";
import { ReportScope, ReportType, UserRole } from "@/generated/prisma/client";
import { buildXlsxBuffer } from "@/lib/xlsx";

function csvEscape(value: unknown) {
  const str = value == null ? "" : String(value);
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

function isStaff(role: UserRole) {
  return role === UserRole.ADMIN || role === UserRole.MODERATOR || role === UserRole.LEGAL;
}

function toRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function toArray(value: unknown) {
  return Array.isArray(value) ? value : null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ip = getClientIp(req.headers);
  const rl = rateLimit({ key: `reports:export:${ip}`, limit: 120, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const { id } = await params;
  const item = await prisma.reportSnapshot.findUnique({
    where: { id },
    select: {
      id: true,
      type: true,
      scope: true,
      period: true,
      payload: true,
      generatedAt: true,
      companyId: true,
      city: true,
      state: true,
    },
  });
  if (!item) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (item.scope !== ReportScope.PUBLIC) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

    if (item.scope === ReportScope.COMPANY) {
      if (user.role !== UserRole.COMPANY || user.companyId !== item.companyId) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
    } else {
      if (!isStaff(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const url = new URL(req.url);
  const format = (url.searchParams.get("format") ?? "xlsx").trim().toLowerCase();
  const table = (url.searchParams.get("table") ?? "summary").trim().toLowerCase();

  const filenameBase = `report_${item.type}_${item.period}_${item.city ?? ""}_${item.state ?? ""}_${item.companyId ?? ""}`
    .replaceAll(/\s+/g, "_")
    .replaceAll(/_+/g, "_")
    .replaceAll(/^_+|_+$/g, "");

  const payload = toRecord(item.payload) ?? {};

  const summary = (() => {
    if (item.type === ReportType.CITY_MONTHLY || item.type === ReportType.INSTITUTIONAL_MONTHLY) {
      const totals = toRecord(payload["totals"]) ?? {};
      return [
        {
          type: item.type,
          scope: item.scope,
          period: item.period,
          city: item.city ?? "",
          state: item.state ?? "",
          complaints: totals["complaints"] ?? "",
          open: totals["open"] ?? "",
          replied: totals["replied"] ?? "",
          resolved: totals["resolved"] ?? "",
          contested: totals["contested"] ?? "",
          responseRate: totals["responseRate"] ?? "",
          solutionRate: totals["solutionRate"] ?? "",
          generatedAt: item.generatedAt.toISOString(),
        },
      ];
    }

    if (item.type === ReportType.COMPANY_MONTHLY) {
      const company = toRecord(payload["company"]) ?? {};
      const totals = toRecord(payload["totals"]) ?? {};
      const metrics = toRecord(payload["metrics"]);
      return [
        {
          type: item.type,
          scope: item.scope,
          period: item.period,
          companyId: company["id"] ?? item.companyId ?? "",
          companyName: company["name"] ?? "",
          city: company["city"] ?? "",
          state: company["state"] ?? "",
          complaints: totals["complaints"] ?? "",
          replied: totals["replied"] ?? "",
          resolved: totals["resolved"] ?? "",
          responseRate: totals["responseRate"] ?? "",
          solutionRate: totals["solutionRate"] ?? "",
          avgResponseMs: metrics ? (metrics["avgResponseMs"] ?? "") : "",
          averageScore: metrics ? (metrics["averageScore"] ?? "") : "",
          generatedAt: item.generatedAt.toISOString(),
        },
      ];
    }

    if (item.type === ReportType.REGIONAL_QUARTERLY || item.type === ReportType.INSTITUTIONAL_QUARTERLY) {
      const totals = toRecord(payload["totals"]) ?? {};
      return [
        {
          type: item.type,
          scope: item.scope,
          period: item.period,
          state: item.state ?? "",
          complaints: totals["complaints"] ?? "",
          open: totals["open"] ?? "",
          replied: totals["replied"] ?? "",
          resolved: totals["resolved"] ?? "",
          contested: totals["contested"] ?? "",
          responseRate: totals["responseRate"] ?? "",
          solutionRate: totals["solutionRate"] ?? "",
          generatedAt: item.generatedAt.toISOString(),
        },
      ];
    }

    const totals = toRecord(payload["totals"]) ?? {};
    return [
      {
        type: item.type,
        scope: item.scope,
        period: item.period,
        complaints: totals["complaints"] ?? "",
        open: totals["open"] ?? "",
        replied: totals["replied"] ?? "",
        resolved: totals["resolved"] ?? "",
        contested: totals["contested"] ?? "",
        responseRate: totals["responseRate"] ?? "",
        solutionRate: totals["solutionRate"] ?? "",
        generatedAt: item.generatedAt.toISOString(),
      },
    ];
  })();

  const byCategoryRows = (() => {
    const bc = toRecord(payload["byCategory"]) ?? {};
    return Object.entries(bc)
      .map(([category, count]) => ({ category, count: typeof count === "number" ? count : Number(count) || 0 }))
      .sort((a, b) => b.count - a.count);
  })();

  const byNeighborhoodRows = (() => {
    const arr = toArray(payload["byNeighborhood"]) ?? [];
    return arr
      .map((r) => toRecord(r))
      .filter((r): r is Record<string, unknown> => !!r)
      .map((r) => ({ neighborhood: r["neighborhood"] ?? "", total: r["total"] ?? "" }));
  })();

  const companiesRows = (() => {
    const arr = toArray(payload["companies"]) ?? [];
    return arr
      .map((r) => toRecord(r))
      .filter((r): r is Record<string, unknown> => !!r)
      .map((r) => ({
        id: r["id"] ?? "",
        name: r["name"] ?? "",
        slug: r["slug"] ?? "",
        city: r["city"] ?? "",
        state: r["state"] ?? "",
        solutionRate: r["solutionRate"] ?? "",
        overallScore: r["overallScore"] ?? "",
        avgResponseMs: r["avgResponseMs"] ?? "",
      }));
  })();

  if (format === "xlsx" || format === "excel") {
    const filename = `${filenameBase}_${table}.xlsx`.replaceAll(/\s+/g, "_");

    if (table === "categories" || table === "bycategory") {
      const buf = buildXlsxBuffer([{ name: "Categorias", rows: byCategoryRows }]);
      return new NextResponse(buf, {
        status: 200,
        headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "cache-control": "no-store",
          "content-disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    if (table === "neighborhoods" || table === "bairros") {
      const buf = buildXlsxBuffer([{ name: "Bairros", rows: byNeighborhoodRows }]);
      return new NextResponse(buf, {
        status: 200,
        headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "cache-control": "no-store",
          "content-disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    if (table === "companies" || table === "ranking") {
      const buf = buildXlsxBuffer([{ name: "Empresas", rows: companiesRows }]);
      return new NextResponse(buf, {
        status: 200,
        headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "cache-control": "no-store",
          "content-disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    const buf = buildXlsxBuffer([{ name: "Resumo", rows: summary }]);
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
    const filename = `${filenameBase}_${table}.csv`.replaceAll(/\s+/g, "_");

    if (table === "categories" || table === "bycategory") {
      const lines = ["category,count", ...byCategoryRows.map((r) => [csvEscape(r.category), csvEscape(r.count)].join(","))].join(
        "\n",
      );
      return new NextResponse(lines, {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "cache-control": "no-store",
          "content-disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    if (table === "neighborhoods" || table === "bairros") {
      const lines = ["neighborhood,total", ...byNeighborhoodRows.map((r) => [csvEscape(r.neighborhood), csvEscape(r.total)].join(","))].join(
        "\n",
      );
      return new NextResponse(lines, {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "cache-control": "no-store",
          "content-disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    if (table === "companies" || table === "ranking") {
      const lines = [
        "id,name,slug,city,state,solutionRate,overallScore,avgResponseMs",
        ...companiesRows.map((r) =>
          [
            csvEscape(r.id),
            csvEscape(r.name),
            csvEscape(r.slug),
            csvEscape(r.city),
            csvEscape(r.state),
            csvEscape(r.solutionRate),
            csvEscape(r.overallScore),
            csvEscape(r.avgResponseMs),
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

    const keys = Object.keys(summary[0] ?? {});
    const lines = [
      keys.join(","),
      ...summary.map((r) => keys.map((k) => csvEscape((r as Record<string, unknown>)[k])).join(",")),
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

  return NextResponse.json({ error: "invalid_format" }, { status: 400 });
}
