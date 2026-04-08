import { prisma } from "@/lib/prisma";

let cookieJar: Map<string, string>;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value ? { value } : undefined;
    },
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
    delete: (name: string) => {
      cookieJar.delete(name);
    },
  }),
}));

import { GET } from "./route";

async function resetDb() {
  await prisma.$transaction([
    prisma.session.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

describe("GET /api/auth/me", () => {
  beforeEach(async () => {
    cookieJar = new Map();
    await resetDb();
  });

  it("retorna 401 sem sessão", async () => {
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("retorna dados do usuário com sessão válida", async () => {
    const user = await prisma.user.create({
      data: {
        email: "ana@test.local",
        passwordHash: "hash",
        role: "CITIZEN",
        notifyInApp: true,
        notifyEmail: true,
      },
    });
    await prisma.session.create({
      data: { token: "t1", userId: user.id, expiresAt: new Date(Date.now() + 1000 * 60) },
    });
    cookieJar.set("sane_session", "t1");

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.email).toBe("ana@test.local");
    expect(json.role).toBe("CITIZEN");
  });
});

