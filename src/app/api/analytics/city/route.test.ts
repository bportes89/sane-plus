import { prisma } from "@/lib/prisma";
import { ComplaintCategory, ComplaintStatus, UserRole } from "@/generated/prisma/client";
import { __testing as rateLimitTesting } from "@/lib/rateLimit";
import type { NextRequest } from "next/server";
import * as XLSX from "xlsx";

let mockUser: { id: string; role: UserRole } | null = null;

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => mockUser),
}));

import { GET } from "./route";

async function resetDb() {
  await prisma.$transaction([
    prisma.complaint.deleteMany(),
    prisma.user.deleteMany(),
    prisma.company.deleteMany(),
  ]);
}

describe("GET /api/analytics/city (CSV)", () => {
  beforeEach(async () => {
    rateLimitTesting.reset();
    await resetDb();
    await prisma.company.create({
      data: { id: "c1", name: "Companhia X", slug: "companhia-x", city: "São Paulo", state: "SP", status: "ACTIVE" },
    });
    await prisma.user.create({ data: { id: "u1", email: "cit@test.local", role: UserRole.CITIZEN } });
    await prisma.complaint.create({
      data: {
        id: "k1",
        userId: "u1",
        companyId: "c1",
        category: ComplaintCategory.WATER,
        issue: "Falta de água",
        description: "Sem água",
        neighborhood: "Centro",
        status: ComplaintStatus.REGISTERED,
        createdAt: new Date(),
      },
    });
    mockUser = { id: "u_admin", role: UserRole.ADMIN };
  });

  it("exporta summary em CSV", async () => {
    const req = new Request("http://localhost/api/analytics/city?format=csv&table=summary&city=São%20Paulo&state=SP&windowDays=30");
    const res = await GET(req as unknown as NextRequest);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const csv = await res.text();
    expect(csv.split("\n")[0]).toContain("city,state,period,windowDays,total,open,resolved");
  });

  it("exporta categorias em CSV", async () => {
    const req = new Request("http://localhost/api/analytics/city?format=csv&table=categories&city=São%20Paulo&state=SP&windowDays=30");
    const res = await GET(req as unknown as NextRequest);
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).toContain("category,count");
    expect(csv).toContain("WATER");
  });

  it("exporta summary em XLSX", async () => {
    const req = new Request(
      "http://localhost/api/analytics/city?format=xlsx&table=summary&city=São%20Paulo&state=SP&windowDays=30",
    );
    const res = await GET(req as unknown as NextRequest);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml.sheet");
    const ab = await res.arrayBuffer();
    const wb = XLSX.read(Buffer.from(ab), { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0] as string];
    const rows = XLSX.utils.sheet_to_json(sheet) as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(rows[0]?.city).toBe("São Paulo");
    expect(rows[0]?.state).toBe("SP");
  });
});
