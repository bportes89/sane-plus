import { prisma } from "@/lib/prisma";
import { queueEmail } from "./outbox";

async function resetDb() {
  await prisma.$transaction([
    prisma.emailOutbox.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

describe("outbox.queueEmail", () => {
  beforeEach(async () => {
    await resetDb();
    await prisma.user.create({
      data: { id: "u1", email: "citizen@test.local", role: "CITIZEN", notifyEmail: true },
    });
  });

  it("retorna null quando destinatário ausente", async () => {
    const id = await queueEmail({ to: null, subject: "x", body: "y" });
    expect(id).toBeNull();
  });

  it("respeita preferências de e-mail do usuário", async () => {
    await prisma.user.update({ where: { id: "u1" }, data: { notifyEmail: false } });
    const id = await queueEmail({ to: "citizen@test.local", subject: "x", body: "y", userId: "u1" });
    expect(id).toBeNull();
  });

  it("cria item na fila quando permitido", async () => {
    const id = await queueEmail({ to: "citizen@test.local", subject: "x", body: "y", userId: "u1", meta: { k: "v" } });
    expect(id).toBeTruthy();
    const items = await prisma.emailOutbox.findMany();
    expect(items).toHaveLength(1);
    expect(items[0].subject).toBe("x");
  });
});

