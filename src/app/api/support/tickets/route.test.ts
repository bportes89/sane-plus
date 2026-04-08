import { prisma } from "@/lib/prisma";
import { SupportTicketStatus, UserRole } from "@/generated/prisma/client";
import { __testing as rateLimitTesting } from "@/lib/rateLimit";
import type { NextRequest } from "next/server";

let mockUser: { id: string; role: UserRole; email: string | null };

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => mockUser),
}));

import { GET, POST } from "./route";

async function resetDb() {
  await prisma.$transaction([
    prisma.emailOutbox.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.supportAttachment.deleteMany(),
    prisma.supportMessage.deleteMany(),
    prisma.supportRating.deleteMany(),
    prisma.supportTicket.deleteMany(),
    prisma.user.deleteMany(),
    prisma.company.deleteMany(),
    prisma.complaint.deleteMany(),
  ]);
}

describe("GET/POST /api/support/tickets", () => {
  beforeEach(async () => {
    rateLimitTesting.reset();
    await resetDb();
    await prisma.user.create({
      data: { id: "u1", email: "citizen@test.local", role: UserRole.CITIZEN, notifyInApp: true, notifyEmail: true },
    });
    await prisma.user.create({
      data: { id: "u_mod", email: "mod@test.local", role: UserRole.MODERATOR, notifyInApp: true, notifyEmail: true },
    });
    mockUser = { id: "u1", role: UserRole.CITIZEN, email: "citizen@test.local" };
  });

  it("GET retorna 403 quando tenta listar todos sem ser staff", async () => {
    const req = new Request("http://localhost/api?all=1");
    const res = await GET(req as unknown as NextRequest);
    expect(res.status).toBe(403);
  });

  it("POST retorna 415 quando content-type não é JSON", async () => {
    const req = new Request("http://localhost/api", { method: "POST", body: "x=y" });
    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(415);
  });

  it("POST cria ticket e registra notificação/auditoria/outbox", async () => {
    const req = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.1" },
      body: JSON.stringify({
        subject: "Ajuda",
        message: "Preciso de suporte.",
        category: "GENERAL",
      }),
    });
    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);

    const ticket = await prisma.supportTicket.findUnique({ where: { id: json.id } });
    expect(ticket?.status).toBe(SupportTicketStatus.OPEN);

    const msg = await prisma.supportMessage.findMany({ where: { ticketId: json.id } });
    expect(msg).toHaveLength(1);

    const notes = await prisma.notification.findMany({ where: { userId: "u1" } });
    expect(notes.some((n) => n.title === "Chamado registrado")).toBe(true);

    const audit = await prisma.auditLog.findMany({ where: { userId: "u1", action: "CREATE_SUPPORT_TICKET" } });
    expect(audit).toHaveLength(1);

    const outbox = await prisma.emailOutbox.findMany({ where: { userId: "u1" } });
    expect(outbox.length).toBeGreaterThan(0);
  });

  it("POST retorna 429 ao exceder limite de criação (abuso)", async () => {
    let last: Response | null = null;
    for (let i = 0; i < 12; i += 1) {
      const req = new Request("http://localhost/api", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.1" },
        body: JSON.stringify({
          subject: `Ajuda ${i}`,
          message: "Preciso de suporte.",
          category: "GENERAL",
        }),
      });
      last = await POST(req as unknown as NextRequest);
    }
    expect(last?.status).toBe(429);
  });
});
