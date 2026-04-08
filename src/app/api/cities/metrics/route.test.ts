import { prisma } from "@/lib/prisma";
import { __testing as rateLimitTesting } from "@/lib/rateLimit";
import type { NextRequest } from "next/server";
import * as XLSX from "xlsx";

import { GET } from "./route";

async function resetDb() {
  await prisma.$transaction([prisma.cityMetric.deleteMany()]);
}

describe("GET /api/cities/metrics (CSV)", () => {
  const prevCron = process.env.CRON_SECRET;

  beforeEach(async () => {
    rateLimitTesting.reset();
    await resetDb();
    process.env.CRON_SECRET = "test_secret";

    await prisma.cityMetric.create({
      data: {
        id: "m1",
        city: "São Paulo",
        state: "SP",
        period: "2026-03",
        complaintsTotal: 10,
        complaintsOpen: 4,
        complaintsReplied: 6,
        complaintsResolved: 3,
        recurringCount: 2,
        solutionRate: 30,
      },
    });
  });

  afterAll(() => {
    process.env.CRON_SECRET = prevCron;
  });

  it("exporta histórico em CSV", async () => {
    const req = new Request("http://localhost/api/cities/metrics?city=São%20Paulo&state=SP&format=csv&limit=24", {
      headers: { "x-cron-secret": "test_secret" },
    });
    const res = await GET(req as unknown as NextRequest);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const csv = await res.text();
    expect(csv.split("\n")[0]).toContain("period,complaintsTotal,complaintsOpen");
    expect(csv).toContain("2026-03");
  });

  it("exporta histórico em XLSX", async () => {
    const req = new Request("http://localhost/api/cities/metrics?city=São%20Paulo&state=SP&format=xlsx&limit=24", {
      headers: { "x-cron-secret": "test_secret" },
    });
    const res = await GET(req as unknown as NextRequest);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml.sheet");
    const ab = await res.arrayBuffer();
    const wb = XLSX.read(Buffer.from(ab), { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0] as string];
    const rows = XLSX.utils.sheet_to_json(sheet) as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(rows[0]?.period).toBe("2026-03");
    expect(rows[0]?.complaintsTotal).toBe(10);
  });
});
