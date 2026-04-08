import { prisma } from "@/lib/prisma";
import { SupportTicketStatus, UserRole } from "@/generated/prisma/client";
import { __testing as rateLimitTesting } from "@/lib/rateLimit";
import type { NextRequest } from "next/server";

let mockUser: { id: string; role: UserRole };

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => mockUser),
}));

import { POST } from "./route";

async function resetDb() {
  await prisma.$transaction([
    prisma.emailOutbox.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.auditLog.deleteMany(),
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
    data: { id: "u_mod", email: "mod@test.local", role: UserRole.MODERATOR, notifyInApp: true, notifyEmail: true },
  });
  await prisma.supportTicket.create({
    data: { id: "t1", userId: "u1", category: "GENERAL", status: SupportTicketStatus.OPEN, subject: "Ajuda" },
  });
  await prisma.supportTicket.create({
    data: { id: "t_closed", userId: "u1", category: "GENERAL", status: SupportTicketStatus.CLOSED, subject: "Fechado", closedAt: new Date() },
  });
}

describe("POST /api/support/tickets/[id]/escalate", () => {
  beforeEach(async () => {
    rateLimitTesting.reset();
    await resetDb();
    await seed();
    mockUser = { id: "u_mod", role: UserRole.MODERATOR };
  });

  it("retorna 403 quando não é staff", async () => {
    mockUser = { id: "u1", role: UserRole.CITIZEN };
    const req = new Request("http://localhost/api", { method: "POST" });
    const res = await POST(req as unknown as NextRequest, { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(403);
  });

  it("retorna 404 quando ticket não existe", async () => {
    const req = new Request("http://localhost/api", { method: "POST" });
    const res = await POST(req as unknown as NextRequest, { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });

  it("retorna 400 quando ticket está fechado", async () => {
    const req = new Request("http://localhost/api", { method: "POST" });
    const res = await POST(req as unknown as NextRequest, { params: Promise.resolve({ id: "t_closed" }) });
    expect(res.status).toBe(400);
  });

  it("retorna 429 ao exceder limite de escalonamentos (abuso)", async () => {
    let last: Response | null = null;
    for (let i = 0; i < 35; i += 1) {
      const req = new Request("http://localhost/api", {
        method: "POST",
        headers: { "x-forwarded-for": "10.0.0.10" },
      });
      last = await POST(req as unknown as NextRequest, { params: Promise.resolve({ id: "t1" }) });
    }
    expect(last?.status).toBe(429);
  });
});
