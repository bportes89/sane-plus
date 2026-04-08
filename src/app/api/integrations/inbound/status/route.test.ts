import { prisma } from "@/lib/prisma";
import { createApiTokenIntegration } from "@/lib/integrations";
import { ComplaintStatus, ComplaintVisibility, IntegrationScope, UserRole } from "@/generated/prisma/client";
import { __testing as rateLimitTesting } from "@/lib/rateLimit";
import type { NextRequest } from "next/server";

import { POST } from "./route";

async function resetDb() {
  await prisma.$transaction([
    prisma.externalProtocol.deleteMany(),
    prisma.complaintEvent.deleteMany(),
    prisma.complaint.deleteMany(),
    prisma.user.deleteMany(),
    prisma.integration.deleteMany(),
    prisma.company.deleteMany(),
  ]);
}

describe("POST /api/integrations/inbound/status", () => {
  beforeEach(async () => {
    rateLimitTesting.reset();
    await resetDb();
    await prisma.user.create({ data: { id: "u1", email: "citizen@test.local", role: UserRole.CITIZEN } });
    await prisma.company.create({ data: { id: "c1", name: "Companhia 1", slug: "c1", city: "X", state: "YY" } });
    await prisma.company.create({ data: { id: "c2", name: "Companhia 2", slug: "c2", city: "Z", state: "YY" } });
  });

  it("autentica por Bearer token e atualiza status + cria protocolo externo", async () => {
    const complaint = await prisma.complaint.create({
      data: {
        id: "cmp1",
        userId: "u1",
        companyId: "c1",
        category: "WATER",
        issue: "Falta de água",
        description: "Teste",
        status: ComplaintStatus.PUBLISHED,
        visibility: ComplaintVisibility.PUBLIC,
      },
      select: { id: true },
    });

    const { token } = await createApiTokenIntegration({
      prisma,
      name: "API C1",
      scope: IntegrationScope.COMPANY,
      companyId: "c1",
    });

    const req = new Request("http://localhost/api/integrations/inbound/status", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        complaintId: complaint.id,
        externalProtocol: "P-123",
        externalStatus: "VIEWED",
        message: "Protocolo recebido",
      }),
    });
    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; complaintStatus: string };
    expect(json.ok).toBe(true);
    expect(json.complaintStatus).toBe(ComplaintStatus.COMPANY_VIEWED);

    const updated = await prisma.complaint.findUnique({ where: { id: complaint.id }, select: { status: true } });
    expect(updated?.status).toBe(ComplaintStatus.COMPANY_VIEWED);

    const protocols = await prisma.externalProtocol.findMany({ where: { complaintId: complaint.id } });
    expect(protocols).toHaveLength(1);
    expect(protocols[0]?.externalProtocol).toBe("P-123");
  });

  it("bloqueia atualização fora do escopo da integração", async () => {
    await prisma.complaint.create({
      data: {
        id: "cmp2",
        userId: "u1",
        companyId: "c2",
        category: "WATER",
        issue: "Falta de água",
        description: "Teste",
        status: ComplaintStatus.PUBLISHED,
        visibility: ComplaintVisibility.PUBLIC,
      },
    });

    const { token } = await createApiTokenIntegration({
      prisma,
      name: "API C1",
      scope: IntegrationScope.COMPANY,
      companyId: "c1",
    });

    const req = new Request("http://localhost/api/integrations/inbound/status", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        complaintId: "cmp2",
        externalProtocol: "P-999",
        externalStatus: "VIEWED",
      }),
    });
    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(403);
  });
});
