import { prisma } from "@/lib/prisma";
import { ReportScope, ReportType, UserRole } from "@/generated/prisma/client";
import type { NextRequest } from "next/server";

let mockUser:
  | { id: string; role: UserRole; companyId: string | null; city: string | null; state: string | null }
  | null = null;

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(async () => mockUser),
}));

import { GET } from "./route";

async function resetDb() {
  await prisma.$transaction([
    prisma.reportSnapshot.deleteMany(),
    prisma.user.deleteMany(),
    prisma.company.deleteMany(),
  ]);
}

describe("GET /api/reports/[id]", () => {
  beforeEach(async () => {
    await resetDb();
    await prisma.company.create({
      data: { id: "c1", name: "Companhia X", slug: "companhia-x", city: "São Paulo", state: "SP" },
    });
    await prisma.reportSnapshot.createMany({
      data: [
        {
          id: "r_public",
          type: ReportType.NATIONAL_ANNUAL,
          scope: ReportScope.PUBLIC,
          period: "2026",
          payload: { kind: "national_annual", year: 2026 },
        },
        {
          id: "r_company",
          type: ReportType.CITY_MONTHLY,
          scope: ReportScope.COMPANY,
          period: "2026-03",
          payload: { kind: "city_monthly", period: "2026-03" },
          companyId: "c1",
        },
      ],
    });
  });

  it("permite acessar um relatório público sem autenticação", async () => {
    mockUser = null;
    const req = new Request("http://localhost/api/reports/r_public");
    const res = await GET(req as unknown as NextRequest, { params: Promise.resolve({ id: "r_public" }) });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { id: string; scope: ReportScope };
    expect(json.id).toBe("r_public");
    expect(json.scope).toBe(ReportScope.PUBLIC);
  });

  it("retorna 401 ao acessar relatório não público sem autenticação", async () => {
    mockUser = null;
    const req = new Request("http://localhost/api/reports/r_company");
    const res = await GET(req as unknown as NextRequest, { params: Promise.resolve({ id: "r_company" }) });
    expect(res.status).toBe(401);
  });

  it("retorna 403 quando empresa tenta acessar relatório de outra companhia", async () => {
    mockUser = { id: "u_company", role: UserRole.COMPANY, companyId: "other", city: null, state: null };
    const req = new Request("http://localhost/api/reports/r_company");
    const res = await GET(req as unknown as NextRequest, { params: Promise.resolve({ id: "r_company" }) });
    expect(res.status).toBe(403);
  });

  it("permite empresa acessar relatório da própria companhia", async () => {
    mockUser = { id: "u_company", role: UserRole.COMPANY, companyId: "c1", city: null, state: null };
    const req = new Request("http://localhost/api/reports/r_company");
    const res = await GET(req as unknown as NextRequest, { params: Promise.resolve({ id: "r_company" }) });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { id: string; scope: ReportScope };
    expect(json.id).toBe("r_company");
    expect(json.scope).toBe(ReportScope.COMPANY);
  });
});

