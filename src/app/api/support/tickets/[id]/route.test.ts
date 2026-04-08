import { prisma } from "@/lib/prisma";
import { SupportTicketStatus, UserRole } from "@/generated/prisma/client";
import { __testing as rateLimitTesting } from "@/lib/rateLimit";
import type { NextRequest } from "next/server";

let mockUser: { id: string; role: UserRole };

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
  ]);
}

async function seed() {
  await prisma.user.create({
    data: { id: "u1", email: "citizen@test.local", role: UserRole.CITIZEN, notifyInApp: true, notifyEmail: true },
  });
  await prisma.user.create({
    data: { id: "u2", email: "other@test.local", role: UserRole.CITIZEN, notifyInApp: true, notifyEmail: true },
  });
  await prisma.user.create({
    data: { id: "u_staff", email: "mod@test.local", role: UserRole.MODERATOR, notifyInApp: true, notifyEmail: true },
  });
  await prisma.supportTicket.create({
    data: { id: "t1", userId: "u1", category: "GENERAL", status: SupportTicketStatus.OPEN, subject: "Ajuda" },
  });
}

describe("GET/POST /api/support/tickets/[id]", () => {
  beforeEach(async () => {
    rateLimitTesting.reset();
    await resetDb();
    await seed();
    mockUser = { id: "u1", role: UserRole.CITIZEN };
  });

  it("GET retorna 403 quando não é dono nem staff", async () => {
    mockUser = { id: "u2", role: UserRole.CITIZEN };
    const res = await GET({} as NextRequest, { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(403);
  });

  it("POST retorna 415 quando content-type não é JSON", async () => {
    const req = new Request("http://localhost/api", { method: "POST", body: "x=y" });
    const res = await POST(req as unknown as NextRequest, { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(415);
  });

  it("POST de staff bloqueia solicitação de dado sensível", async () => {
    mockUser = { id: "u_staff", role: UserRole.MODERATOR };
    const req = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Me envie seu CPF e endereço completo para validar." }),
    });
    const res = await POST(req as unknown as NextRequest, { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(400);
  });

  it("POST retorna 429 ao exceder limite de mensagens (abuso)", async () => {
    mockUser = { id: "u1", role: UserRole.CITIZEN };

    let last: Response | null = null;
    for (let i = 0; i < 35; i += 1) {
      const req = new Request("http://localhost/api", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.1" },
        body: JSON.stringify({ message: `msg ${i}` }),
      });
      last = await POST(req as unknown as NextRequest, { params: Promise.resolve({ id: "t1" }) });
    }
    expect(last?.status).toBe(429);
  });
});
