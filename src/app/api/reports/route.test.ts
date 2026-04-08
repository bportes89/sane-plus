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

describe("GET /api/reports", () => {
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

  it("permite listar relatórios públicos sem autenticação (scope=PUBLIC)", async () => {
    mockUser = null;
    const req = new Request("http://localhost/api/reports?scope=PUBLIC&limit=50");
    const res = await GET(req as unknown as NextRequest);
    expect(res.status).toBe(200);
    const json = (await res.json()) as Array<{ id: string }>;
    expect(json.map((x) => x.id)).toEqual(["r_public"]);
  });

  it("restringe relatórios para empresa logada ao escopo COMPANY e companyId", async () => {
    mockUser = { id: "u_company", role: UserRole.COMPANY, companyId: "c1", city: null, state: null };
    const req = new Request("http://localhost/api/reports?limit=50");
    const res = await GET(req as unknown as NextRequest);
    expect(res.status).toBe(200);
    const json = (await res.json()) as Array<{ id: string }>;
    expect(json.map((x) => x.id)).toEqual(["r_company"]);
  });

  it("retorna 403 para usuário cidadão em escopos não públicos", async () => {
    mockUser = { id: "u_cit", role: UserRole.CITIZEN, companyId: null, city: null, state: null };
    const req = new Request("http://localhost/api/reports?limit=50");
    const res = await GET(req as unknown as NextRequest);
    expect(res.status).toBe(403);
  });
});

