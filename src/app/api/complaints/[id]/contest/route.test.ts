import { prisma } from "@/lib/prisma";
import { __testing as rateLimitTesting } from "@/lib/rateLimit";
import { ComplaintStatus, UserRole } from "@/generated/prisma/client";
import type { NextRequest } from "next/server";

let mockUser: { id: string };

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => mockUser),
}));

import { POST } from "./route";

async function resetDb() {
  await prisma.$transaction([
    prisma.notification.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.contestation.deleteMany(),
    prisma.complaintEvent.deleteMany(),
    prisma.complaint.deleteMany(),
    prisma.user.deleteMany(),
    prisma.company.deleteMany(),
  ]);
}

describe("POST /api/complaints/[id]/contest", () => {
  beforeEach(async () => {
    await resetDb();
    rateLimitTesting.reset();
    await prisma.company.create({
      data: { id: "c1", name: "Companhia Teste", slug: "companhia-teste" },
    });
    await prisma.user.create({
      data: { id: "u1", email: "citizen@test.local", role: UserRole.CITIZEN, notifyInApp: true },
    });
    await prisma.complaint.create({
      data: {
        id: "cmp1",
        userId: "u1",
        companyId: "c1",
        category: "WATER",
        issue: "Sem água",
        description: "desc",
        status: ComplaintStatus.COMPANY_REPLIED,
        visibility: "PUBLIC",
      },
    });
    mockUser = { id: "u1" };
  });

  it("cria contestação, evento e notificação", async () => {
    const req = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Não resolve meu problema." }),
    });
    const res = await POST(req as unknown as NextRequest, { params: Promise.resolve({ id: "cmp1" }) });
    expect(res.status).toBe(200);

    const contest = await prisma.contestation.findMany({ where: { complaintId: "cmp1" } });
    expect(contest).toHaveLength(1);

    const events = await prisma.complaintEvent.findMany({ where: { complaintId: "cmp1" } });
    expect(events.some((e) => e.type === "USER_CONTESTED")).toBe(true);

    const notes = await prisma.notification.findMany({ where: { userId: "u1" } });
    expect(notes.some((n) => n.type === "CONTESTATION_RECEIVED")).toBe(true);
  });

  it("rejeita mensagem com padrão de XSS", async () => {
    const req = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: '<script>alert("x")</script>' }),
    });
    const res = await POST(req as unknown as NextRequest, { params: Promise.resolve({ id: "cmp1" }) });
    expect(res.status).toBe(400);

    const contest = await prisma.contestation.findMany({ where: { complaintId: "cmp1" } });
    expect(contest).toHaveLength(0);
  });

  it("oculta PII antes de salvar", async () => {
    const req = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Meu telefone é 11 99999-9999 e não resolveu." }),
    });
    const res = await POST(req as unknown as NextRequest, { params: Promise.resolve({ id: "cmp1" }) });
    expect(res.status).toBe(200);

    const contest = await prisma.contestation.findFirst({ where: { complaintId: "cmp1" } });
    expect(contest?.message).toContain("[dado ocultado]");
    expect(contest?.message).not.toContain("99999-9999");
  });

  it("retorna 415 quando content-type não é JSON", async () => {
    const req = new Request("http://localhost/api", { method: "POST", body: "x=y" });
    const res = await POST(req as unknown as NextRequest, { params: Promise.resolve({ id: "cmp1" }) });
    expect(res.status).toBe(415);
  });

  it("retorna 429 ao exceder limite de contestação (abuso)", async () => {
    let last: Response | null = null;
    for (let i = 0; i < 15; i += 1) {
      const req = new Request("http://localhost/api", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.3" },
        body: JSON.stringify({ message: `Contest ${i} ok` }),
      });
      last = await POST(req as unknown as NextRequest, { params: Promise.resolve({ id: "cmp1" }) });
    }
    expect(last?.status).toBe(429);
  });
});
