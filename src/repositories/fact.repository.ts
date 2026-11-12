import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { FactRepository, FactStore, StoredFact } from "@/services/fact.service";

type Db = Prisma.TransactionClient;

/**
 * Every query is scoped by userId; there is no way to read a fact by ID alone.
 * The fact's age is computed by Postgres (clock_timestamp() minus createdAt,
 * both from the database clock), so app servers with skewed clocks agree on it.
 */
function storeFor(db: Db): FactStore {
  return {
    async findLatest(userId, movieTitle) {
      // Raw SQL because the age needs the database clock; Prisma's query API can't express it.
      // Served by the (userId, movieTitle, createdAt DESC) index: one index probe, no sort.
      const rows = await db.$queryRaw<StoredFact[]>`
        SELECT "content",
               "createdAt",
               EXTRACT(EPOCH FROM (clock_timestamp() - "createdAt"))::float8 AS "ageSeconds"
        FROM "Fact"
        WHERE "userId" = ${userId} AND "movieTitle" = ${movieTitle}
        ORDER BY "createdAt" DESC
        LIMIT 1`;
      return rows[0] ?? null;
    },

    async insert(userId, movieTitle, content) {
      // createdAt is omitted on purpose: the column default is clock_timestamp().
      const fact = await db.fact.create({
        data: { userId, movieTitle, content },
        select: { content: true, createdAt: true },
      });
      return { ...fact, ageSeconds: 0 };
    },
  };
}

export function createPrismaFactRepository(options: {
  lockWaitMs: number;
  transactionTimeoutMs: number;
}): FactRepository {
  return {
    ...storeFor(prisma),

    withUserLock(userId, work) {
      return prisma.$transaction(
        async (tx) => {
          // Fail the wait instead of queueing forever behind a stuck holder.
          await tx.$executeRaw`SELECT set_config('lock_timeout', ${`${options.lockWaitMs}ms`}, true)`;
          // Transaction-scoped: released automatically on commit or rollback, and safe
          // through Neon's transaction-mode pooler (session-level advisory locks are not).
          // hashtext maps the cuid to the int key the lock needs; a rare collision only
          // makes two users wait on each other.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
          return work(storeFor(tx));
        },
        {
          maxWait: 5_000, // waiting for a pool connection
          timeout: options.transactionTimeoutMs, // Prisma's default is 5s, shorter than one OpenAI call
        },
      );
    },
  };
}
