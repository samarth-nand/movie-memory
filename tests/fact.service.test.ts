import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CACHE_WINDOW_SECONDS,
  createFactService,
  FAILURE_COOLDOWN_SECONDS,
  type FactRepository,
  type FactStore,
  type StoredFact,
} from "@/services/fact.service";

/**
 * In-memory stand-in for the Postgres repository. It mirrors the two properties
 * the service relies on: ages come from one shared clock (the "database clock"),
 * and withUserLock lets only one caller per user run at a time.
 * (tests/fact.repository.integration.test.ts checks the real one against Postgres.)
 */
function createFakeFacts() {
  let nowMs = 1_000_000;
  const rows: { userId: string; movieTitle: string; content: string; createdAtMs: number }[] = [];
  const locks = new Map<string, Promise<unknown>>();
  const failedAtMs = new Map<string, number>();

  const toStored = (row: (typeof rows)[number]): StoredFact => ({
    content: row.content,
    createdAt: new Date(row.createdAtMs),
    ageSeconds: (nowMs - row.createdAtMs) / 1000,
  });

  const store: FactStore = {
    async findLatest(userId, movieTitle) {
      const matches = rows.filter((r) => r.userId === userId && r.movieTitle === movieTitle);
      const latest = matches.sort((a, b) => b.createdAtMs - a.createdAtMs)[0];
      return latest ? toStored(latest) : null;
    },
    async insert(userId, movieTitle, content) {
      const row = { userId, movieTitle, content, createdAtMs: nowMs };
      rows.push(row);
      return toStored(row);
    },
    async failedWithin(userId, seconds) {
      const at = failedAtMs.get(userId);
      return at !== undefined && nowMs - at < seconds * 1000;
    },
    async recordFailure(userId) {
      failedAtMs.set(userId, nowMs);
    },
  };

  const repository: FactRepository = {
    ...store,
    withUserLock(userId, work) {
      const previous = locks.get(userId) ?? Promise.resolve();
      const run = previous.catch(() => undefined).then(() => work(store));
      locks.set(userId, run);
      return run;
    },
  };

  return {
    repository,
    /** Adds a fact that is `ageSeconds` old right now. */
    seed(userId: string, movieTitle: string, content: string, ageSeconds: number) {
      rows.push({ userId, movieTitle, content, createdAtMs: nowMs - ageSeconds * 1000 });
    },
    advance(seconds: number) {
      nowMs += seconds * 1000;
    },
    rowsFor(userId: string) {
      return rows.filter((r) => r.userId === userId);
    },
  };
}

const MOVIE = "Heat";
const movies: Record<string, string> = { alice: MOVIE, bob: MOVIE };

let facts: ReturnType<typeof createFakeFacts>;
let generateFact: ReturnType<typeof vi.fn<(title: string) => Promise<string>>>;
let service: ReturnType<typeof createFactService>;

beforeEach(() => {
  facts = createFakeFacts();
  let n = 0;
  generateFact = vi.fn(async (title: string) => `New fact #${++n} about ${title}`);
  service = createFactService({
    facts: facts.repository,
    findFavoriteMovie: async (userId) => movies[userId] ?? null,
    generateFact,
  });
});

describe("60-second cache window", () => {
  it("generates and stores a fact when there is none", async () => {
    const result = await service.getFactForUser("alice");

    expect(result).toMatchObject({ status: "ok", fact: { content: "New fact #1 about Heat", stale: false } });
    expect(generateFact).toHaveBeenCalledOnce();
    expect(facts.rowsFor("alice")).toHaveLength(1);
  });

  it("returns the cached fact when it is under 60 seconds old", async () => {
    facts.seed("alice", MOVIE, "Cached fact", 30);

    const result = await service.getFactForUser("alice");

    expect(result).toMatchObject({ status: "ok", fact: { content: "Cached fact", stale: false } });
    expect(generateFact).not.toHaveBeenCalled();
  });

  it("still returns the cached fact just under the boundary (59.999s)", async () => {
    facts.seed("alice", MOVIE, "Cached fact", CACHE_WINDOW_SECONDS - 0.001);

    const result = await service.getFactForUser("alice");

    expect(result).toMatchObject({ fact: { content: "Cached fact" } });
    expect(generateFact).not.toHaveBeenCalled();
  });

  it("regenerates at exactly 60 seconds, since the rule is 'less than 60'", async () => {
    facts.seed("alice", MOVIE, "Old fact", CACHE_WINDOW_SECONDS);

    const result = await service.getFactForUser("alice");

    expect(result).toMatchObject({ fact: { content: "New fact #1 about Heat", stale: false } });
    expect(generateFact).toHaveBeenCalledOnce();
  });

  it("regenerates once the window passes, then caches the new fact", async () => {
    await service.getFactForUser("alice");
    facts.advance(59);
    await service.getFactForUser("alice");
    expect(generateFact).toHaveBeenCalledTimes(1);

    facts.advance(1); // now exactly 60s old
    const result = await service.getFactForUser("alice");

    expect(generateFact).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ fact: { content: "New fact #2 about Heat" } });
  });

  it("only counts facts for the current movie", async () => {
    facts.seed("alice", "Alien", "Fact about another movie", 5);

    const result = await service.getFactForUser("alice");

    expect(result).toMatchObject({ fact: { content: "New fact #1 about Heat" } });
  });

  it("returns no_movie without calling OpenAI when the user hasn't onboarded", async () => {
    const result = await service.getFactForUser("newcomer");

    expect(result).toEqual({ status: "no_movie" });
    expect(generateFact).not.toHaveBeenCalled();
  });
});

describe("burst protection", () => {
  it("makes one OpenAI call for simultaneous requests from the same user", async () => {
    let release!: () => void;
    generateFact.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve("The only fact"))),
    );

    // Both requests miss the cache on the fast path, then queue on the lock.
    const first = service.getFactForUser("alice");
    const second = service.getFactForUser("alice");
    await vi.waitFor(() => expect(generateFact).toHaveBeenCalledOnce());
    release();

    const results = await Promise.all([first, second]);
    expect(generateFact).toHaveBeenCalledOnce();
    expect(results.map((r) => r.status === "ok" && r.fact.content)).toEqual(["The only fact", "The only fact"]);
    expect(facts.rowsFor("alice")).toHaveLength(1);
  });
});

describe("failure fallback", () => {
  it("returns the most recent fact marked stale when OpenAI fails", async () => {
    facts.seed("alice", MOVIE, "Older fact", 300);
    facts.seed("alice", MOVIE, "Most recent fact", 120);
    generateFact.mockRejectedValueOnce(new Error("timeout"));

    const result = await service.getFactForUser("alice");

    expect(result).toMatchObject({ status: "ok", fact: { content: "Most recent fact", stale: true } });
    expect(facts.rowsFor("alice")).toHaveLength(2); // nothing new stored
  });

  it("returns unavailable when OpenAI fails and there is no earlier fact", async () => {
    generateFact.mockRejectedValueOnce(new Error("500"));

    expect(await service.getFactForUser("alice")).toEqual({ status: "unavailable" });
  });

  it("falls back the same way when the lock or transaction fails", async () => {
    facts.seed("alice", MOVIE, "Previous fact", 120);
    vi.spyOn(facts.repository, "withUserLock").mockRejectedValueOnce(new Error("lock timeout"));

    const result = await service.getFactForUser("alice");

    expect(result).toMatchObject({ fact: { content: "Previous fact", stale: true } });
  });
});

describe("failure cooldown", () => {
  it("skips OpenAI for a while after a failure and serves the fallback", async () => {
    facts.seed("alice", MOVIE, "Previous fact", 120);
    generateFact.mockRejectedValueOnce(new Error("timeout"));
    await service.getFactForUser("alice");

    facts.advance(FAILURE_COOLDOWN_SECONDS - 1);
    const result = await service.getFactForUser("alice");

    expect(generateFact).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ fact: { content: "Previous fact", stale: true } });
  });

  it("tries OpenAI again once the cooldown has passed", async () => {
    generateFact.mockRejectedValueOnce(new Error("timeout"));
    expect(await service.getFactForUser("alice")).toEqual({ status: "unavailable" });

    facts.advance(FAILURE_COOLDOWN_SECONDS); // exactly the cooldown: "less than" has passed
    const result = await service.getFactForUser("alice");

    expect(generateFact).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ fact: { content: "New fact #1 about Heat", stale: false } });
  });

  it("makes one OpenAI call for a burst during an outage", async () => {
    let fail!: () => void;
    generateFact.mockImplementationOnce(() => new Promise((_, reject) => (fail = () => reject(new Error("down")))));

    const first = service.getFactForUser("alice");
    const second = service.getFactForUser("alice");
    await vi.waitFor(() => expect(generateFact).toHaveBeenCalledOnce());
    fail();

    expect(await Promise.all([first, second])).toEqual([{ status: "unavailable" }, { status: "unavailable" }]);
    expect(generateFact).toHaveBeenCalledOnce();
  });

  it("is per user: one user's failure doesn't block another", async () => {
    generateFact.mockRejectedValueOnce(new Error("timeout"));
    await service.getFactForUser("bob");

    const result = await service.getFactForUser("alice");

    expect(result).toMatchObject({ status: "ok", fact: { stale: false } });
  });
});

describe("authorization", () => {
  it("never returns another user's fact, even for the same movie", async () => {
    facts.seed("bob", MOVIE, "Bob's private fact", 5); // fresh, same movie

    const result = await service.getFactForUser("alice");

    expect(result).toMatchObject({ fact: { content: "New fact #1 about Heat" } });
    expect(facts.rowsFor("alice")).toHaveLength(1);
    expect(facts.rowsFor("bob")).toEqual([expect.objectContaining({ content: "Bob's private fact" })]);
  });

  it("never falls back to another user's fact when OpenAI fails", async () => {
    facts.seed("bob", MOVIE, "Bob's private fact", 120);
    generateFact.mockRejectedValueOnce(new Error("timeout"));

    expect(await service.getFactForUser("alice")).toEqual({ status: "unavailable" });
  });
});
