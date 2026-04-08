import { prisma } from "@/lib/prisma";
import { UserRole } from "@/generated/prisma/client";
import type { NextRequest } from "next/server";

let mockUser: { id: string; role: UserRole; companyId: string | null };

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => mockUser),
}));

import { GET, PUT } from "./route";

async function resetDb() {
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.companyMetric.deleteMany(),
    prisma.user.deleteMany(),
    prisma.company.deleteMany(),
  ]);
}

describe("GET/PUT /api/companies/[id]", () => {
  beforeEach(async () => {
    await resetDb();
    await prisma.company.create({
      data: { id: "c1", name: "Companhia Teste", slug: "companhia-teste", city: "X", state: "SP" },
    });
    await prisma.user.create({
      data: { id: "u_company", email: "company@test.local", role: UserRole.COMPANY, companyId: "c1" },
    });
  });

  it("GET retorna 404 se não existe", async () => {
    const res = await GET({} as NextRequest, { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });

  it("GET retorna empresa", async () => {
    const res = await GET({} as NextRequest, { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe("c1");
  });

  it("PUT exige usuário da empresa", async () => {
    mockUser = { id: "u_company", role: UserRole.CITIZEN, companyId: null };
    const req = new Request("http://localhost/api", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ city: "Y" }),
    });
    const res = await PUT(req as unknown as NextRequest, { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(403);
  });

  it("PUT atualiza campos e registra auditoria", async () => {
    mockUser = { id: "u_company", role: UserRole.COMPANY, companyId: "c1" };
    const req = new Request("http://localhost/api", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ city: "Curitiba", state: "pr", logoUrl: "https://ex.com/logo.png" }),
    });
    const res = await PUT(req as unknown as NextRequest, { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(200);

    const updated = await prisma.company.findUnique({ where: { id: "c1" } });
    expect(updated?.city).toBe("Curitiba");
    expect(updated?.state).toBe("PR");

    const audit = await prisma.auditLog.findMany({ where: { userId: "u_company", action: "UPDATE_COMPANY" } });
    expect(audit).toHaveLength(1);
  });
});

