import { prisma } from "@/lib/prisma";
import { UserRole } from "@/generated/prisma/client";
import type { NextRequest } from "next/server";
import * as XLSX from "xlsx";

let mockUser: { id: string; role: UserRole; companyId: string | null };

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => mockUser),
}));

import { GET } from "./route";

async function resetDb() {
  await prisma.$transaction([
    prisma.companyMetric.deleteMany(),
    prisma.user.deleteMany(),
    prisma.company.deleteMany(),
  ]);
}

describe("GET /api/companies/[id]/metrics/export", () => {
  beforeEach(async () => {
    await resetDb();
    await prisma.company.create({
      data: { id: "c1", name: "Companhia Teste", slug: "companhia-teste" },
    });
    await prisma.user.create({
      data: { id: "u_company", email: "company@test.local", role: UserRole.COMPANY, companyId: "c1" },
    });
    mockUser = { id: "u_company", role: UserRole.COMPANY, companyId: "c1" };
  });

  it("retorna 403 quando não autenticado como empresa da mesma companhia", async () => {
    mockUser = { id: "u_company", role: UserRole.COMPANY, companyId: "other" };
    const req = new Request("http://localhost/api?limit=2");
    const res = await GET(req as unknown as NextRequest, { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(403);
  });

  it("exporta CSV em ordem cronológica crescente (rows reversas)", async () => {
    await prisma.companyMetric.createMany({
      data: [
        {
          companyId: "c1",
          period: "2026-01",
          complaintsReceived: 10,
          complaintsReplied: 5,
          complaintsResolved: 2,
          avgResponseMs: 1000,
          averageScore: 4.1,
          calculatedAt: new Date("2026-02-01T00:00:00.000Z"),
        },
        {
          companyId: "c1",
          period: "2026-02",
          complaintsReceived: 12,
          complaintsReplied: 8,
          complaintsResolved: 6,
          avgResponseMs: 900,
          averageScore: 4.3,
          calculatedAt: new Date("2026-03-01T00:00:00.000Z"),
        },
      ],
    });

    const req = new Request("http://localhost/api?limit=2");
    const res = await GET(req as unknown as NextRequest, { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(200);

    const csv = await res.text();
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('"2026-01"');
    expect(lines[2]).toContain('"2026-02"');
  });

  it("exporta XLSX com cabeçalho e linhas", async () => {
    await prisma.companyMetric.createMany({
      data: [
        {
          companyId: "c1",
          period: "2026-01",
          complaintsReceived: 10,
          complaintsReplied: 5,
          complaintsResolved: 2,
          avgResponseMs: 1000,
          averageScore: 4.1,
          calculatedAt: new Date("2026-02-01T00:00:00.000Z"),
        },
      ],
    });
    const req = new Request("http://localhost/api?limit=1&format=xlsx");
    const res = await GET(req as unknown as NextRequest, { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml.sheet");
    const ab = await res.arrayBuffer();
    const wb = XLSX.read(Buffer.from(ab), { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0] as string];
    const rows = XLSX.utils.sheet_to_json(sheet) as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    const first = rows[0] as Record<string, unknown>;
    expect(first.period).toBe("2026-01");
    expect(first.complaintsReceived).toBe(10);
  });
});
