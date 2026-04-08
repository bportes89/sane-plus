import { prisma } from "@/lib/prisma";
import { addPoints } from "./badges";

async function resetDb() {
  await prisma.$transaction([
    prisma.userBadge.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

describe("badges", () => {
  beforeEach(async () => {
    await resetDb();
    await prisma.user.create({
      data: { id: "u1", email: "citizen@test.local", role: "CITIZEN", points: 0 },
    });
  });

  it("atribui selo quando passa do limite", async () => {
    await addPoints("u1", 10);
    const badges = await prisma.userBadge.findMany({ where: { userId: "u1" } });
    expect(badges.map((b) => b.code)).toContain("CIDADAO_ATIVO");
  });
});

