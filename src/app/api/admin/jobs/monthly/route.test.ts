import { prisma } from "@/lib/prisma";
import { ComplaintCategory, ComplaintStatus, JobRunStatus, ReportScope, ReportType, UserRole } from "@/generated/prisma/client";
import { __testing as rateLimitTesting } from "@/lib/rateLimit";
import type { NextRequest } from "next/server";

let mockUser: { id: string; role: UserRole } | null = null;

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => mockUser),
}));

import { POST } from "./route";

async function resetDb() {
  await prisma.$transaction([
    prisma.webhookOutbox.deleteMany(),
    prisma.emailOutbox.deleteMany(),
    prisma.integration.deleteMany(),
    prisma.reportSnapshot.deleteMany(),
    prisma.pipelineEvent.deleteMany(),
    prisma.pipelineSnapshot.deleteMany(),
    prisma.jobRun.deleteMany(),
    prisma.cityMetric.deleteMany(),
    prisma.companyMetric.deleteMany(),
    prisma.companyRating.deleteMany(),
    prisma.companyResponse.deleteMany(),
    prisma.complaint.deleteMany(),
    prisma.user.deleteMany(),
    prisma.company.deleteMany(),
  ]);
}

describe("POST /api/admin/jobs/monthly", () => {
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

  it("gera relatório city_monthly (PUBLIC) e não duplica na segunda execução", async () => {
    const req1 = new Request("http://localhost/api/admin/jobs/monthly", {
      method: "POST",
      headers: { "content-type": "application/json", "x-cron-secret": "test_secret" },
      body: JSON.stringify({ period: "2026-03", publish: true }),
    });
    const res = await POST(req1 as unknown as NextRequest);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; cityMonthlyCreated: number; runId: string };
    expect(json.ok).toBe(true);
    expect(json.cityMonthlyCreated).toBe(1);

    const stored = await prisma.reportSnapshot.findFirst({
      where: { type: ReportType.CITY_MONTHLY, scope: ReportScope.PUBLIC, period: "2026-03", city: "São Paulo", state: "SP" },
      select: { id: true, payload: true },
    });
    expect(stored?.id).toBeTruthy();
    expect(stored?.payload).toBeTruthy();

    const run = await prisma.jobRun.findUnique({ where: { id: json.runId } });
    expect(run?.status).toBe(JobRunStatus.SUCCESS);

    const req2 = new Request("http://localhost/api/admin/jobs/monthly", {
      method: "POST",
      headers: { "content-type": "application/json", "x-cron-secret": "test_secret" },
      body: JSON.stringify({ period: "2026-03", publish: true }),
    });
    const res2 = await POST(req2 as unknown as NextRequest);
    expect(res2.status).toBe(200);
    const json2 = (await res2.json()) as { ok: boolean; cityMonthlyCreated: number };
    expect(json2.cityMonthlyCreated).toBe(0);
  });

  it("gera relatório company_monthly (COMPANY) para empresas com integração ativa e enfileira e-mail oficial", async () => {
    await prisma.integration.create({
      data: {
        id: "int1",
        name: "Empresa X - Oficial",
        scope: "COMPANY",
        kind: "OFFICIAL_EMAIL",
        status: "ACTIVE",
        companyId: "c1",
        officialEmail: "oficial@empresa.local",
        verifiedAt: new Date("2026-03-01T00:00:00.000Z"),
      },
      select: { id: true },
    });

    const req = new Request("http://localhost/api/admin/jobs/monthly", {
      method: "POST",
      headers: { "content-type": "application/json", "x-cron-secret": "test_secret" },
      body: JSON.stringify({ period: "2026-03", publish: true }),
    });
    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; companyMonthlyCreated: number };
    expect(json.ok).toBe(true);
    expect(json.companyMonthlyCreated).toBe(1);

    const stored = await prisma.reportSnapshot.findFirst({
      where: { type: ReportType.COMPANY_MONTHLY, scope: ReportScope.COMPANY, period: "2026-03", companyId: "c1" },
      select: { id: true, payload: true },
    });
    expect(stored?.id).toBeTruthy();
    expect(stored?.payload).toBeTruthy();

    const emails = await prisma.emailOutbox.findMany({
      where: { to: "oficial@empresa.local" },
      select: { id: true, subject: true, body: true },
    });
    expect(emails.length).toBe(1);
    expect(emails[0]?.subject).toContain("Relatório mensal SANE+");
    expect(emails[0]?.body).toContain(`/api/reports/${stored?.id}`);
  });
});
