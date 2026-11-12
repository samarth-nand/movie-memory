import "server-only";
import { GENERATION_DEADLINE_MS, generateMovieFact } from "@/lib/ai-gateway";
import { createPrismaFactRepository } from "@/repositories/fact.repository";
import { findUserProfile } from "@/repositories/user.repository";
import { createFactService } from "./fact.service";

// Wires the fact service to Postgres and OpenAI. Kept apart from fact.service.ts
// so tests can import the logic without loading Prisma, OpenAI, or env.

// A waiter can sit behind one full generation by the lock holder.
const LOCK_WAIT_MS = GENERATION_DEADLINE_MS + 2_000;
// Worst case inside one transaction: wait for the lock, then generate ourselves.
// Must exceed both, or Prisma closes the transaction mid-call.
const TRANSACTION_TIMEOUT_MS = LOCK_WAIT_MS + GENERATION_DEADLINE_MS + 5_000;

export const { getFactForUser } = createFactService({
  facts: createPrismaFactRepository({
    lockWaitMs: LOCK_WAIT_MS,
    transactionTimeoutMs: TRANSACTION_TIMEOUT_MS,
  }),
  findFavoriteMovie: async (userId) => (await findUserProfile(userId))?.favoriteMovie ?? null,
  generateFact: generateMovieFact,
  // Server log only. The client gets a generic message, never error details.
  logError: (message, error) => console.error(message, error),
});
