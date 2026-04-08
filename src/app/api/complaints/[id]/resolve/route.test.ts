import { prisma } from "@/lib/prisma";
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
    prisma.userBadge.deleteMany(),
    prisma.complaintEvent.deleteMany(),
    prisma.complaint.deleteMany(),
    prisma.user.deleteMany(),
    prisma.company.deleteMany(),
  ]);
}

describe("POST /api/complaints/[id]/resolve", () => {
  beforeEach(async () => {
    await resetDb();
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

  it("marca como resolvida, notifica e adiciona pontos", async () => {
    const req = new Request("http://localhost/api", { method: "POST" });
    const res = await POST(req as unknown as NextRequest, { params: Promise.resolve({ id: "cmp1" }) });
    expect(res.status).toBe(200);

    const c = await prisma.complaint.findUnique({
      where: { id: "cmp1" },
      select: { status: true, resolvedAt: true, events: { select: { type: true } } },
    });
    expect(c?.status).toBe(ComplaintStatus.RESOLVED);
    expect(c?.resolvedAt).toBeTruthy();
    expect(c?.events.some((e) => e.type === "MARKED_RESOLVED")).toBe(true);

    const notes = await prisma.notification.findMany({ where: { userId: "u1" } });
    expect(notes.some((n) => n.type === "COMPLAINT_RESOLVED")).toBe(true);

    const user = await prisma.user.findUnique({ where: { id: "u1" } });
    expect(user?.points).toBe(3);
  });
});

