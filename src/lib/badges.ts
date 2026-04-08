import { prisma } from "@/lib/prisma";

export async function addPoints(userId: string, points: number) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { points: { increment: points } },
  });
  await ensureBadges(userId, user.points);
}

async function ensureBadges(userId: string, points: number) {
  const badges: Array<{ code: string; threshold: number }> = [
    { code: "CIDADAO_ATIVO", threshold: 10 },
    { code: "FISCAL_DA_AGUA", threshold: 50 },
    { code: "CONTRIBUIDOR_OURO", threshold: 150 },
  ];

  for (const b of badges) {
    if (points >= b.threshold) {
      await prisma.userBadge.upsert({
        where: { userId_code: { userId, code: b.code } },
        create: { userId, code: b.code },
        update: {},
      });
    }
  }
}

