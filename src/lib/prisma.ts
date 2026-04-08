import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaAdapter: PrismaBetterSqlite3 | undefined;
};

const url = process.env.DATABASE_URL ?? "file:./dev.db";

const adapter =
  globalForPrisma.prismaAdapter ?? new PrismaBetterSqlite3({ url });

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaAdapter = adapter;
}
