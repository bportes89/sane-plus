import { prisma } from "@/lib/prisma";
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
    prisma.session.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

describe("POST /api/auth/register", () => {
  beforeEach(async () => {
    cookieJar = new Map();
    lastSet = null;
    rateLimitTesting.reset();
    await resetDb();
  });

  it("cria usuário cidadão, cria sessão e registra auditoria", async () => {
    const req = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Ana",
        email: "ana@test.local",
        password: "Senha#123",
        city: "Cidade",
        state: "UF",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const user = await prisma.user.findUnique({ where: { email: "ana@test.local" } });
    expect(user?.passwordHash).toBeTruthy();

    const sessions = await prisma.session.findMany({ where: { userId: user?.id } });
    expect(sessions).toHaveLength(1);

    expect(cookieJar.has("sane_session")).toBe(true);
    expect(lastSet?.options?.httpOnly).toBe(true);
    expect(lastSet?.options?.sameSite).toBe("lax");
    expect(lastSet?.options?.path).toBe("/");

    const audit = await prisma.auditLog.findMany({ where: { userId: user?.id, action: "REGISTER" } });
    expect(audit).toHaveLength(1);
  });

  it("retorna 409 quando e-mail já existe", async () => {
    await prisma.user.create({
      data: { email: "ana@test.local", passwordHash: "hash", role: "CITIZEN" },
    });

    const req = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ana@test.local", password: "Senha#123" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(409);
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

  it("retorna 429 após excesso de registros por IP", async () => {
    let lastStatus = 0;
    for (let i = 0; i < 7; i += 1) {
      const req = new Request("http://localhost/api", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.9" },
        body: JSON.stringify({
          name: "Ana",
          email: `ana_${i}@test.local`,
          password: "Senha#123",
        }),
      });
      const res = await POST(req);
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});
