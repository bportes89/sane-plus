import { prisma } from "@/lib/prisma";
import { ComplaintCategory, ComplaintStatus, ComplaintVisibility, UserRole } from "@/generated/prisma/client";
import { __testing as rateLimitTesting } from "@/lib/rateLimit";
import type { NextRequest } from "next/server";
import * as XLSX from "xlsx";

import { GET } from "./route";

async function resetDb() {
  await prisma.$transaction([
    prisma.complaint.deleteMany(),
    prisma.user.deleteMany(),
    prisma.company.deleteMany(),
  ]);
}

describe("GET /api/analytics/public (CSV)", () => {
  beforeEach(async () => {
    rateLimitTesting.reset();
    await resetDb();
    await prisma.company.create({
      data: { id: "c1", name: "Companhia X", slug: "companhia-x", status: "ACTIVE", solutionRate: 90, overallScore: 4.2 },
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
        status: ComplaintStatus.PUBLISHED,
        visibility: ComplaintVisibility.PUBLIC,
        createdAt: new Date(),
      },
    });
  });

  it("exporta summary em CSV", async () => {
    const req = new Request("http://localhost/api/analytics/public?format=csv&table=summary&windowDays=30");
    const res = await GET(req as unknown as NextRequest);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const csv = await res.text();
    expect(csv.split("\n")[0]).toContain("windowDays,total,replied,resolved,responseRate,solutionRate");
  });

  it("exporta categorias em CSV", async () => {
    const req = new Request("http://localhost/api/analytics/public?format=csv&table=categories&windowDays=30");
    const res = await GET(req as unknown as NextRequest);
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv.split("\n")[0]).toContain("category,count");
    expect(csv).toContain("WATER");
  });

  it("exporta summary em XLSX", async () => {
    const req = new Request("http://localhost/api/analytics/public?format=xlsx&table=summary&windowDays=30");
    const res = await GET(req as unknown as NextRequest);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml.sheet");
    const ab = await res.arrayBuffer();
    const wb = XLSX.read(Buffer.from(ab), { type: "buffer" });
    expect(wb.SheetNames[0]).toBeTruthy();
    const sheet = wb.Sheets[wb.SheetNames[0] as string];
    const rows = XLSX.utils.sheet_to_json(sheet) as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(rows[0]?.windowDays).toBe(30);
    expect(rows[0]?.total).toBe(1);
  });

  it("pagina empresas (CSV) com limit/offset", async () => {
    await prisma.company.createMany({
      data: [
        { id: "c2", name: "Companhia Y", slug: "companhia-y", status: "ACTIVE", solutionRate: 80, overallScore: 4.1 },
        { id: "c3", name: "Companhia Z", slug: "companhia-z", status: "ACTIVE", solutionRate: 70, overallScore: 4.0 },
      ],
    });
    const req = new Request("http://localhost/api/analytics/public?format=csv&table=companies&limit=1&offset=1");
    const res = await GET(req as unknown as NextRequest);
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv.split("\n")[0]).toContain("id,name,slug,city,state,solutionRate,overallScore,avgResponseMs");
    expect(csv).toContain('"c2"');
    expect(csv).not.toContain('"c1"');
  });

  it("pagina empresas (JSON) com limit/offset e total", async () => {
    await prisma.company.createMany({
      data: [
        { id: "c2", name: "Companhia Y", slug: "companhia-y", status: "ACTIVE", solutionRate: 80, overallScore: 4.1 },
        { id: "c3", name: "Companhia Z", slug: "companhia-z", status: "ACTIVE", solutionRate: 70, overallScore: 4.0 },
      ],
    });
    const req = new Request("http://localhost/api/analytics/public?table=companies&limit=2&offset=0");
    const res = await GET(req as unknown as NextRequest);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { total?: number; companies?: Array<{ id: string }>; limit?: number; offset?: number };
    expect(json.total).toBe(3);
    expect(json.limit).toBe(2);
    expect(json.offset).toBe(0);
    expect(json.companies?.length).toBe(2);
  });
});
