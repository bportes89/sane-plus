import { prisma } from "@/lib/prisma";
import { UserRole } from "@/generated/prisma/client";
import type { NextRequest } from "next/server";

let mockUser: { id: string; role: UserRole; companyId: string | null };

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => mockUser),
}));

import { GET, POST } from "./route";

async function resetDb() {
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.user.deleteMany(),
    prisma.company.deleteMany(),
  ]);
}

describe("GET/POST /api/companies/[id]/users", () => {
  beforeEach(async () => {
    await resetDb();
    await prisma.company.create({
      data: { id: "c1", name: "Companhia Teste", slug: "companhia-teste" },
    });
    await prisma.user.create({
      data: { id: "u_owner", email: "owner@test.local", role: UserRole.COMPANY, companyId: "c1" },
    });
    await prisma.user.create({
      data: { id: "u_citizen", email: "citizen@test.local", role: UserRole.CITIZEN },
    });
  });

  it("GET exige usuário da empresa", async () => {
    mockUser = { id: "u_citizen", role: UserRole.CITIZEN, companyId: null };
    const res = await GET({} as NextRequest, { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(403);
  });

  it("POST aceita json e transforma cidadão em usuário empresa", async () => {
    mockUser = { id: "u_owner", role: UserRole.COMPANY, companyId: "c1" };
    const req = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "citizen@test.local" }),
    });
    const res = await POST(req as unknown as NextRequest, { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(200);

    const updated = await prisma.user.findUnique({ where: { email: "citizen@test.local" } });
    expect(updated?.role).toBe(UserRole.COMPANY);
    expect(updated?.companyId).toBe("c1");
  });

  it("POST retorna 415 quando content-type não suportado", async () => {
    mockUser = { id: "u_owner", role: UserRole.COMPANY, companyId: "c1" };
    const req = new Request("http://localhost/api", { method: "POST", body: "x=y" });
    const res = await POST(req as unknown as NextRequest, { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(415);
  });
});

