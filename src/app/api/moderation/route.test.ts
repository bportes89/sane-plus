import { prisma } from "@/lib/prisma";
import { __testing as rateLimitTesting } from "@/lib/rateLimit";
import { ComplaintStatus, ComplaintVisibility, ModerationActionType, UserRole } from "@/generated/prisma/client";

let mockUser: { id: string; role: UserRole };

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

describe("POST /api/moderation", () => {
  beforeEach(async () => {
    await resetDb();
    rateLimitTesting.reset();
    await prisma.user.create({
      data: { id: "u_mod", email: "mod@test.local", role: UserRole.MODERATOR, notifyInApp: true },
    });
    await prisma.user.create({
      data: { id: "u_citizen", email: "citizen@test.local", role: UserRole.CITIZEN, notifyInApp: true },
    });
    await prisma.company.create({
      data: { id: "c1", name: "Companhia Teste", slug: "companhia-teste" },
    });
    await prisma.complaint.create({
      data: {
        id: "cmp1",
        userId: "u_citizen",
        companyId: "c1",
        category: "WATER",
        issue: "Sem água",
        description: "desc",
        status: ComplaintStatus.NEEDS_REVIEW,
        visibility: ComplaintVisibility.PRIVATE,
      },
    });
  });

  it("retorna 403 quando não tem permissão", async () => {
    mockUser = { id: "u_citizen", role: UserRole.CITIZEN };
    const req = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ complaintId: "cmp1", action: "EDITED", reason: "x" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("aplica ação EDITED e notifica usuário", async () => {
    mockUser = { id: "u_mod", role: UserRole.MODERATOR };
    const req = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        complaintId: "cmp1",
        action: "EDITED",
        reason: "Ajuste",
        edited: { description: "novo" },
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const updated = await prisma.complaint.findUnique({ where: { id: "cmp1" } });
    expect(updated?.status).toBe(ComplaintStatus.PUBLISHED);
    expect(updated?.description).toBe("novo");

    const moderation = await prisma.moderationAction.findMany({ where: { complaintId: "cmp1" } });
    expect(moderation).toHaveLength(1);
    expect(moderation[0].action).toBe(ModerationActionType.EDITED);

    const notes = await prisma.notification.findMany({ where: { userId: "u_citizen" } });
    expect(notes.some((n) => n.type === "CONTENT_ADJUSTED")).toBe(true);
  });

  it("retorna 415 quando content-type não é JSON", async () => {
    mockUser = { id: "u_mod", role: UserRole.MODERATOR };
    const req = new Request("http://localhost/api", { method: "POST", body: "x=y" });
    const res = await POST(req);
    expect(res.status).toBe(415);
  });

  it("retorna 429 ao exceder limite de ações de moderação por IP", async () => {
    mockUser = { id: "u_mod", role: UserRole.MODERATOR };
    let last: Response | null = null;
    for (let i = 0; i < 65; i += 1) {
      const req = new Request("http://localhost/api", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "172.16.0.9" },
        body: JSON.stringify({ complaintId: "cmp1", action: "RESTORED" }),
      });
      last = await POST(req);
    }
    expect(last?.status).toBe(429);
  });
});
