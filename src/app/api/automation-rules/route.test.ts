import { prisma } from "@/lib/prisma";
import { UserRole } from "@/generated/prisma/client";
import type { NextRequest } from "next/server";

let mockUser: { id: string; role: UserRole };

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => mockUser),
}));

import { GET, POST } from "./route";
import { PUT, DELETE } from "./[id]/route";

async function resetDb() {
  await prisma.$transaction([
    prisma.automationRule.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

describe("/api/automation-rules", () => {
  beforeEach(async () => {
    await resetDb();
    await prisma.user.create({ data: { id: "u_admin", email: "admin@test.local", role: UserRole.ADMIN } });
    mockUser = { id: "u_admin", role: UserRole.ADMIN };
  });

  it("GET retorna 403 para usuário não staff", async () => {
    mockUser = { id: "u1", role: UserRole.CITIZEN };
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("POST cria regra e GET lista", async () => {
    const req = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Regra teste",
        trigger: "COMPLAINT_CREATED",
        enabled: true,
        priority: 10,
        conditions: { field: "urgency", op: "eq", value: "critical" },
        actions: [{ type: "notify", target: "staff", title: "x", message: "y" }],
      }),
    });
    const createdRes = await POST(req);
    expect(createdRes.status).toBe(200);
    const created = (await createdRes.json()) as { id: string };
    expect(created.id).toBeTruthy();

    const listRes = await GET();
    expect(listRes.status).toBe(200);
    const items = (await listRes.json()) as Array<{ id: string; name: string }>;
    expect(items.some((r) => r.id === created.id)).toBe(true);
  });

  it("PUT desativa regra e DELETE remove", async () => {
    const rule = await prisma.automationRule.create({
      data: {
        name: "Regra a remover",
        trigger: "COMPLAINT_CREATED",
        enabled: true,
        priority: 100,
        conditions: { field: "category", op: "exists" },
        actions: [{ type: "dataAlert", scope: "INTERNAL", alertType: "RECURRING", title: "t", message: "m" }],
      },
      select: { id: true },
    });

    const putReq = new Request("http://localhost/api", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    const putRes = await PUT(putReq, { params: Promise.resolve({ id: rule.id }) });
    expect(putRes.status).toBe(200);
    const updated = await prisma.automationRule.findUnique({ where: { id: rule.id } });
    expect(updated?.enabled).toBe(false);

    const delRes = await DELETE({} as NextRequest, { params: Promise.resolve({ id: rule.id }) });
    expect(delRes.status).toBe(200);
    const gone = await prisma.automationRule.findUnique({ where: { id: rule.id } });
    expect(gone).toBeNull();
  });
});

