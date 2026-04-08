import { prisma } from "@/lib/prisma";
import { ComplaintStatus, ComplaintVisibility, ModerationActionType, UserRole } from "@/generated/prisma/client";
import type { NextRequest } from "next/server";

let mockUser: { id: string };

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => mockUser),
}));

import { DELETE, GET } from "./route";

async function resetDb() {
  await prisma.$transaction([
    prisma.notification.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.moderationAction.deleteMany(),
    prisma.contestation.deleteMany(),
    prisma.companyResponse.deleteMany(),
    prisma.complaintEvent.deleteMany(),
    prisma.attachment.deleteMany(),
    prisma.complaint.deleteMany(),
    prisma.user.deleteMany(),
    prisma.company.deleteMany(),
  ]);
}

describe("GET/DELETE /api/complaints/[id]", () => {
  beforeEach(async () => {
    await resetDb();
    await prisma.user.create({
      data: { id: "u1", email: "citizen@test.local", role: UserRole.CITIZEN, notifyInApp: true },
    });
    await prisma.company.create({
      data: { id: "c1", name: "Companhia Teste", slug: "companhia-teste" },
    });
    mockUser = { id: "u1" };
  });

  it("GET retorna 404 quando não existe", async () => {
    const res = await GET({} as NextRequest, { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });

  it("GET inclui proofRequired quando última ação exige comprovação", async () => {
    await prisma.complaint.create({
      data: {
        id: "cmp1",
        userId: "u1",
        companyId: "c1",
        category: "WATER",
        issue: "Sem água",
        description: "desc",
        status: ComplaintStatus.NEEDS_REVIEW,
        visibility: ComplaintVisibility.PRIVATE,
      },
    });
    await prisma.moderationAction.create({
      data: {
        id: "m1",
        complaintId: "cmp1",
        moderatorId: null,
        action: ModerationActionType.REQUESTED_PROOF,
        reason: "teste",
        originalContent: { ok: true },
        moderatorIp: null,
      },
    });

    const res = await GET({} as NextRequest, { params: Promise.resolve({ id: "cmp1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.proofRequired).toBe(true);
    expect(json.latestModerationAction.action).toBe("REQUESTED_PROOF");
  });

  it("DELETE exige confirmação e fecha a reclamação", async () => {
    await prisma.complaint.create({
      data: {
        id: "cmp_abcdef123456",
        userId: "u1",
        companyId: "c1",
        category: "WATER",
        issue: "Sem água",
        description: "desc",
        status: ComplaintStatus.PUBLISHED,
        visibility: ComplaintVisibility.PUBLIC,
      },
    });

    const badReq = new Request("http://localhost/api", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: "ERRADO" }),
    });
    const badRes = await DELETE(badReq as unknown as NextRequest, {
      params: Promise.resolve({ id: "cmp_abcdef123456" }),
    });
    expect(badRes.status).toBe(400);

    const okReq = new Request("http://localhost/api", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: "123456" }),
    });
    const okRes = await DELETE(okReq as unknown as NextRequest, {
      params: Promise.resolve({ id: "cmp_abcdef123456" }),
    });
    expect(okRes.status).toBe(200);

    const updated = await prisma.complaint.findUnique({
      where: { id: "cmp_abcdef123456" },
      select: { status: true, visibility: true, events: { select: { type: true } } },
    });
    expect(updated?.status).toBe(ComplaintStatus.CLOSED);
    expect(updated?.visibility).toBe(ComplaintVisibility.PRIVATE);
    expect(updated?.events.some((e) => e.type === "CLOSED")).toBe(true);

    const notes = await prisma.notification.findMany({ where: { userId: "u1" } });
    expect(notes.some((n) => n.title === "Reclamação removida")).toBe(true);
  });
});

