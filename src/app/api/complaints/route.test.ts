import { prisma } from "@/lib/prisma";
import { ComplaintStatus, ComplaintVisibility, UserRole } from "@/generated/prisma/client";
import { __testing as rateLimitTesting } from "@/lib/rateLimit";

let mockUser: { id: string };

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => mockUser),
}));

import { GET, POST } from "./route";

async function resetDb() {
  await prisma.$transaction([
    prisma.notification.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.webhookOutbox.deleteMany(),
    prisma.automationRule.deleteMany(),
    prisma.moderationAction.deleteMany(),
    prisma.complaintEvent.deleteMany(),
    prisma.complaint.deleteMany(),
    prisma.userBadge.deleteMany(),
    prisma.user.deleteMany(),
    prisma.company.deleteMany(),
  ]);
}

describe("/api/complaints", () => {
  beforeEach(async () => {
    rateLimitTesting.reset();
    await resetDb();
    const user = await prisma.user.create({
      data: { id: "u1", email: "citizen@test.local", role: UserRole.CITIZEN, notifyInApp: true },
    });
    mockUser = { id: user.id };
  });

  it("POST cria reclamação publicada e registra notificações/auditoria/pontos", async () => {
    const req = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        companyName: "Companhia Teste",
        category: "Água",
        issue: "Falta de água",
        description: "Sem água há 2 dias.",
        visibility: "PUBLIC",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBeTruthy();

    const complaint = await prisma.complaint.findUnique({
      where: { id: json.id },
      include: { events: true },
    });
    expect(complaint?.status).toBe(ComplaintStatus.PUBLISHED);
    expect(complaint?.visibility).toBe(ComplaintVisibility.PUBLIC);
    expect(complaint?.subcategory).toBe("Falta de água");
    expect(complaint?.events.some((e) => e.type === "REGISTERED")).toBe(true);
    expect(complaint?.events.some((e) => e.type === "PUBLISHED")).toBe(true);

    const notes = await prisma.notification.findMany({ where: { userId: "u1" } });
    expect(notes.some((n) => n.type === "COMPLAINT_REGISTERED")).toBe(true);

    const audit = await prisma.auditLog.findMany({ where: { userId: "u1", action: "CREATE_COMPLAINT" } });
    expect(audit).toHaveLength(1);

    const updatedUser = await prisma.user.findUnique({ where: { id: "u1" } });
    expect(updatedUser?.points).toBe(5);
  });

  it("POST coloca em análise quando tema sensível (review) e ajusta visibilidade", async () => {
    const req = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        companyName: "Companhia Teste",
        category: "Água",
        issue: "Água contaminada",
        description: "Pode haver contaminação e criança no hospital.",
        visibility: "PUBLIC",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();

    const complaint = await prisma.complaint.findUnique({ where: { id: json.id } });
    expect(complaint?.status).toBe(ComplaintStatus.NEEDS_REVIEW);
    expect(complaint?.visibility).toBe(ComplaintVisibility.PRIVATE);

    const notes = await prisma.notification.findMany({ where: { userId: "u1" } });
    expect(notes.some((n) => n.type === "MODERATION")).toBe(true);
  });

  it("POST aplica regra configurável (AutomationRule) em COMPLAINT_CREATED", async () => {
    await prisma.user.create({
      data: { id: "u_staff", email: "staff@test.local", role: UserRole.ADMIN, notifyInApp: true },
    });

    await prisma.automationRule.create({
      data: {
        name: "Alerta staff em caso crítico",
        enabled: true,
        trigger: "COMPLAINT_CREATED",
        priority: 10,
        conditions: { field: "urgency", op: "eq", value: "critical" },
        actions: [
          {
            type: "notify",
            target: "staff",
            title: "Caso crítico (regra)",
            message: "Reclamação marcada como crítica por regra configurável.",
            actionUrl: "/alerts",
            dedupeWithinHours: 6,
          },
        ],
      },
    });

    const req = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        companyName: "Companhia Teste",
        category: "Água",
        issue: "Água contaminada",
        description: "Pode haver contaminação e criança no hospital.",
        visibility: "PUBLIC",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const notes = await prisma.notification.findMany({ where: { userId: "u_staff" } });
    expect(notes.some((n) => n.title === "Caso crítico (regra)")).toBe(true);
  });

  it("POST rejeita descrição com padrão de XSS", async () => {
    const req = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        companyName: "Companhia Teste",
        category: "Água",
        issue: "Falta de água",
        description: '<img src=x onerror=alert(1)>',
        visibility: "PUBLIC",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("não podem ser publicadas");

    const count = await prisma.complaint.count();
    expect(count).toBe(0);
  });

  it("POST oculta PII e registra auto-moderação", async () => {
    const req = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        companyName: "Companhia Teste",
        category: "Água",
        issue: "Falta de água",
        description: "Meu CPF é 123.456.789-10 e meu e-mail é a@b.com.",
        visibility: "PUBLIC",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();

    const complaint = await prisma.complaint.findUnique({ where: { id: json.id } });
    expect(complaint?.description).toContain("[dado ocultado]");
    expect(complaint?.description).not.toContain("123.456.789-10");

    const moderation = await prisma.moderationAction.findMany({ where: { complaintId: json.id } });
    expect(moderation.some((m) => m.action === "EDITED")).toBe(true);
  });

  it("GET lista reclamações do usuário", async () => {
    const company = await prisma.company.create({
      data: { id: "c1", name: "Companhia Teste 2", slug: "companhia-teste-2" },
    });
    await prisma.complaint.create({
      data: {
        userId: "u1",
        companyId: company.id,
        category: "WATER",
        issue: "Baixa pressão",
        description: "desc",
        status: "PUBLISHED",
        visibility: "PUBLIC",
      },
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const items = await res.json();
    expect(items.length).toBe(1);
    expect(items[0].issue).toBe("Baixa pressão");
  });

  it("POST retorna 415 quando content-type não é JSON", async () => {
    const req = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "x=y",
    });

    const res = await POST(req);
    expect(res.status).toBe(415);
  });

  it("POST retorna 429 ao exceder limite de criação (abuso)", async () => {
    let last: Response | null = null;

    for (let i = 0; i < 12; i += 1) {
      const req = new Request("http://localhost/api", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.1" },
        body: JSON.stringify({
          companyName: "Companhia Teste",
          category: "Água",
          issue: "Falta de água",
          description: `Sem água há ${i} dias.`,
          visibility: "PUBLIC",
        }),
      });
      last = await POST(req);
    }

    expect(last?.status).toBe(429);
  });
});
