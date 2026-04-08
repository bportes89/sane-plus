import { prisma } from "@/lib/prisma";
import { ReportScope, ReportType } from "@/generated/prisma/client";
import type { NextRequest } from "next/server";

let mockUser: { id: string; role: string; companyId?: string | null } | null = null;

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(async () => mockUser),
}));

import { GET } from "./route";

async function resetDb() {
  await prisma.$transaction([prisma.reportSnapshot.deleteMany()]);
}

describe("GET /api/reports/[id]/export", () => {
  beforeEach(async () => {
    await resetDb();
    mockUser = null;
  });

  it("exporta CSV (summary) para relatório público", async () => {
    const created = await prisma.reportSnapshot.create({
      data: {
        type: ReportType.CITY_MONTHLY,
        scope: ReportScope.PUBLIC,
        period: "2026-03",
        city: "São Paulo",
        state: "SP",
        payload: {
          totals: { complaints: 10, open: 2, replied: 5, resolved: 6, contested: 1, responseRate: 50, solutionRate: 60 },
          byCategory: { WATER: 7, SEWAGE: 3 },
        } as unknown as object,
      },
      select: { id: true },
    });

    const req = new Request(
      `http://localhost/api/reports/${created.id}/export?format=csv&table=summary`,
      { method: "GET" },
    );
    const res = await GET(req as unknown as NextRequest, { params: Promise.resolve({ id: created.id }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const text = await res.text();
    expect(text).toContain("type,scope,period,city,state");
    expect(text).toContain("CITY_MONTHLY");
    expect(text).toContain("São Paulo");
  });

  it("exporta XLSX (categories) para relatório público", async () => {
    const created = await prisma.reportSnapshot.create({
      data: {
        type: ReportType.CITY_MONTHLY,
        scope: ReportScope.PUBLIC,
        period: "2026-03",
        city: "São Paulo",
        state: "SP",
        payload: { byCategory: { WATER: 7, SEWAGE: 3 } } as unknown as object,
      },
      select: { id: true },
    });

    const req = new Request(
      `http://localhost/api/reports/${created.id}/export?format=xlsx&table=categories`,
      { method: "GET" },
    );
    const res = await GET(req as unknown as NextRequest, { params: Promise.resolve({ id: created.id }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  });
});

