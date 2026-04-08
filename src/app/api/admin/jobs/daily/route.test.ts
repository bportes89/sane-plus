import { prisma } from "@/lib/prisma";
import { ComplaintCategory, ComplaintStatus, JobRunStatus, UserRole } from "@/generated/prisma/client";
import { __testing as rateLimitTesting } from "@/lib/rateLimit";
import type { NextRequest } from "next/server";

let mockUser: { id: string; role: UserRole } | null = null;
let failOnceCompanyMetric = false;

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => mockUser),
}));

vi.mock("@/lib/analytics", async () => {
  const actual = await vi.importActual<typeof import("@/lib/analytics")>("@/lib/analytics");
  return {
    ...actual,
    computeCompanyMetricForPeriod: vi.fn(async (...args: Parameters<typeof actual.computeCompanyMetricForPeriod>) => {
      if (failOnceCompanyMetric) {
        failOnceCompanyMetric = false;
        throw new Error("boom_company_metric");
      }
      return actual.computeCompanyMetricForPeriod(...args);
    }),
  };
});

import { POST } from "./route";

async function resetDb() {
  await prisma.$transaction([
    prisma.dataAlert.deleteMany(),
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

describe("POST /api/admin/jobs/daily", () => {
  const prevCron = process.env.CRON_SECRET;
  const FIXED_NOW = new Date("2026-03-15T12:00:00.000Z");

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    rateLimitTesting.reset();
    await resetDb();
    process.env.CRON_SECRET = "test_secret";

    await prisma.company.create({
      data: { id: "c1", name: "Companhia X", slug: "companhia-x", city: "São Paulo", state: "SP", status: "ACTIVE" },
    });
    await prisma.user.create({ data: { id: "u1", email: "cit@test.local", role: UserRole.CITIZEN } });

    for (let i = 0; i < 3; i += 1) {
      await prisma.complaint.create({
        data: {
          id: `k${i + 1}`,
          userId: "u1",
          companyId: "c1",
          category: ComplaintCategory.WATER,
          issue: "Falta de água",
          description: "Sem água",
          neighborhood: "Centro",
          status: ComplaintStatus.REGISTERED,
          createdAt: new Date(FIXED_NOW.getTime() - 24 * 60 * 60 * 1000),
        },
      });
    }

    mockUser = { id: "u_admin", role: UserRole.ADMIN };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(() => {
    process.env.CRON_SECRET = prevCron;
  });

  it("executa via x-cron-secret, recalcula métricas e gera alertas", async () => {
    const req = new Request("http://localhost/api/admin/jobs/daily", {
      method: "POST",
      headers: { "content-type": "application/json", "x-cron-secret": "test_secret" },
      body: JSON.stringify({ period: "2026-03", mode: "all", windowHours: 168 }),
    });
    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      companyUpserts: number;
      cityUpserts: number;
      alertsCreated: number;
      runId: string;
    };
    expect(json.ok).toBe(true);
    expect(json.companyUpserts).toBe(1);
    expect(json.cityUpserts).toBe(1);
    expect(json.alertsCreated).toBeGreaterThanOrEqual(1);

    const cm = await prisma.companyMetric.findUnique({
      where: { companyId_period: { companyId: "c1", period: "2026-03" } },
    });
    expect(cm?.complaintsReceived).toBe(3);

    const city = await prisma.cityMetric.findUnique({
      where: { city_state_period: { city: "São Paulo", state: "SP", period: "2026-03" } },
    });
    expect(city?.complaintsTotal).toBe(3);

    const alerts = await prisma.dataAlert.count();
    expect(alerts).toBeGreaterThanOrEqual(1);

    const run = await prisma.jobRun.findUnique({ where: { id: json.runId } });
    expect(run?.status).toBe(JobRunStatus.SUCCESS);

    const snaps = await prisma.pipelineSnapshot.findMany({
      where: { period: "2026-03" },
      orderBy: [{ dataset: "asc" }, { version: "asc" }],
      select: { dataset: true, version: true },
    });
    expect(snaps.map((s) => `${s.dataset}:${s.version}`)).toEqual(["CITY_METRIC:1", "COMPANY_METRIC:1"]);
  });

  it("aplica retry/backoff e registra retriesUsed no JobRun", async () => {
    failOnceCompanyMetric = true;

    const req = new Request("http://localhost/api/admin/jobs/daily", {
      method: "POST",
      headers: { "content-type": "application/json", "x-cron-secret": "test_secret" },
      body: JSON.stringify({ period: "2026-03", mode: "company", retries: 1 }),
    });
    const promise = POST(req as unknown as NextRequest);
    await vi.advanceTimersByTimeAsync(10_000);
    const res = await promise;

    expect(res.status).toBe(200);
    const json = (await res.json()) as { runId: string };
    const run = await prisma.jobRun.findUnique({ where: { id: json.runId } });
    expect(run?.status).toBe(JobRunStatus.SUCCESS);
    const meta = run?.meta as unknown as { retriesUsed?: number; retries?: number; attempts?: number } | null;
    expect(meta?.retries).toBe(1);
    expect(meta?.retriesUsed).toBe(1);
    expect(meta?.attempts).toBe(2);
  });

  it("não cria nova versão quando outputHash não muda; cria nova versão quando muda e aplica retenção por versões", async () => {
    process.env.SNAPSHOT_RETENTION_MAX_VERSIONS = "1";

    const req1 = new Request("http://localhost/api/admin/jobs/daily", {
      method: "POST",
      headers: { "content-type": "application/json", "x-cron-secret": "test_secret" },
      body: JSON.stringify({ period: "2026-03", mode: "all", windowHours: 168 }),
    });
    const res1 = await POST(req1 as unknown as NextRequest);
    expect(res1.status).toBe(200);

    const req2 = new Request("http://localhost/api/admin/jobs/daily", {
      method: "POST",
      headers: { "content-type": "application/json", "x-cron-secret": "test_secret" },
      body: JSON.stringify({ period: "2026-03", mode: "all", windowHours: 168 }),
    });
    const res2 = await POST(req2 as unknown as NextRequest);
    expect(res2.status).toBe(200);

    const afterSame = await prisma.pipelineSnapshot.count({ where: { period: "2026-03" } });
    expect(afterSame).toBe(2);

    await prisma.complaint.create({
      data: {
        id: "k999",
        userId: "u1",
        companyId: "c1",
        category: ComplaintCategory.WATER,
        issue: "Falta de água",
        description: "Sem água",
        neighborhood: "Centro",
        status: ComplaintStatus.REGISTERED,
        createdAt: new Date(FIXED_NOW.getTime() - 48 * 60 * 60 * 1000),
      },
    });

    const req3 = new Request("http://localhost/api/admin/jobs/daily", {
      method: "POST",
      headers: { "content-type": "application/json", "x-cron-secret": "test_secret" },
      body: JSON.stringify({ period: "2026-03", mode: "all", windowHours: 168 }),
    });
    const res3 = await POST(req3 as unknown as NextRequest);
    expect(res3.status).toBe(200);

    const perDataset = await prisma.pipelineSnapshot.groupBy({
      by: ["dataset"],
      where: { period: "2026-03" },
      _count: true,
    });
    const map = new Map(perDataset.map((x) => [x.dataset, x._count]));
    expect(map.get("COMPANY_METRIC")).toBe(1);
    expect(map.get("CITY_METRIC")).toBe(1);
  });
});
