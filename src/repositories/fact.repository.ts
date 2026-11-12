import "server-only";
import { prisma } from "@/lib/db";

export type StoredFact = { id: string; content: string; createdAt: Date };

const factSelect = { id: true, content: true, createdAt: true } as const;

/** Every query is scoped by userId: there is no way to read a fact by ID alone. */
export function findLatestFact(userId: string, movieTitle: string): Promise<StoredFact | null> {
  return prisma.fact.findFirst({
    where: { userId, movieTitle },
    orderBy: { createdAt: "desc" },
    select: factSelect,
  });
}

export function insertFact(userId: string, movieTitle: string, content: string): Promise<StoredFact> {
  return prisma.fact.create({ data: { userId, movieTitle, content }, select: factSelect });
}
