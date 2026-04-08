import { prisma } from "@/lib/prisma";
import { __testing as rateLimitTesting } from "@/lib/rateLimit";
import { ComplaintStatus, ComplaintVisibility, UserRole } from "@/generated/prisma/client";
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
    prisma.complaintEvent.deleteMany(),
    prisma.complaint.deleteMany(),
    prisma.user.deleteMany(),
    prisma.company.deleteMany(),
  ]);
}

describe("POST /api/complaints/[id]/company-contest", () => {
  beforeEach(async () => {
    await resetDb();
    rateLimitTesting.reset();
    await prisma.company.create({
      data: { id: "c1", name: "Companhia Teste", slug: "companhia-teste" },
    });
    await prisma.user.create({
      data: { id: "u_company", email: "company@test.local", role: UserRole.COMPANY, companyId: "c1", notifyInApp: true },
    });
    await prisma.user.create({
      data: { id: "u_citizen", email: "citizen@test.local", role: UserRole.CITIZEN, notifyInApp: true },
    });
    await prisma.complaint.create({
      data: {
        id: "cmp1",
        userId: "u_citizen",
        companyId: "c1",
        category: "WATER",
        issue: "Sem água",
        description: "desc",
        status: ComplaintStatus.PUBLISHED,
        visibility: ComplaintVisibility.PUBLIC,
      },
    });
  });

  it("retorna 403 quando usuário não é empresa", async () => {
    mockUser = { id: "u_citizen", role: UserRole.CITIZEN, companyId: null };
    const req = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "mensagem suficientemente longa" }),
    });
    const res = await POST(req as unknown as NextRequest, { params: Promise.resolve({ id: "cmp1" }) });
    expect(res.status).toBe(403);
  });

  it("rejeita mensagem com padrão de XSS", async () => {
    mockUser = { id: "u_company", role: UserRole.COMPANY, companyId: "c1" };
    const req = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "<img src=x onerror=alert(1)> mensagem longa" }),
    });
    const res = await POST(req as unknown as NextRequest, { params: Promise.resolve({ id: "cmp1" }) });
    expect(res.status).toBe(400);

    const moderation = await prisma.moderationAction.findMany({ where: { complaintId: "cmp1" } });
    expect(moderation).toHaveLength(0);
  });

  it("oculta PII na mensagem antes de salvar", async () => {
    mockUser = { id: "u_company", role: UserRole.COMPANY, companyId: "c1" };
    const req = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "Solicitamos revisão. Contato: 11 99999-9999 e email a@b.com.",
      }),
    });
    const res = await POST(req as unknown as NextRequest, { params: Promise.resolve({ id: "cmp1" }) });
    expect(res.status).toBe(200);

    const moderation = await prisma.moderationAction.findMany({ where: { complaintId: "cmp1" } });
    expect(moderation).toHaveLength(1);
    expect(moderation[0].details).toContain("[dado ocultado]");
    expect(moderation[0].details).not.toContain("99999-9999");
  });

  it("oculta a reclamação e cria moderação/notificações", async () => {
    mockUser = { id: "u_company", role: UserRole.COMPANY, companyId: "c1" };

    const req = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.1" },
      body: JSON.stringify({ message: "Solicitamos revisão jurídica do conteúdo exibido.", legalReason: "Direito de resposta" }),
    });
    const res = await POST(req as unknown as NextRequest, { params: Promise.resolve({ id: "cmp1" }) });
    expect(res.status).toBe(200);

    const updated = await prisma.complaint.findUnique({ where: { id: "cmp1" } });
    expect(updated?.status).toBe(ComplaintStatus.NEEDS_REVIEW);
    expect(updated?.visibility).toBe(ComplaintVisibility.PRIVATE);

    const moderation = await prisma.moderationAction.findMany({ where: { complaintId: "cmp1" } });
    expect(moderation).toHaveLength(1);

    const notesCitizen = await prisma.notification.findMany({ where: { userId: "u_citizen" } });
    expect(notesCitizen.some((n) => n.type === "MODERATION")).toBe(true);

    const notesCompany = await prisma.notification.findMany({ where: { userId: "u_company" } });
    expect(notesCompany.some((n) => n.title === "Solicitação recebida")).toBe(true);
  });

  it("retorna 415 quando content-type não é JSON", async () => {
    mockUser = { id: "u_company", role: UserRole.COMPANY, companyId: "c1" };
    const req = new Request("http://localhost/api", { method: "POST", body: "x=y" });
    const res = await POST(req as unknown as NextRequest, { params: Promise.resolve({ id: "cmp1" }) });
    expect(res.status).toBe(415);
  });

  it("retorna 429 ao exceder limite de contestações da empresa (abuso)", async () => {
    mockUser = { id: "u_company", role: UserRole.COMPANY, companyId: "c1" };
    let last: Response | null = null;
    for (let i = 0; i < 15; i += 1) {
      const req = new Request("http://localhost/api", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.5" },
        body: JSON.stringify({ message: `Solicitação ${i} com conteúdo suficiente` }),
      });
      last = await POST(req as unknown as NextRequest, { params: Promise.resolve({ id: "cmp1" }) });
    }
    expect(last?.status).toBe(429);
  });
});
