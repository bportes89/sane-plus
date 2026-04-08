import { prisma } from "@/lib/prisma";
import { __testing as rateLimitTesting } from "@/lib/rateLimit";
import type { NextRequest } from "next/server";
import { GET } from "./route";
import { GET as GET_DATASETS } from "./datasets/route";
import { GET as GET_DATASET } from "./datasets/[id]/route";
import { GET as GET_SCHEMA } from "./datasets/[id]/schema/route";
import { GET as GET_DATA } from "./datasets/[id]/data/route";

describe("GET /api/open-data", () => {
  beforeEach(() => {
    rateLimitTesting.reset();
  });

  async function resetDb() {
    await prisma.$transaction([prisma.complaint.deleteMany(), prisma.user.deleteMany(), prisma.company.deleteMany()]);
  }

  it("retorna catálogo com datasets e licença", async () => {
    const req = new Request("http://localhost/api/open-data");
    const res = await GET(req as unknown as NextRequest);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { license?: { id?: string }; datasets?: unknown[] };
    expect(json.license?.id).toBeTruthy();
    expect(Array.isArray(json.datasets)).toBe(true);
    expect((json.datasets ?? []).length).toBeGreaterThan(0);
  });

  it("lista datasets com paginação", async () => {
    const req = new Request("http://localhost/api/open-data/datasets?limit=2&offset=0");
    const res = await GET_DATASETS(req as unknown as NextRequest);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { items?: unknown[]; total?: number; limit?: number; offset?: number };
    expect(json.limit).toBe(2);
    expect(json.offset).toBe(0);
    expect((json.total ?? 0) >= 3).toBe(true);
    expect((json.items ?? []).length).toBe(2);
  });

  it("retorna metadata do dataset e links", async () => {
    const req = new Request("http://localhost/api/open-data/datasets/public-summary");
    const res = await GET_DATASET(req as unknown as NextRequest, { params: Promise.resolve({ id: "public-summary" }) });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { id?: string; links?: { schema?: string; data?: string } };
    expect(json.id).toBe("public-summary");
    expect(json.links?.schema).toContain("/api/open-data/datasets/public-summary/schema");
    expect(json.links?.data).toContain("/api/open-data/datasets/public-summary/data");
  });

  it("retorna JSON Schema por dataset", async () => {
    const req = new Request("http://localhost/api/open-data/datasets/public-companies/schema");
    const res = await GET_SCHEMA(req as unknown as NextRequest, { params: Promise.resolve({ id: "public-companies" }) });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { $schema?: string; properties?: Record<string, unknown> };
    expect(json.$schema).toContain("json-schema");
    expect(json.properties?.rows).toBeTruthy();
  });

  it("retorna data dedicada (public-companies) com total/limit/offset", async () => {
    await resetDb();
    await prisma.company.createMany({
      data: [
        { id: "c1", name: "Companhia X", slug: "companhia-x", status: "ACTIVE", solutionRate: 90, overallScore: 4.2 },
        { id: "c2", name: "Companhia Y", slug: "companhia-y", status: "ACTIVE", solutionRate: 80, overallScore: 4.1 },
      ],
    });

    const req = new Request("http://localhost/api/open-data/datasets/public-companies/data?limit=1&offset=0");
    const res = await GET_DATA(req as unknown as NextRequest, { params: Promise.resolve({ id: "public-companies" }) });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { total?: number; limit?: number; offset?: number; rows?: unknown[] };
    expect(json.total).toBe(2);
    expect(json.limit).toBe(1);
    expect(json.offset).toBe(0);
    expect((json.rows ?? []).length).toBe(1);
  });
});
