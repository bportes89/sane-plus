import { prisma } from "@/lib/prisma";
import { ComplaintCategory, ComplaintStatus, NotificationType, UserRole } from "@/generated/prisma/client";
import type { NextRequest } from "next/server";
import { POST } from "./route";

async function resetDb() {
  await prisma.$transaction([
    prisma.notification.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.dataAlert.deleteMany(),
    prisma.companyResponse.deleteMany(),
    prisma.complaint.deleteMany(),
    prisma.user.deleteMany(),
    prisma.company.deleteMany(),
  ]);
}

describe("POST /api/complaints/slas/process", () => {
  const prevCron = process.env.CRON_SECRET;

  beforeEach(async () => {
    await resetDb();
    process.env.CRON_SECRET = "test_secret";

    await prisma.company.create({
      data: { id: "c1", name: "Companhia X", slug: "companhia-x", status: "ACTIVE", city: "São Paulo", state: "SP" },
    });
    await prisma.user.create({
      data: { id: "u_company", email: "company@test.local", role: UserRole.COMPANY, companyId: "c1", notifyInApp: true },
    });
  });

  afterAll(() => {
    process.env.CRON_SECRET = prevCron;
  });

  it("dryRun retorna contagens e não cria alertas/notificações", async () => {
    const createdAt = new Date(Date.now() - 72 * 60 * 60 * 1000);
    await prisma.user.create({ data: { id: "u1", email: "cit@test.local", role: UserRole.CITIZEN, notifyInApp: true } });
    await prisma.complaint.create({
      data: {
        id: "k1",
        userId: "u1",
        companyId: "c1",
        category: ComplaintCategory.WATER,
        issue: "Falta de água",
        description: "Sem água",
        status: ComplaintStatus.PUBLISHED,
        createdAt,
      },
    });

    const req = new Request("http://localhost/api/complaints/slas/process", {
      method: "POST",
      headers: { "content-type": "application/json", "x-cron-secret": "test_secret" },
      body: JSON.stringify({ dryRun: true, hoursCompanyFirstReply: 48, hoursUrgentFirstReply: 6 }),
    });
    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.preview).toBe(true);
    expect(json.counts.overdue).toBe(1);

    const alerts = await prisma.dataAlert.count();
    expect(alerts).toBe(0);
    const notes = await prisma.notification.count();
    expect(notes).toBe(0);
  });

  it("cria alerta de SLA e notifica empresa quando há reclamações sem resposta", async () => {
    const createdAt = new Date(Date.now() - 72 * 60 * 60 * 1000);
    await prisma.user.create({ data: { id: "u1", email: "cit@test.local", role: UserRole.CITIZEN, notifyInApp: true } });
    await prisma.complaint.createMany({
      data: [
        {
          id: "k1",
          userId: "u1",
          companyId: "c1",
          category: ComplaintCategory.WATER,
          issue: "Falta de água",
          description: "Sem água",
          status: ComplaintStatus.PUBLISHED,
          createdAt,
        },
        {
          id: "k2",
          userId: "u1",
          companyId: "c1",
          category: ComplaintCategory.WATER,
          issue: "Falta de água",
          description: "Sem água",
          status: ComplaintStatus.PUBLISHED,
          createdAt,
        },
      ],
    });

    const req = new Request("http://localhost/api/complaints/slas/process", {
      method: "POST",
      headers: { "content-type": "application/json", "x-cron-secret": "test_secret" },
      body: JSON.stringify({ dryRun: false, hoursCompanyFirstReply: 48, hoursUrgentFirstReply: 6 }),
    });
    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.counts.overdue).toBe(2);
    expect(json.counts.companies).toBe(1);

    const alerts = await prisma.dataAlert.findMany();
    expect(alerts.some((a) => a.title.includes("SLA: reclamações sem resposta"))).toBe(true);

    const notes = await prisma.notification.findMany({ where: { userId: "u_company" } });
    expect(notes.some((n) => n.type === NotificationType.ALERT)).toBe(true);

    const audit = await prisma.auditLog.findMany({ where: { action: "PROCESS_COMPLAINT_SLAS" } });
    expect(audit).toHaveLength(1);
  });

  it("notifica staff para urgentes mesmo antes do SLA geral", async () => {
    await prisma.user.create({ data: { id: "u_staff", email: "staff@test.local", role: UserRole.ADMIN, notifyInApp: true } });
    await prisma.user.create({ data: { id: "u1", email: "cit@test.local", role: UserRole.CITIZEN, notifyInApp: true } });

    const createdAt = new Date(Date.now() - 7 * 60 * 60 * 1000);
    await prisma.complaint.create({
      data: {
        id: "k_urgent",
        userId: "u1",
        companyId: "c1",
        category: ComplaintCategory.WATER,
        issue: "Água contaminada",
        description: "Possível contaminação, criança no hospital.",
        status: ComplaintStatus.PUBLISHED,
        createdAt,
      },
    });

    const req = new Request("http://localhost/api/complaints/slas/process", {
      method: "POST",
      headers: { "content-type": "application/json", "x-cron-secret": "test_secret" },
      body: JSON.stringify({ dryRun: false, hoursCompanyFirstReply: 48, hoursUrgentFirstReply: 6 }),
    });
    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.counts.overdue).toBe(0);
    expect(json.counts.urgent).toBe(1);

    const notes = await prisma.notification.findMany({ where: { userId: "u_staff" } });
    expect(notes.some((n) => n.type === NotificationType.ALERT && n.title.includes("casos urgentes"))).toBe(true);
  });
});

