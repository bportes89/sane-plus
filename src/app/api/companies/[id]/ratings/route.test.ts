import { prisma } from "@/lib/prisma";
import { ComplaintStatus, UserRole } from "@/generated/prisma/client";
import type { NextRequest } from "next/server";

let mockUser: { id: string };

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => mockUser),
}));

import { GET, POST } from "./route";

async function resetDb() {
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.companyRating.deleteMany(),
    prisma.complaint.deleteMany(),
    prisma.user.deleteMany(),
    prisma.company.deleteMany(),
  ]);
}

describe("GET/POST /api/companies/[id]/ratings", () => {
  beforeEach(async () => {
    await resetDb();
    await prisma.company.create({
      data: { id: "c1", name: "Companhia Teste", slug: "companhia-teste" },
    });
    await prisma.user.create({
      data: { id: "u1", email: "citizen@test.local", role: UserRole.CITIZEN },
    });
    mockUser = { id: "u1" };
  });

  it("GET lista avaliações", async () => {
    await prisma.complaint.create({
      data: {
        id: "cmp1",
        userId: "u1",
        companyId: "c1",
        category: "WATER",
        issue: "Sem água",
        description: "desc",
        status: ComplaintStatus.RESOLVED,
        visibility: "PUBLIC",
      },
    });
    await prisma.companyRating.create({
      data: { id: "r1", companyId: "c1", userId: "u1", complaintId: "cmp1", score: 5, comment: "ok" },
    });
    const res = await GET({} as NextRequest, { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(1);
  });

  it("POST valida status resolvida e atualiza overallScore", async () => {
    await prisma.complaint.create({
      data: {
        id: "cmp1",
        userId: "u1",
        companyId: "c1",
        category: "WATER",
        issue: "Sem água",
        description: "desc",
        status: ComplaintStatus.RESOLVED,
        visibility: "PUBLIC",
      },
    });
    const req = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ complaintId: "cmp1", score: 4, comment: "ok" }),
    });
    const res = await POST(req as unknown as NextRequest, { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.overallScore).toBe(4);
  });

  it("POST retorna 400 para score inválido", async () => {
    const req = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ complaintId: "cmp1", score: 10 }),
    });
    const res = await POST(req as unknown as NextRequest, { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(400);
  });
});
