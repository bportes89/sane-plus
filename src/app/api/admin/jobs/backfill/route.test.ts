import { prisma } from "@/lib/prisma";
import { ComplaintCategory, ComplaintStatus, PipelineDataset, UserRole } from "@/generated/prisma/client";
import { __testing as rateLimitTesting } from "@/lib/rateLimit";
import type { NextRequest } from "next/server";

let mockUser: { id: string; role: UserRole } | null = null;

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => mockUser),
}));

import { POST } from "./route";

async function resetDb() {
  await prisma.$transaction([
    prisma.pipelineEvent.deleteMany(),
    prisma.pipelineSnapshot.deleteMany(),
    prisma.jobRun.deleteMany(),
    prisma.cityMetric.deleteMany(),
    prisma.companyMetric.deleteMany(),
    prisma.companyResponse.deleteMany(),
    prisma.complaint.deleteMany(),
    prisma.user.deleteMany(),
    prisma.company.deleteMany(),
  ]);
}

describe("POST /api/admin/jobs/backfill", () => {
  const prevCron = process.env.CRON_SECRET;

  beforeEach(async () => {
    rateLimitTesting.reset();
    await resetDb();
    process.env.CRON_SECRET = "test_secret";

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
        status: ComplaintStatus.RESOLVED,
        createdAt: new Date("2026-03-10T10:00:00.000Z"),
        resolvedAt: new Date("2026-03-11T10:00:00.000Z"),
      },
    });

    mockUser = { id: "u_admin", role: UserRole.ADMIN };
  });

  afterAll(() => {
    process.env.CRON_SECRET = prevCron;
  });

  it("executa via x-cron-secret e registra lineage", async () => {
    const req = new Request("http://localhost/api/admin/jobs/backfill", {
      method: "POST",
      headers: { "content-type": "application/json", "x-cron-secret": "test_secret" },
      body: JSON.stringify({ from: "2026-03", to: "2026-03", mode: "all" }),
    });
    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(200);

    const events = await prisma.pipelineEvent.findMany({
      where: { dataset: PipelineDataset.COMPANY_METRIC, companyId: "c1", period: "2026-03" },
      select: { id: true, outputHash: true, previousHash: true },
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.outputHash).toBeTruthy();
  });
});
