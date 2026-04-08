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

import { POST } from "./route";

async function resetDb() {
  await prisma.$transaction([
    prisma.session.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

describe("POST /api/auth/logout", () => {
  beforeEach(async () => {
    cookieJar = new Map();
    await resetDb();
  });

  it("remove sessão do banco e apaga cookie", async () => {
    const user = await prisma.user.create({
      data: { email: "ana@test.local", passwordHash: "hash", role: "CITIZEN" },
    });
    await prisma.session.create({
      data: { token: "t1", userId: user.id, expiresAt: new Date(Date.now() + 1000 * 60) },
    });
    cookieJar.set("sane_session", "t1");

    const res = await POST();
    expect(res.status).toBe(200);

    const sessions = await prisma.session.findMany({ where: { userId: user.id } });
    expect(sessions).toHaveLength(0);
    expect(cookieJar.has("sane_session")).toBe(false);
  });
});

