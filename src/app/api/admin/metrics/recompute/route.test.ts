import { prisma } from "@/lib/prisma";
import { ComplaintCategory, ComplaintStatus, UserRole } from "@/generated/prisma/client";
import type { NextRequest } from "next/server";

let mockUser: { id: string; role: UserRole; companyId: string | null };

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => mockUser),
}));

import { POST } from "./route";

async function resetDb() {
  await prisma.$transaction([
    prisma.cityMetric.deleteMany(),
    prisma.companyMetric.deleteMany(),
    prisma.companyRating.deleteMany(),
    prisma.companyResponse.deleteMany(),
    prisma.complaint.deleteMany(),
    prisma.user.deleteMany(),
    prisma.company.deleteMany(),
  ]);
}

describe("POST /api/admin/metrics/recompute", () => {
  beforeEach(async () => {
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
        status: ComplaintStatus.RESOLVED,
        createdAt: new Date("2026-03-10T10:00:00.000Z"),
        resolvedAt: new Date("2026-03-11T10:00:00.000Z"),
      },
    });
    await prisma.companyResponse.create({
      data: {
        complaintId: "k1",
        companyId: "c1",
        message: "Resposta",
        createdAt: new Date("2026-03-10T14:00:00.000Z"),
      },
    });
    await prisma.companyRating.create({
      data: { companyId: "c1", userId: "u1", complaintId: "k1", score: 4, createdAt: new Date("2026-03-12T10:00:00.000Z") },
    });

    mockUser = { id: "u_admin", role: UserRole.ADMIN, companyId: null };
  });

  it("retorna 403 para usuário não staff", async () => {
    mockUser = { id: "u_cit", role: UserRole.CITIZEN, companyId: null };
    const req = new Request("http://localhost/api/admin/metrics/recompute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ period: "2026-03" }),
    });
    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(403);
  });

  it("recalcula e upserta CompanyMetric e CityMetric para o período", async () => {
    const req = new Request("http://localhost/api/admin/metrics/recompute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ period: "2026-03", mode: "all" }),
    });
    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(200);

    const cm = await prisma.companyMetric.findUnique({
      where: { companyId_period: { companyId: "c1", period: "2026-03" } },
    });
    expect(cm?.complaintsReceived).toBe(1);
    expect(cm?.complaintsReplied).toBe(1);
    expect(cm?.complaintsResolved).toBe(1);
    expect(cm?.averageScore).toBe(4);

    const city = await prisma.cityMetric.findUnique({
      where: { city_state_period: { city: "São Paulo", state: "SP", period: "2026-03" } },
    });
    expect(city?.complaintsTotal).toBe(1);
    expect(city?.complaintsReplied).toBe(1);
    expect(city?.complaintsResolved).toBe(1);
    expect(city?.solutionRate).toBe(100);
  });
});

