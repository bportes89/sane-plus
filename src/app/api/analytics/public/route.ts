import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getClientIp, rateLimit, rateLimitHeaders } from "@/lib/rateLimit";
import { computePublicDashboard, getWindowDays, parsePeriod } from "@/lib/analytics";
import { buildXlsxBuffer } from "@/lib/xlsx";

function csvEscape(value: unknown) {
  const str = value == null ? "" : String(value);
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

export async function GET(req: NextRequest) {
  const ip = getClientIp(req.headers);
  const rl = rateLimit({ key: `analytics:public:${ip}`, limit: 120, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const url = new URL(req.url);
  const windowDays = getWindowDays(url.searchParams.get("windowDays"), 30);
  const rawPeriod = (url.searchParams.get("period") ?? "").trim();
  const period = parsePeriod(rawPeriod) ? rawPeriod : null;
  const format = (url.searchParams.get("format") ?? "").trim().toLowerCase();
  const table = (url.searchParams.get("table") ?? "summary").trim().toLowerCase();
  const filterToken = period ?? `${windowDays}d`;
  const data = await computePublicDashboard(prisma, { windowDays, period });

  if (table === "companies" || table === "ranking") {
    const limit = Math.max(1, Math.min(200, Number.parseInt(url.searchParams.get("limit") ?? "10", 10) || 10));
    const offset = Math.max(0, Math.min(100_000, Number.parseInt(url.searchParams.get("offset") ?? "0", 10) || 0));
    const total = data.topCompanies.length;
    const companies = data.topCompanies.slice(offset, offset + limit);

    if (format === "xlsx" || format === "excel") {
      const filename = `public_${filterToken}_${table}_${limit}l_${offset}o.xlsx`.replaceAll(/\s+/g, "_");
      const rows = companies.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        city: c.city ?? "",
        state: c.state ?? "",
        period: data.period ?? "",
        solutionRate: c.solutionRate ?? "",
        avgResponseMs: c.avgResponseMs ?? "",
        total: c.total,
        resolved: c.resolved,
      }));
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
      const filename = `public_${filterToken}_${table}_${limit}l_${offset}o.csv`.replaceAll(/\s+/g, "_");
      const lines = [
        "id,name,slug,city,state,period,solutionRate,avgResponseMs,total,resolved",
        ...companies.map((c) =>
          [
            csvEscape(c.id),
            csvEscape(c.name),
            csvEscape(c.slug),
            csvEscape(c.city ?? ""),
            csvEscape(c.state ?? ""),
            csvEscape(data.period ?? ""),
            csvEscape(c.solutionRate ?? ""),
            csvEscape(c.avgResponseMs ?? ""),
            csvEscape(c.total),
            csvEscape(c.resolved),
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
        period: data.period,
        windowDays,
        limit,
        offset,
        total,
        companies,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  if (format === "xlsx" || format === "excel") {
    const filename = `public_${filterToken}_${table}.xlsx`.replaceAll(/\s+/g, "_");

    if (table === "bycategory" || table === "categories") {
      const rows = Object.entries(data.byCategory)
        .sort((a, b) => b[1] - a[1])
        .map(([category, count]) => ({ category, count }));
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

    const buf = buildXlsxBuffer([
      {
        name: "Resumo",
        rows: [
          {
            period: data.period ?? "",
            windowDays: data.windowDays,
            total: data.total,
            replied: data.replied,
            resolved: data.resolved,
            responseRate: data.responseRate,
            solutionRate: data.solutionRate,
          },
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

  if (format === "csv") {
    const filename = `public_${filterToken}_${table}.csv`.replaceAll(/\s+/g, "_");

    if (table === "bycategory" || table === "categories") {
      const rows = Object.entries(data.byCategory).sort((a, b) => b[1] - a[1]);
      const lines = ["category,count", ...rows.map(([k, v]) => [csvEscape(k), csvEscape(v)].join(","))].join("\n");
      return new NextResponse(lines, {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "cache-control": "no-store",
          "content-disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    const lines = [
      "period,windowDays,total,replied,resolved,responseRate,solutionRate",
      [
        csvEscape(data.period ?? ""),
        csvEscape(data.windowDays),
        csvEscape(data.total),
        csvEscape(data.replied),
        csvEscape(data.resolved),
        csvEscape(data.responseRate),
        csvEscape(data.solutionRate),
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

  return NextResponse.json(data);
}
