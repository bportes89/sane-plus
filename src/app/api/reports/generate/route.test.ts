import { prisma } from "@/lib/prisma";
import { ComplaintCategory, ComplaintStatus, ReportScope, ReportType, UserRole } from "@/generated/prisma/client";
import type { NextRequest } from "next/server";

let mockUser: { id: string; role: UserRole; companyId: string | null };

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => mockUser),
}));

import { POST } from "./route";

async function resetDb() {
  await prisma.$transaction([
    prisma.emailOutbox.deleteMany(),
    prisma.webhookOutbox.deleteMany(),
    prisma.reportSnapshot.deleteMany(),
    prisma.integration.deleteMany(),
    prisma.companyResponse.deleteMany(),
    prisma.complaint.deleteMany(),
    prisma.user.deleteMany(),
    prisma.company.deleteMany(),
  ]);
}

describe("POST /api/reports/generate", () => {
  beforeEach(async () => {
    await resetDb();

    await prisma.company.create({
      data: { id: "c1", name: "Companhia X", slug: "companhia-x", city: "São Paulo", state: "SP" },
    });
    await prisma.user.create({
      data: { id: "u1", email: "cit@test.local", role: UserRole.CITIZEN },
    });

    const createdAt1 = new Date("2026-03-10T10:00:00.000Z");
    const createdAt2 = new Date("2026-03-12T10:00:00.000Z");

    await prisma.complaint.createMany({
      data: [
        {
          id: "k1",
          userId: "u1",
          companyId: "c1",
          category: ComplaintCategory.WATER,
          issue: "Falta de água",
          description: "Sem água há 2 dias",
          neighborhood: "Centro",
          status: ComplaintStatus.RESOLVED,
          resolvedAt: new Date("2026-03-11T10:00:00.000Z"),
          createdAt: createdAt1,
        },
        {
          id: "k2",
          userId: "u1",
          companyId: "c1",
          category: ComplaintCategory.SEWER,
          issue: "Vazamento de esgoto",
          description: "Vazamento na rua",
          neighborhood: "Bairro A",
          status: ComplaintStatus.PUBLISHED,
          createdAt: createdAt2,
        },
      ],
    });

    await prisma.companyResponse.create({
      data: {
        complaintId: "k1",
        companyId: "c1",
        message: "Estamos resolvendo",
        createdAt: new Date("2026-03-10T18:00:00.000Z"),
      },
    });

    mockUser = { id: "u_admin", role: UserRole.ADMIN, companyId: null };
  });

  it("retorna 403 para usuário não staff", async () => {
    mockUser = { id: "u_cit", role: UserRole.CITIZEN, companyId: null };
    const req = new Request("http://localhost/api/reports/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "CITY_MONTHLY", city: "São Paulo", state: "SP", period: "2026-03" }),
    });
    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(403);
  });

  it("gera snapshot CITY_MONTHLY e armazena ReportSnapshot", async () => {
    const req = new Request("http://localhost/api/reports/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: ReportType.CITY_MONTHLY,
        city: "São Paulo",
        state: "SP",
        period: "2026-03",
        publish: true,
      }),
    });
    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { id: string; type: ReportType; scope: ReportScope; period: string };
    expect(json.type).toBe(ReportType.CITY_MONTHLY);
    expect(json.scope).toBe(ReportScope.PUBLIC);
    expect(json.period).toBe("2026-03");

    const stored = await prisma.reportSnapshot.findUnique({ where: { id: json.id } });
    expect(stored?.scope).toBe(ReportScope.PUBLIC);
    expect(stored?.period).toBe("2026-03");
  });

  it("gera snapshot COMPANY_MONTHLY e enfileira e-mail oficial quando distribute=true", async () => {
    await prisma.integration.create({
      data: {
        id: "int_email",
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

    const req = new Request("http://localhost/api/reports/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: ReportType.COMPANY_MONTHLY,
        companyId: "c1",
        period: "2026-03",
        distribute: true,
      }),
    });
    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { id: string; type: ReportType; scope: ReportScope; period: string };
    expect(json.type).toBe(ReportType.COMPANY_MONTHLY);
    expect(json.scope).toBe(ReportScope.COMPANY);
    expect(json.period).toBe("2026-03");

    const emails = await prisma.emailOutbox.findMany({
      where: { to: "oficial@empresa.local" },
      select: { id: true, subject: true, body: true },
    });
    expect(emails).toHaveLength(1);
    expect(emails[0]?.subject).toContain("Relatório mensal SANE+");
    expect(emails[0]?.body).toContain(`/api/reports/${json.id}`);
  });

  it("retorna 400 para type inválido", async () => {
    const req = new Request("http://localhost/api/reports/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "INVALID" }),
    });
    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(400);
  });
});
