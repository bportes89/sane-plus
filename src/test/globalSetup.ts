import path from "node:path";
import { execSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";

function toSqliteFileUrl(absolutePath: string) {
  return `file:${absolutePath.replace(/\\/g, "/")}`;
}

export default async function globalSetup() {
  const rootDir = process.cwd();
  const tmpDir = path.join(rootDir, ".tmp");
  const dbPath = path.join(tmpDir, "test.db");

  mkdirSync(tmpDir, { recursive: true });
  rmSync(dbPath, { force: true });

  process.env.DATABASE_URL = toSqliteFileUrl(dbPath);

  execSync("npx prisma db push --force-reset", {
    stdio: "inherit",
    env: { ...process.env },
  });

  return async () => {
    const { prisma } = await import("@/lib/prisma");
    await prisma.$disconnect();
    rmSync(dbPath, { force: true });
  };
}
