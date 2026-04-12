import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getClientIp, rateLimit, rateLimitHeaders } from "@/lib/rateLimit";
import { UserRole } from "@/generated/prisma/client";
import { computeCityDashboard, getWindowDays, parsePeriod } from "@/lib/analytics";
import { buildXlsxBuffer } from "@/lib/xlsx";

function isStaff(role: UserRole) {
  return role === UserRole.ADMIN || role === UserRole.MODERATOR || role === UserRole.LEGAL;
}

function csvEscape(value: unknown) {
  const str = value == null ? "" : String(value);
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!isStaff(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const ip = getClientIp(req.headers);
  const rl = rateLimit({ key: `analytics:city:${user.id}:${ip}`, limit: 120, windowMs: 60_000 });
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

  const windowDays = getWindowDays(url.searchParams.get("windowDays"), 30);
  const rawPeriod = (url.searchParams.get("period") ?? "").trim();
  const period = parsePeriod(rawPeriod) ? rawPeriod : null;
  const data = await computeCityDashboard(prisma, { city, state, windowDays, period });
  const filterToken = period ?? `${windowDays}d`;

  const format = (url.searchParams.get("format") ?? "").trim().toLowerCase();
  const table = (url.searchParams.get("table") ?? "summary").trim().toLowerCase();

  if (format === "xlsx" || format === "excel") {
    const filename = `city_${city}_${state}_${filterToken}_${table}.xlsx`.replaceAll(/\s+/g, "_");

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

    if (table === "byneighborhood" || table === "neighborhoods") {
      const rows = Object.entries(data.byNeighborhood)
        .sort((a, b) => b[1] - a[1])
        .map(([neighborhood, count]) => ({ neighborhood, count }));
      const buf = buildXlsxBuffer([{ name: "Bairros", rows }]);
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
      const rows = [...data.companyRank]
        .sort((a, b) => (b.solutionRate ?? -1) - (a.solutionRate ?? -1))
        .map((r) => ({
          id: r.id,
          name: r.name,
          city: r.city,
          state: r.state,
          period: data.period ?? "",
          total: r.total,
          resolved: r.resolved,
          solutionRate: r.solutionRate ?? "",
          saneIndex: r.saneIndex,
          avgResponseMs: r.avgResponseMs ?? "",
          status: r.status,
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

    const buf = buildXlsxBuffer([
      {
        name: "Resumo",
        rows: [
          {
            city: data.city,
            state: data.state,
            period: data.period ?? "",
            windowDays: data.windowDays,
            total: data.total,
            open: data.open,
            resolved: data.resolved,
            replied: data.replied,
            contested: data.contested,
            recurringCount: data.recurringCount,
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
    const filename = `city_${city}_${state}_${filterToken}_${table}.csv`.replaceAll(/\s+/g, "_");

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

    if (table === "byneighborhood" || table === "neighborhoods") {
      const rows = Object.entries(data.byNeighborhood).sort((a, b) => b[1] - a[1]);
      const lines = ["neighborhood,count", ...rows.map(([k, v]) => [csvEscape(k), csvEscape(v)].join(","))].join("\n");
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
      const rows = [...data.companyRank].sort((a, b) => (b.solutionRate ?? -1) - (a.solutionRate ?? -1));
      const lines = [
        "id,name,city,state,period,total,resolved,solutionRate,saneIndex,avgResponseMs,status",
        ...rows.map((r) =>
          [
            csvEscape(r.id),
            csvEscape(r.name),
            csvEscape(r.city),
            csvEscape(r.state),
            csvEscape(data.period ?? ""),
            csvEscape(r.total),
            csvEscape(r.resolved),
            csvEscape(r.solutionRate ?? ""),
            csvEscape(r.saneIndex),
            csvEscape(r.avgResponseMs ?? ""),
            csvEscape(r.status),
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

    const lines = [
      "city,state,period,windowDays,total,open,resolved,replied,contested,recurringCount,responseRate,solutionRate",
      [
        csvEscape(data.city),
        csvEscape(data.state),
        csvEscape(data.period ?? ""),
        csvEscape(data.windowDays),
        csvEscape(data.total),
        csvEscape(data.open),
        csvEscape(data.resolved),
        csvEscape(data.replied),
        csvEscape(data.contested),
        csvEscape(data.recurringCount),
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
