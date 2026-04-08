import { prisma } from "@/lib/prisma";
import { CompanyStatus, ComplaintStatus, UserRole } from "@/generated/prisma/client";
import { __testing as rateLimitTesting } from "@/lib/rateLimit";
import type { NextRequest } from "next/server";

let mockUser: { id: string; role: UserRole; companyId: string | null };

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => mockUser),
}));

import { POST } from "./route";

async function resetDb() {
  await prisma.$transaction([
    prisma.notification.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.moderationAction.deleteMany(),
    prisma.companyResponse.deleteMany(),
    prisma.complaintEvent.deleteMany(),
    prisma.attachment.deleteMany(),
    prisma.contestation.deleteMany(),
    prisma.complaint.deleteMany(),
    prisma.session.deleteMany(),
    prisma.userBadge.deleteMany(),
    prisma.companyRating.deleteMany(),
    prisma.companyMetric.deleteMany(),
    prisma.user.deleteMany(),
    prisma.company.deleteMany(),
  ]);
}

async function seedBase() {
  const company = await prisma.company.create({
    data: { id: "c1", name: "Companhia Teste", slug: "companhia-teste", status: CompanyStatus.ACTIVE },
  });
  const citizen = await prisma.user.create({
    data: { id: "u_citizen", email: "citizen@test.local", role: UserRole.CITIZEN, notifyInApp: true },
  });
  const companyUser = await prisma.user.create({
    data: {
      id: "u_company",
      email: "company@test.local",
      role: UserRole.COMPANY,
      companyId: company.id,
      notifyInApp: true,
    },
  });
  const complaint = await prisma.complaint.create({
    data: {
      userId: citizen.id,
      companyId: company.id,
      category: "WATER",
      issue: "Falta de água",
      description: "Sem água há 2 dias.",
      status: ComplaintStatus.REGISTERED,
      visibility: "PUBLIC",
      events: { create: [{ type: "REGISTERED", message: "Sua reclamação foi registrada." }] },
    },
  });
  return { company, citizen, companyUser, complaint };
}

describe("POST /api/complaints/[id]/responses", () => {
  beforeEach(async () => {
    await resetDb();
    rateLimitTesting.reset();
    mockUser = { id: "u_company", role: UserRole.COMPANY, companyId: "c1" };
  });

  it("cria resposta visível, atualiza status e notifica o usuário", async () => {
    const { complaint } = await seedBase();

    const req = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Vamos resolver. Abra um chamado técnico." }),
    });

    const res = await POST(req as unknown as NextRequest, { params: Promise.resolve({ id: complaint.id }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);

    const updated = await prisma.complaint.findUnique({
      where: { id: complaint.id },
      select: { status: true, events: { select: { type: true, message: true } } },
    });
    expect(updated?.status).toBe(ComplaintStatus.COMPANY_REPLIED);
    expect(updated?.events.some((e) => e.type === "COMPANY_REPLIED")).toBe(true);

    const notifications = await prisma.notification.findMany({ where: { userId: "u_citizen" } });
    expect(notifications.some((n) => n.type === "COMPANY_REPLIED")).toBe(true);

    const responses = await prisma.companyResponse.findMany({ where: { complaintId: complaint.id } });
    expect(responses).toHaveLength(1);
    expect(responses[0]?.status).toBe("VISIBLE");
  });

  it("bloqueia texto com acusação criminal sem prova", async () => {
    const { complaint } = await seedBase();

    const req = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Vocês são ladrões. Isso é fraude." }),
    });

    const res = await POST(req as unknown as NextRequest, { params: Promise.resolve({ id: complaint.id }) });
    expect(res.status).toBe(400);

    const responses = await prisma.companyResponse.findMany({ where: { complaintId: complaint.id } });
    expect(responses).toHaveLength(0);
  });

  it("bloqueia padrão de XSS", async () => {
    const { complaint } = await seedBase();

    const req = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "<img src=x onerror=alert(1)>" }),
    });

    const res = await POST(req as unknown as NextRequest, { params: Promise.resolve({ id: complaint.id }) });
    expect(res.status).toBe(400);

    const responses = await prisma.companyResponse.findMany({ where: { complaintId: complaint.id } });
    expect(responses).toHaveLength(0);
  });

  it("cria resposta em análise quando precisa de revisão humana", async () => {
    const { complaint } = await seedBase();

    const req = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "Pode haver contaminação. Vamos coletar amostras e retornar com laudo.",
      }),
    });

    const res = await POST(req as unknown as NextRequest, { params: Promise.resolve({ id: complaint.id }) });
    expect(res.status).toBe(200);

    const created = await prisma.companyResponse.findFirst({ where: { complaintId: complaint.id } });
    expect(created?.status).toBe("UNDER_REVIEW");

    const moderation = await prisma.moderationAction.findMany({ where: { complaintId: complaint.id } });
    expect(moderation.some((m) => m.action === "HIDDEN")).toBe(true);

    const events = await prisma.complaintEvent.findMany({ where: { complaintId: complaint.id } });
    expect(events.some((e) => e.message.includes("em análise"))).toBe(true);
  });

  it("edita PII automaticamente e registra moderação", async () => {
    const { complaint } = await seedBase();

    const req = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Meu contato é 11 99999-9999 e email a@b.com. Vamos tratar." }),
    });

    const res = await POST(req as unknown as NextRequest, { params: Promise.resolve({ id: complaint.id }) });
    expect(res.status).toBe(200);

    const created = await prisma.companyResponse.findFirst({ where: { complaintId: complaint.id } });
    expect(created?.message).toContain("[dado ocultado]");
    expect(created?.status).toBe("VISIBLE");

    const moderation = await prisma.moderationAction.findMany({ where: { complaintId: complaint.id } });
    expect(moderation.some((m) => m.action === "EDITED")).toBe(true);
  });

  it("retorna 415 quando content-type não é JSON", async () => {
    const { complaint } = await seedBase();
    const req = new Request("http://localhost/api", { method: "POST", body: "x=y" });
    const res = await POST(req as unknown as NextRequest, { params: Promise.resolve({ id: complaint.id }) });
    expect(res.status).toBe(415);
  });

  it("retorna 429 ao exceder limite de respostas (abuso)", async () => {
    const { complaint } = await seedBase();
    let last: Response | null = null;
    for (let i = 0; i < 40; i += 1) {
      const req = new Request("http://localhost/api", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.77" },
        body: JSON.stringify({ message: `Resposta ${i}` }),
      });
      last = await POST(req as unknown as NextRequest, { params: Promise.resolve({ id: complaint.id }) });
    }
    expect(last?.status).toBe(429);
  });
});
