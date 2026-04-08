import { prisma } from "@/lib/prisma";
import type { NextRequest } from "next/server";

import { GET } from "./route";

async function resetDb() {
  await prisma.$transaction([
    prisma.notification?.deleteMany?.(),
    prisma.auditLog?.deleteMany?.(),
    prisma.moderationAction?.deleteMany?.(),
    prisma.responseAttachment?.deleteMany?.(),
    prisma.companyResponse?.deleteMany?.(),
    prisma.complaintEvent?.deleteMany?.(),
    prisma.attachment?.deleteMany?.(),
    prisma.companyMetric.deleteMany(),
    prisma.companyRating?.deleteMany?.(),
    prisma.complaint?.deleteMany?.(),
    prisma.user.updateMany({ where: { companyId: { not: null } }, data: { companyId: null } }),
    prisma.user.deleteMany({ where: { role: "COMPANY" } }),
    prisma.company.deleteMany(),
  ]);
}

describe("GET /api/companies/[id]/metrics", () => {
  beforeEach(async () => {
    await resetDb();
    await prisma.company.create({
      data: { id: "c1", name: "Companhia Teste", slug: "companhia-teste" },
    });
  });

  it("retorna 404 quando empresa não existe", async () => {
    const res = await GET({} as NextRequest, { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });

  it("retorna métricas", async () => {
    await prisma.companyMetric.create({
      data: {
        companyId: "c1",
        calculatedAt: new Date("2026-01-01"),
        period: "2026-01",
        complaintsReceived: 10,
        complaintsReplied: 8,
        complaintsResolved: 7,
        avgResponseMs: 123,
        averageScore: 4.2,
      },
    });

    const res = await GET({} as NextRequest, { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(1);
  });
});
