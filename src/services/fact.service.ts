// Fact rules for Variant A: the 60-second cache window, burst protection, and
// failure fallback with a short cooldown. This file has no Prisma, OpenAI, or Next imports; its
// dependencies are passed in, so tests run it with in-memory fakes and no network.

export const CACHE_WINDOW_SECONDS = 60;
/** After a failed generation, skip OpenAI for this long and serve the fallback. */
export const FAILURE_COOLDOWN_SECONDS = 15;

export type StoredFact = {
  content: string;
  createdAt: Date;
  /** Seconds since createdAt, measured by the database clock. */
  ageSeconds: number;
};

/** Reads and writes, always scoped to one user. */
export interface FactStore {
  findLatest(userId: string, movieTitle: string): Promise<StoredFact | null>;
  insert(userId: string, movieTitle: string, content: string): Promise<StoredFact>;
  /** Whether this user's last generation failed less than `seconds` ago (database clock). */
  failedWithin(userId: string, seconds: number): Promise<boolean>;
  recordFailure(userId: string): Promise<void>;
}

export interface FactRepository extends FactStore {
  /** Runs `work` while holding this user's lock; concurrent callers for the same user wait. */
  withUserLock<T>(userId: string, work: (store: FactStore) => Promise<T>): Promise<T>;
}

export type FactServiceDeps = {
  facts: FactRepository;
  findFavoriteMovie(userId: string): Promise<string | null>;
  /** Throws on any failure (timeout, API error, bad output). */
  generateFact(movieTitle: string): Promise<string>;
  logError?(message: string, error: unknown): void;
};

export type FactResult =
  | { status: "ok"; fact: { content: string; createdAt: Date; stale: boolean } }
  | { status: "no_movie" }
  | { status: "unavailable" };

/** "Less than 60 seconds old" is cached; exactly 60 or older regenerates. */
function isFresh(fact: StoredFact): boolean {
  return fact.ageSeconds < CACHE_WINDOW_SECONDS;
}

function ok(fact: StoredFact, stale: boolean): FactResult {
  return { status: "ok", fact: { content: fact.content, createdAt: fact.createdAt, stale } };
}

export function createFactService(deps: FactServiceDeps) {
  /**
   * The fact for this user's current movie. `userId` must come from the session;
   * every read and write below is scoped to it.
   */
  async function getFactForUser(userId: string): Promise<FactResult> {
    const movie = await deps.findFavoriteMovie(userId);
    if (!movie) return { status: "no_movie" };

    // Fast path: inside the window, answer without taking the lock.
    const cached = await deps.facts.findLatest(userId, movie);
    if (cached && isFresh(cached)) return ok(cached, false);

    // What to show if generation fails: the most recent fact we've seen.
    let fallback = cached;
    const failed = (): FactResult => (fallback ? ok(fallback, true) : { status: "unavailable" });

    try {
      return await deps.facts.withUserLock(userId, async (store) => {
        // Re-check after acquiring the lock. If another tab held it, that request
        // just stored a fact, and we return it instead of calling OpenAI again.
        const latest = await store.findLatest(userId, movie);
        if (latest && isFresh(latest)) return ok(latest, false);
        fallback = latest ?? fallback;

        // If the request ahead of us just failed, OpenAI is likely still down:
        // answer now instead of every waiting tab retrying in turn.
        if (await store.failedWithin(userId, FAILURE_COOLDOWN_SECONDS)) return failed();

        try {
          const content = await deps.generateFact(movie);
          return ok(await store.insert(userId, movie, content), false);
        } catch (error) {
          // Caught inside the transaction so the failure marker commits.
          deps.logError?.("Fact generation failed", error);
          await store.recordFailure(userId);
          return failed();
        }
      });
    } catch (error) {
      // Lock wait timeout, transaction timeout, or a database error.
      deps.logError?.("Fact lookup failed", error);
      return failed();
    }
  }

  return { getFactForUser };
}
