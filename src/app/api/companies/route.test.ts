import { prisma } from "@/lib/prisma";

import { GET } from "./route";

async function resetDb() {
  await prisma.$transaction([
    prisma.notification.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.moderationAction.deleteMany(),
    prisma.responseAttachment.deleteMany(),
    prisma.companyResponse.deleteMany(),
    prisma.complaintEvent.deleteMany(),
    prisma.attachment.deleteMany(),
    prisma.companyMetric.deleteMany(),
    prisma.companyRating.deleteMany(),
    prisma.complaint.deleteMany(),
    prisma.user.updateMany({ where: { companyId: { not: null } }, data: { companyId: null } }),
    prisma.user.deleteMany({ where: { role: "COMPANY" } }),
    prisma.company.deleteMany(),
  ]);
}

describe("GET /api/companies", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("lista empresas ordenadas por nome", async () => {
    await prisma.company.create({
      data: { id: "c2", name: "Zeta", slug: "zeta" },
    });
    await prisma.company.create({
      data: { id: "c1", name: "Alpha", slug: "alpha" },
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const json = (await res.json()) as Array<{ id: string; name: string }>;
    expect(json.map((c) => c.id)).toEqual(["c1", "c2"]);
  });
});
