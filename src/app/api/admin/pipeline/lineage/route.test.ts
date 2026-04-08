import { prisma } from "@/lib/prisma";
import { PipelineDataset, UserRole } from "@/generated/prisma/client";
import { __testing as rateLimitTesting } from "@/lib/rateLimit";
import type { NextRequest } from "next/server";

let mockUser: { id: string; role: UserRole } | null = null;

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => mockUser),
}));

import { GET } from "./route";

async function resetDb() {
  await prisma.$transaction([
    prisma.pipelineEvent.deleteMany(),
    prisma.pipelineSnapshot.deleteMany(),
    prisma.jobRun.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

describe("GET /api/admin/pipeline/lineage", () => {
  beforeEach(async () => {
    rateLimitTesting.reset();
    await resetDb();
    await prisma.user.create({ data: { id: "u_admin", email: "admin@test.local", role: UserRole.ADMIN } });
    mockUser = { id: "u_admin", role: UserRole.ADMIN };

    await prisma.jobRun.create({
      data: { id: "r1", name: "daily", status: "SUCCESS", period: "2026-03", meta: { ok: true } },
    });
    await prisma.pipelineEvent.create({
      data: {
        id: "p1",
        runId: "r1",
        dataset: PipelineDataset.COMPANY_METRIC,
        action: "UPSERT",
        period: "2026-03",
        companyId: "c1",
        outputHash: "hash",
      },
    });
  });

  it("retorna itens filtrando por dataset", async () => {
    const req = new Request("http://localhost/api/admin/pipeline/lineage?dataset=company_metric&limit=10");
    const res = await GET(req as unknown as NextRequest);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; count: number; items: Array<{ id: string; dataset: string }> };
    expect(json.ok).toBe(true);
    expect(json.count).toBe(1);
    expect(json.items[0]?.id).toBe("p1");
  });
});
