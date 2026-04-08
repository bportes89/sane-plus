import { prisma } from "@/lib/prisma";
import { UserRole } from "@/generated/prisma/client";
import type { NextRequest } from "next/server";

let mockUser: { id: string; role: UserRole };

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => mockUser),
}));

import { GET } from "./route";

async function resetDb() {
  await prisma.$transaction([
    prisma.moderationAction.deleteMany(),
    prisma.complaint.deleteMany(),
    prisma.user.deleteMany(),
    prisma.company.deleteMany(),
  ]);
}

describe("GET /api/moderation/[id]", () => {
  beforeEach(async () => {
    await resetDb();
    await prisma.user.create({
      data: { id: "u_mod", email: "mod@test.local", role: UserRole.MODERATOR },
    });
    await prisma.user.create({
      data: { id: "u_citizen", email: "citizen@test.local", role: UserRole.CITIZEN },
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
        status: "PUBLISHED",
        visibility: "PUBLIC",
      },
    });
    await prisma.moderationAction.create({
      data: {
        id: "m1",
        complaintId: "cmp1",
        moderatorId: "u_mod",
        action: "EDITED",
        reason: "x",
        originalContent: { ok: true },
        moderatorIp: null,
      },
    });
  });

  it("retorna 403 sem permissão", async () => {
    mockUser = { id: "u_citizen", role: UserRole.CITIZEN };
    const res = await GET({} as NextRequest, { params: Promise.resolve({ id: "m1" }) });
    expect(res.status).toBe(403);
  });

  it("retorna item", async () => {
    mockUser = { id: "u_mod", role: UserRole.MODERATOR };
    const res = await GET({} as NextRequest, { params: Promise.resolve({ id: "m1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe("m1");
    expect(json.complaint.id).toBe("cmp1");
  });
});

