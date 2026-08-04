import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | null;
};

export const prisma: PrismaClient | null =
  process.env.DATABASE_URL
    ? globalForPrisma.prisma ??
      new PrismaClient({
        log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
      })
    : null;

if (process.env.NODE_ENV !== "production" && prisma) globalForPrisma.prisma = prisma;
