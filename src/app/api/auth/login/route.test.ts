import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { __testing as rateLimitTesting } from "@/lib/rateLimit";

let cookieJar: Map<string, string>;
let lastSet: { name: string; value: string; options: Record<string, unknown> } | null;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value ? { value } : undefined;
    },
    set: (name: string, value: string, options: Record<string, unknown>) => {
      cookieJar.set(name, value);
      lastSet = { name, value, options };
    },
    delete: (name: string) => {
      cookieJar.delete(name);
    },
  }),
}));

import { POST } from "./route";

async function resetDb() {
  await prisma.$transaction([
    prisma.accessLog.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.session.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

describe("POST /api/auth/login", () => {
  beforeEach(async () => {
    cookieJar = new Map();
    lastSet = null;
    rateLimitTesting.reset();
    await resetDb();
  });

  it("loga com credenciais válidas, cria sessão e registra logs", async () => {
    const passwordHash = await hashPassword("Senha#123");
    const user = await prisma.user.create({
      data: { email: "ana@test.local", passwordHash, role: "CITIZEN" },
    });

    const req = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.1" },
      body: JSON.stringify({ email: "ana@test.local", password: "Senha#123" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const sessions = await prisma.session.findMany({ where: { userId: user.id } });
    expect(sessions).toHaveLength(1);
    expect(cookieJar.has("sane_session")).toBe(true);
    expect(lastSet?.options?.httpOnly).toBe(true);

    const access = await prisma.accessLog.findMany({ where: { userId: user.id } });
    expect(access).toHaveLength(1);

    const audit = await prisma.auditLog.findMany({ where: { userId: user.id, action: "LOGIN" } });
    expect(audit).toHaveLength(1);
  });

  it("retorna 401 com senha incorreta", async () => {
    const passwordHash = await hashPassword("Senha#123");
    await prisma.user.create({ data: { email: "ana@test.local", passwordHash, role: "CITIZEN" } });

    const req = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ana@test.local", password: "errada" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("retorna 415 quando content-type não é JSON", async () => {
    const req = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "x=y",
    });
    const res = await POST(req);
    expect(res.status).toBe(415);
  });

  it("retorna 429 após excesso de tentativas por IP", async () => {
    const passwordHash = await hashPassword("Senha#123");
    await prisma.user.create({ data: { email: "ana@test.local", passwordHash, role: "CITIZEN" } });

    let lastStatus = 0;
    for (let i = 0; i < 12; i += 1) {
      const req = new Request("http://localhost/api", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.1" },
        body: JSON.stringify({ email: "ana@test.local", password: "errada" }),
      });
      const res = await POST(req);
      lastStatus = res.status;
    }

    expect(lastStatus).toBe(429);

    const otherIpReq = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.2" },
      body: JSON.stringify({ email: "ana@test.local", password: "errada" }),
    });
    const otherIpRes = await POST(otherIpReq);
    expect(otherIpRes.status).toBe(401);
  });
});
