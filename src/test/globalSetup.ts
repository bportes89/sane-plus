import { execSync } from "node:child_process";

export default async function globalSetup() {
  const testDatabaseUrl = (process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "").trim();

  if (!testDatabaseUrl) {
    throw new Error("TEST_DATABASE_URL ou DATABASE_URL é obrigatório para rodar os testes com Postgres.");
  }

  process.env.DATABASE_URL = testDatabaseUrl;

  if (!process.env.DIRECT_URL) {
    process.env.DIRECT_URL = process.env.TEST_DIRECT_URL ?? testDatabaseUrl;
  }

  execSync("npx prisma db push --force-reset", {
    stdio: "inherit",
    env: { ...process.env },
  });

  return async () => {
    const { prisma } = await import("@/lib/prisma");
    await prisma.$disconnect();
  };
}
